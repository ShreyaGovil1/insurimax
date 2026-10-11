"""
Document service — GCS upload orchestration and extraction job management.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gcp import storage as gcs
from app.gcp.gemini import (
    CLASSIFY_PROMPT,
    get_extraction_prompt,
    generate_json,
)
from app.models.user import User
from app.models.document import Document, DocumentType, ExtractionJob, ExtractionStatus
from app.core.config import settings
from app.services.citation_service import attach_citations

logger = logging.getLogger(__name__)


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


async def _detect_document_type(inline_data: list[dict]) -> DocumentType | None:
    """Ask Gemini what the document actually is; None if unsure or on any failure."""
    try:
        result, _, _ = await generate_json(
            prompt=CLASSIFY_PROMPT, inline_data=inline_data, model_name=settings.GEMINI_MODEL
        )
        if isinstance(result, dict) and float(result.get("confidence") or 0) >= 0.7:
            return DocumentType(result.get("document_type"))
    except Exception:
        pass
    return None


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

        # Guard against a wrongly chosen upload type (e.g. a policy uploaded as "itemized bill")
        detected = await _detect_document_type(inline_data)
        if detected and detected != doc.doc_type:
            doc.doc_type = detected
        prompt = (
            f"{get_extraction_prompt(doc.doc_type.value)}\n\n"
            f"Document type: {doc.doc_type.value}\n"
            f"Original filename: {doc.original_filename}\n\n"
            f"Extract all structured data from the attached {doc.doc_type.value.replace('_', ' ')} "
            "following the schema for that document type."
        )

        extracted, prompt_tokens, completion_tokens = await generate_json(
            prompt=prompt,
            inline_data=inline_data,
            model_name=settings.GEMINI_MODEL,
        )

        # Turn Gemini's {"source": {page, text}} on every list item into a locatable citation
        if isinstance(extracted, dict):
            try:
                await asyncio.to_thread(
                    attach_citations,
                    extracted,
                    document_id=str(doc.id),
                    filename=doc.original_filename,
                    mime_type=doc.mime_type,
                    file_bytes=file_bytes,
                )
            except Exception as exc:  # citations are best-effort; never fail the extraction
                logger.warning("Citation linking failed for document %s: %s", doc.id, exc)

        # Persist results
        job.status = ExtractionStatus.COMPLETED
        if isinstance(extracted, dict):
            extracted["document_type"] = doc.doc_type.value
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


# Document types that describe the hospital stay and feed claim-level adjudication data.
# Policy documents and "other" files are excluded so that e.g. an insurer's name never
# overwrites the hospital on the bill. Lower index = lower priority; bills win.
_CLAIM_MERGE_PRIORITY = [
    DocumentType.CONSULTATION_NOTES,
    DocumentType.LAB_REPORT,
    DocumentType.PRESCRIPTION,
    DocumentType.DISCHARGE_SUMMARY,
    DocumentType.ITEMIZED_BILL,
]


def _deep_merge(base: dict, new: dict) -> dict:
    """Merge `new` into `base`, ignoring null/empty values so they never erase real data."""
    for key, value in new.items():
        if value in (None, "", [], {}):
            continue
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value
    return base


async def get_claim_extracted_data(db: AsyncSession, claim_id: uuid.UUID) -> dict:
    """Merge extracted payloads of the claim's hospital documents (never policy/other documents)."""
    result = await db.execute(
        select(ExtractionJob, Document.doc_type)
        .join(Document, Document.id == ExtractionJob.document_id)
        .where(
            ExtractionJob.claim_id == claim_id,
            ExtractionJob.status == ExtractionStatus.COMPLETED,
            Document.doc_type.in_(_CLAIM_MERGE_PRIORITY),
        )
        .order_by(ExtractionJob.completed_at)  # oldest first, newest overrides within a type
    )
    rows = result.all()

    merged: dict = {}
    for doc_type in _CLAIM_MERGE_PRIORITY:
        for job, row_type in rows:
            if row_type != doc_type:
                continue
            payload = job.corrected_payload or job.extracted_payload or {}
            if isinstance(payload, dict):
                _deep_merge(merged, {k: v for k, v in payload.items() if k != "document_type"})

    return merged


async def patch_extracted_data(
    db: AsyncSession, claim_id: uuid.UUID, corrected_payload: dict
) -> ExtractionJob | None:
    """Apply manual corrections to the most recent completed extraction job."""
    result = await db.execute(
        select(ExtractionJob)
        .join(Document, Document.id == ExtractionJob.document_id)
        .where(
            ExtractionJob.claim_id == claim_id,
            ExtractionJob.status == ExtractionStatus.COMPLETED,
            Document.doc_type.in_(_CLAIM_MERGE_PRIORITY),
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


from app.models.claim import Claim


async def is_document_owned_by(db: AsyncSession, doc: Document, user: User) -> bool:
    """True if the document was uploaded by the user, or by someone in the user's organisation, or belongs to user's claim organisation."""
    if user.org_id is None:
        return False
    if doc.uploaded_by_id == user.id:
        return True
    if doc.claim_id:
        claim_org = (
            await db.execute(select(Claim.hospital_org_id).where(Claim.id == doc.claim_id))
        ).scalar_one_or_none()
        if claim_org and claim_org == user.org_id:
            return True
    if doc.uploaded_by_id is not None:
        uploader = (
            await db.execute(select(User).where(User.id == doc.uploaded_by_id))
        ).scalar_one_or_none()
        if uploader and uploader.org_id == user.org_id:
            return True
    return False


async def get_document_extraction(db: AsyncSession, doc_id: uuid.UUID) -> ExtractionJob | None:
    """Most recent completed extraction job for a single document."""
    result = await db.execute(
        select(ExtractionJob)
        .where(
            ExtractionJob.document_id == doc_id,
            ExtractionJob.status == ExtractionStatus.COMPLETED,
        )
        .order_by(ExtractionJob.completed_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()
