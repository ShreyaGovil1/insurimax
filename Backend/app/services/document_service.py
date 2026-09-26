"""
Document service — GCS upload orchestration and extraction job management.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gcp import storage as gcs
from app.gcp.gemini import (
    EXTRACTION_SYSTEM_PROMPT,
    generate_json,
)
from app.models.document import Document, DocumentType, ExtractionJob, ExtractionStatus
from app.core.config import settings


async def upload_document(
    db: AsyncSession,
    claim_id: uuid.UUID,
    file_data: bytes,
    filename: str,
    mime_type: str,
    doc_type: DocumentType,
    uploaded_by_id: uuid.UUID,
) -> Document:
    """Upload file to GCS and create Document DB record."""
    object_key = gcs.build_object_key(claim_id, doc_type.value, filename)

    upload_result = await gcs.upload_file(file_data, object_key, mime_type)

    doc = Document(
        claim_id=claim_id,
        doc_type=doc_type,
        original_filename=filename,
        mime_type=mime_type,
        file_size_bytes=upload_result["size_bytes"],
        gcs_bucket=upload_result["bucket"],
        gcs_object_key=object_key,
        extraction_status=ExtractionStatus.PENDING,
        uploaded_by_id=uploaded_by_id,
    )
    db.add(doc)
    await db.flush()
    return doc


async def get_document(db: AsyncSession, doc_id: uuid.UUID) -> Document | None:
    result = await db.execute(select(Document).where(Document.id == doc_id))
    return result.scalar_one_or_none()


async def list_claim_documents(db: AsyncSession, claim_id: uuid.UUID) -> list[Document]:
    result = await db.execute(
        select(Document).where(Document.claim_id == claim_id).order_by(Document.created_at)
    )
    return result.scalars().all()


async def delete_document(db: AsyncSession, doc_id: uuid.UUID) -> bool:
    doc = await get_document(db, doc_id)
    if not doc:
        return False
    await gcs.delete_object(doc.gcs_object_key)
    await db.delete(doc)
    await db.flush()
    return True


async def trigger_extraction(db: AsyncSession, doc_id: uuid.UUID) -> ExtractionJob:
    """
    Create an extraction job and run it immediately (async within the request).
    For production, this should be moved to a Cloud Tasks / Pub/Sub worker.
    """
    doc = await get_document(db, doc_id)
    if not doc:
        raise ValueError(f"Document {doc_id} not found")

    job = ExtractionJob(
        document_id=doc.id,
        claim_id=doc.claim_id,
        status=ExtractionStatus.IN_PROGRESS,
        started_at=datetime.now(timezone.utc),
    )
    db.add(job)
    doc.extraction_status = ExtractionStatus.IN_PROGRESS
    await db.flush()

    try:
        # Download document bytes from GCS
        file_bytes = await gcs.download_as_bytes(doc.gcs_object_key)

        # Build multimodal payload
        inline_data = [{"mime_type": doc.mime_type, "data": file_bytes}]
        prompt = (
            f"{EXTRACTION_SYSTEM_PROMPT}\n\n"
            f"Document type: {doc.doc_type.value}\n"
            f"Original filename: {doc.original_filename}\n\n"
            "Extract all structured data from the attached document."
        )

        extracted, prompt_tokens, completion_tokens = await generate_json(
            prompt=prompt,
            inline_data=inline_data,
            model_name=settings.GEMINI_MODEL,
        )

        # Persist results
        job.status = ExtractionStatus.COMPLETED
        job.extracted_payload = extracted
        job.gemini_model_used = settings.GEMINI_MODEL
        job.prompt_tokens = prompt_tokens
        job.completion_tokens = completion_tokens
        job.completed_at = datetime.now(timezone.utc)

        doc.extraction_status = ExtractionStatus.COMPLETED
        if isinstance(extracted, dict):
            doc.extraction_confidence = extracted.get("confidence_score")

    except Exception as exc:
        job.status = ExtractionStatus.FAILED
        job.error_message = str(exc)
        job.completed_at = datetime.now(timezone.utc)
        doc.extraction_status = ExtractionStatus.FAILED

    await db.flush()
    return job


async def get_extraction_job(db: AsyncSession, job_id: uuid.UUID) -> ExtractionJob | None:
    result = await db.execute(select(ExtractionJob).where(ExtractionJob.id == job_id))
    return result.scalar_one_or_none()


async def get_claim_extracted_data(db: AsyncSession, claim_id: uuid.UUID) -> dict:
    """Merge extracted payloads from all completed jobs for a claim."""
    result = await db.execute(
        select(ExtractionJob)
        .where(
            ExtractionJob.claim_id == claim_id,
            ExtractionJob.status == ExtractionStatus.COMPLETED,
        )
        .order_by(ExtractionJob.completed_at.desc())
    )
    jobs = result.scalars().all()

    merged: dict = {}
    for job in reversed(jobs):  # oldest first so newest overrides
        payload = job.corrected_payload or job.extracted_payload or {}
        if isinstance(payload, dict):
            merged.update(payload)

    return merged


async def patch_extracted_data(
    db: AsyncSession, claim_id: uuid.UUID, corrected_payload: dict
) -> ExtractionJob | None:
    """Apply manual corrections to the most recent completed extraction job."""
    result = await db.execute(
        select(ExtractionJob)
        .where(
            ExtractionJob.claim_id == claim_id,
            ExtractionJob.status == ExtractionStatus.COMPLETED,
        )
        .order_by(ExtractionJob.completed_at.desc())
        .limit(1)
    )
    job = result.scalar_one_or_none()
    if not job:
        return None
    job.corrected_payload = corrected_payload
    await db.flush()
    return job


async def generate_signed_url_for_document(
    db: AsyncSession, doc_id: uuid.UUID
) -> tuple[str, datetime] | None:
    doc = await get_document(db, doc_id)
    if not doc:
        return None

    from datetime import timedelta

    expiry_minutes = settings.GCS_SIGNED_URL_EXPIRY_MINUTES
    signed_url = await gcs.generate_signed_url(doc.gcs_object_key, expiry_minutes)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expiry_minutes)
    return signed_url, expires_at
