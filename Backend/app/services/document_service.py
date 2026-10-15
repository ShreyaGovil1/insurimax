"""
Document service — GCS upload orchestration and extraction job management.
"""
import asyncio
import copy
import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gcp import storage as gcs
from app.services import ai_model_service, bill_consolidation
from app.gcp.gemini import (
    BILL_RECONCILIATION_PROMPT,
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
            prompt=CLASSIFY_PROMPT,
            inline_data=inline_data,
            model_name=await ai_model_service.model_for("document_classification"),
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

        extraction_model = await ai_model_service.model_for("document_extraction")
        extracted, prompt_tokens, completion_tokens = await generate_json(
            prompt=prompt,
            inline_data=inline_data,
            model_name=extraction_model,
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
        job.gemini_model_used = extraction_model
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
    if job.status == ExtractionStatus.COMPLETED and doc.doc_type != DocumentType.POLICY_DOCUMENT:
        try:  # how this document relates to the claim's other bills
            await reconcile_claim_bills(db, doc.claim_id)
        except Exception as exc:
            logger.warning("Bill reconciliation after extracting %s failed: %s", doc.id, exc)
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


# Charge fields are combined across documents by bill_consolidation, never deep-merged.
_BILLING_KEYS = {"line_items", "items", "total_billed_inr", "bill", "document_type"}
_NOT_CLAIMED_ROLES = {"reference_charge_sheet", "payment_receipt", "duplicate"}
# Claim-level fields produced by bill_consolidation (and the API's verification block)
_CONSOLIDATED_KEYS = {
    "bills", "superseded_summary_lines", "reference_charge_sheets", "bill_reconciliation_notes",
    "bill_reconciliation_method", "_verification",
}


def _payload(job: ExtractionJob) -> dict:
    payload = job.corrected_payload or job.extracted_payload or {}
    return payload if isinstance(payload, dict) else {}


def _headers(payload: dict) -> dict:
    # Copied: _deep_merge keeps references, and must never write into a job's stored payload.
    return copy.deepcopy({k: v for k, v in payload.items() if k not in _BILLING_KEYS})


async def _latest_extractions(db: AsyncSession, claim_id: uuid.UUID) -> list[tuple[ExtractionJob, Document]]:
    """Latest completed extraction of each non-policy document (a re-extraction replaces the earlier one)."""
    result = await db.execute(
        select(ExtractionJob, Document)
        .join(Document, Document.id == ExtractionJob.document_id)
        .where(
            ExtractionJob.claim_id == claim_id,
            ExtractionJob.status == ExtractionStatus.COMPLETED,
            Document.doc_type != DocumentType.POLICY_DOCUMENT,
        )
        .order_by(ExtractionJob.completed_at)
    )
    latest: dict[uuid.UUID, tuple[ExtractionJob, Document]] = {}
    for job, doc in result.all():
        latest[doc.id] = (job, doc)
    return list(latest.values())


def _claim_bills(rows: list[tuple[ExtractionJob, Document]]) -> list[dict]:
    """Every document that lists charges, whatever section it was uploaded under."""
    bills = []
    for job, doc in rows:
        bill = bill_consolidation.bill_from_payload(str(doc.id), doc.original_filename, doc.doc_type.value, _payload(job))
        if bill:
            bills.append(bill)
    return bills


async def _reconciliation_plan(db: AsyncSession, claim, bills: list[dict], stay: dict, refresh: bool) -> dict:
    """
    The AI's reading of how the claim's bills relate, cached on the claim and keyed by a fingerprint of
    what it read, so it is redone only when a bill is added, re-extracted or corrected. With
    ``refresh=False`` a stale plan is not recomputed ({} -> rule-based fallback).
    """
    if claim is None or len(bills) < 2:
        return {}
    documents = bill_consolidation.plan_input(bills)
    fingerprint = hashlib.sha256(json.dumps([stay, documents], sort_keys=True, default=str).encode()).hexdigest()
    stored = claim.bill_reconciliation or {}
    if stored.get("fingerprint") == fingerprint:
        return stored.get("plan") or {}
    if not refresh:
        return {}
    try:
        model = await ai_model_service.model_for("bill_reconciliation")
        result, _, _ = await generate_json(
            prompt=(
                f"{BILL_RECONCILIATION_PROMPT}\n## Hospital stay\n{json.dumps(stay, default=str)}\n\n"
                f"## Documents\n{json.dumps(documents, indent=1, default=str)}"
            ),
            model_name=model,
        )
    except Exception as exc:  # reconciliation falls back to rules; never block extraction / adjudication
        logger.warning("Bill reconciliation failed for claim %s: %s", claim.id, exc)
        return {}
    known = {b["document_id"] for b in bills}
    entries = result.get("documents") if isinstance(result, dict) else None
    plan = {
        str(e["document_id"]): e
        for e in entries or []
        if isinstance(e, dict) and str(e.get("document_id")) in known
    }
    claim.bill_reconciliation = {
        "fingerprint": fingerprint,
        "model": model,
        "plan": plan,
        "reconciled_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.flush()
    return plan


async def reconcile_claim_bills(db: AsyncSession, claim_id: uuid.UUID) -> None:
    """Refresh the AI bill reconciliation after a document's extraction changes (best-effort)."""
    await get_claim_extracted_data(db, claim_id, refresh_reconciliation=True)


async def get_claim_extracted_data(
    db: AsyncSession, claim_id: uuid.UUID, refresh_reconciliation: bool = False
) -> dict:
    """
    Claim-level view of the extracted documents (never policy documents):
    - patient / hospital / clinical fields are deep-merged, hospital documents winning over clinical ones and
      the main bill winning over other bills;
    - charges from EVERY document that lists them are combined by bill_consolidation, using the AI
      reconciliation of how the bills relate (refreshed first when ``refresh_reconciliation``).
    """
    rows = await _latest_extractions(db, claim_id)

    # "other" documents carry charges but not header fields (an insurer letter must not rename the hospital).
    merged: dict = {}
    for doc_type in _CLAIM_MERGE_PRIORITY:
        if doc_type == DocumentType.ITEMIZED_BILL:
            continue
        for job, doc in rows:
            if doc.doc_type == doc_type:
                _deep_merge(merged, _headers(_payload(job)))

    bills = _claim_bills(rows)
    bill_rows = [(job, doc) for job, doc in rows if doc.doc_type == DocumentType.ITEMIZED_BILL]
    if not bills:
        for job, _ in bill_rows:
            _deep_merge(merged, _headers(_payload(job)))
        return merged

    patient: dict = {}
    for job, _ in bill_rows:
        _deep_merge(patient, _headers(_payload(job)).get("patient") or {})
    _deep_merge(patient, copy.deepcopy(merged.get("patient") or {}))
    stay = {"admission_date": patient.get("admission_date"), "discharge_date": patient.get("discharge_date")}

    claim = await db.get(Claim, claim_id)
    plan = await _reconciliation_plan(db, claim, bills, stay, refresh_reconciliation)
    combined = bill_consolidation.consolidate(
        bills,
        bill_consolidation.parse_date(stay["admission_date"]),
        bill_consolidation.parse_date(stay["discharge_date"]),
        plan,
    )

    # Header fields of the bills: secondary bills first, the main bill last so its patient/hospital win.
    primary_id = combined.pop("primary_document_id")
    roles = {b["document_id"]: b["role"] for b in combined["bills"]}
    for job, doc in sorted(bill_rows, key=lambda r: str(r[1].id) == primary_id):
        if roles.get(str(doc.id)) not in _NOT_CLAIMED_ROLES:
            _deep_merge(merged, _headers(_payload(job)))
    merged.update(combined)
    return merged


async def patch_extracted_data(
    db: AsyncSession, claim_id: uuid.UUID, corrected_payload: dict
) -> ExtractionJob | None:
    """
    Apply claim-level corrections (patient, hospital, ...) to the most recent completed extraction job.
    The claim-level view combines several documents' charges, so charges are corrected per document
    (PATCH .../documents/{doc_id}/extracted-data); here the job keeps its own charges.
    """
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
    own = _payload(job)
    job.corrected_payload = {
        **{k: v for k, v in corrected_payload.items() if k not in _BILLING_KEYS and k not in _CONSOLIDATED_KEYS},
        **{k: v for k, v in own.items() if k in _BILLING_KEYS},
    }
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
