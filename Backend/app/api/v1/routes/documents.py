"""
Documents & Extraction routes.

POST   /claims/{claimId}/documents
GET    /claims/{claimId}/documents
GET    /claims/{claimId}/documents/{documentId}
DELETE /claims/{claimId}/documents/{documentId}
POST   /claims/{claimId}/documents/{documentId}/extract
GET    /extraction-jobs/{jobId}
GET    /claims/{claimId}/documents/{documentId}/pages
GET    /claims/{claimId}/documents/{documentId}/pages/{page}
GET    /claims/{claimId}/documents/{documentId}/extracted-data
PATCH  /claims/{claimId}/documents/{documentId}/extracted-data
GET    /claims/{claimId}/extracted-data
PATCH  /claims/{claimId}/extracted-data
"""

import asyncio
import uuid

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Response, UploadFile, status

from app.core.access import require_claim_access, require_hospital_desk
from app.core.deps import AdjusterOrAbove, CurrentUser, DBSession
from app.models.claim import ClaimStatus
from app.models.document import Document
from app.models.user import User, UserRole
from app.models.document import DocumentType, ExtractionStatus
from app.schemas.document import (
    DocumentRead,
    DocumentSignedUrl,
    ExtractedDataPatch,
    ExtractionJobRead,
)
from app.schemas.common import MessageResponse
from app.gcp import storage as gcs
from app.services import citation_service, claim_service, document_service

router = APIRouter(tags=["Documents & Extraction"])

_STAFF_ROLES = (UserRole.ADMIN, UserRole.ADJUSTER)
_CLOSED_STATUSES = (ClaimStatus.FINALIZED, ClaimStatus.REJECTED)


def _is_staff(user: User) -> bool:
    return user.role in _STAFF_ROLES


async def _authorized_document(db, claim_id: uuid.UUID, doc_id: uuid.UUID, user: User) -> Document:
    """
    Load a document and enforce role-based access:
    staff can touch any document on the claim; hospital desk only their own organisation's.
    """
    await require_claim_access(db, claim_id, user)
    doc = await document_service.get_document(db, doc_id)
    if not doc or doc.claim_id != claim_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Document not found")
    if not _is_staff(user) and not await document_service.is_document_owned_by(db, doc, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can only access documents uploaded by your organization")
    return doc


# ── Per-claim document management ─────────────────────────────────────────────

@router.post(
    "/claims/{claim_id}/documents",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    claim_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
    file: UploadFile = File(...),
    doc_type: DocumentType = Form(...),
):
    """
    Upload a document (bill, prescription, discharge summary, etc.) for a claim.
    File is stored in GCS; metadata is persisted in DB.
    """
    require_hospital_desk(current_user, "upload claim documents")
    claim = await require_claim_access(db, claim_id, current_user)
    if claim.status in _CLOSED_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This claim is closed; documents can no longer be added")

    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="File must have a filename",
        )

    file_data = await file.read()
    if len(file_data) == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded file is empty",
        )

    # Guard max file size: 50 MB
    max_bytes = 50 * 1024 * 1024
    if len(file_data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File exceeds 50 MB limit",
        )

    doc = await document_service.upload_document(
        db=db,
        claim_id=claim_id,
        file_data=file_data,
        filename=file.filename,
        mime_type=file.content_type or "application/octet-stream",
        doc_type=doc_type,
        uploaded_by_id=current_user.id,
    )
    return doc


@router.get("/claims/{claim_id}/documents", response_model=list[DocumentRead])
async def list_documents(
    claim_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    await require_claim_access(db, claim_id, current_user)
    docs = await document_service.list_claim_documents(db, claim_id)
    if not _is_staff(current_user):
        docs = [d for d in docs if await document_service.is_document_owned_by(db, d, current_user)]
    return docs


@router.get("/claims/{claim_id}/documents/{doc_id}", response_model=DocumentSignedUrl)
async def get_document_signed_url(
    claim_id: uuid.UUID,
    doc_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Returns a short-lived GCS signed URL for direct browser download/preview.
    Valid for GCS_SIGNED_URL_EXPIRY_MINUTES (default 30 min).
    """
    await _authorized_document(db, claim_id, doc_id, current_user)
    result = await document_service.generate_signed_url_for_document(db, doc_id)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    signed_url, expires_at = result
    return DocumentSignedUrl(document_id=doc_id, signed_url=signed_url, expires_at=expires_at)


@router.delete(
    "/claims/{claim_id}/documents/{doc_id}",
    response_model=MessageResponse,
)
async def delete_document(
    claim_id: uuid.UUID,
    doc_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Delete a document. Hospital desk only, and only its own organization's documents on a
    draft claim: once submitted, the documents are the evidence the insurer adjudicates on.
    """
    require_hospital_desk(current_user, "delete claim documents")
    await _authorized_document(db, claim_id, doc_id, current_user)
    claim = await claim_service.get_claim(db, claim_id)
    if claim.status != ClaimStatus.DRAFT:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Documents can't be deleted after the claim is submitted",
        )
    deleted = await document_service.delete_document(db, doc_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return {"message": f"Document {doc_id} deleted"}


# ── Page previews (citation viewer) ────────────────────────────────────────────

@router.get("/claims/{claim_id}/documents/{doc_id}/pages")
async def get_document_pages(
    claim_id: uuid.UUID,
    doc_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    """Page count and kind, so the citation viewer knows whether it can page/highlight."""
    doc = await _authorized_document(db, claim_id, doc_id, current_user)
    if not citation_service.is_pdf(doc.mime_type, doc.original_filename):
        return {"document_id": str(doc.id), "kind": "image", "page_count": 1}
    data = await gcs.download_as_bytes(doc.gcs_object_key)
    count = await asyncio.to_thread(citation_service.pdf_page_count, data)
    return {"document_id": str(doc.id), "kind": "pdf", "page_count": count}


@router.get("/claims/{claim_id}/documents/{doc_id}/pages/{page}")
async def get_document_page_image(
    claim_id: uuid.UUID,
    doc_id: uuid.UUID,
    page: int,
    db: DBSession,
    current_user: CurrentUser,
):
    """
    One page as an image: PDFs are rendered to PNG (citation highlights are drawn on top in the
    browser using normalised rects); image documents are returned as-is.
    """
    doc = await _authorized_document(db, claim_id, doc_id, current_user)
    data = await gcs.download_as_bytes(doc.gcs_object_key)
    if not citation_service.is_pdf(doc.mime_type, doc.original_filename):
        return Response(content=data, media_type=doc.mime_type or "application/octet-stream")
    try:
        png = await asyncio.to_thread(citation_service.render_pdf_page, data, page)
    except IndexError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc))
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "private, max-age=300"})


# ── Extraction ─────────────────────────────────────────────────────────────────

@router.post(
    "/claims/{claim_id}/documents/{doc_id}/extract",
    response_model=ExtractionJobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_extraction(
    claim_id: uuid.UUID,
    doc_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Trigger Gemini extraction for a single document.
    Runs synchronously in this request (for hackathon simplicity).
    In production, push to Cloud Tasks / Pub/Sub.

    Once the claim is submitted, the hospital can no longer re-extract a document that has
    already been extracted: the insurer is adjudicating on that data. A document the hospital
    uploads after submission (e.g. answering a query) still gets its first extraction.
    """
    doc = await _authorized_document(db, claim_id, doc_id, current_user)
    if current_user.role == UserRole.HOSPITAL_DESK and doc.extraction_status == ExtractionStatus.COMPLETED:
        claim = await claim_service.get_claim(db, claim_id)
        if claim.status != ClaimStatus.DRAFT:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="Documents can't be re-extracted after the claim is submitted to the insurer",
            )
    try:
        job = await document_service.trigger_extraction(db, doc_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return job


@router.get("/extraction-jobs/{job_id}", response_model=ExtractionJobRead)
async def get_extraction_job(
    job_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    """Poll an extraction job's status and result."""
    job = await document_service.get_extraction_job(db, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Extraction job not found"
        )
    return job


@router.get("/claims/{claim_id}/extracted-data")
async def get_extracted_data(
    claim_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Merged extracted data from all completed extraction jobs for a claim.
    Manual corrections (corrected_payload) override raw Gemini output.
    Cross-checks extracted patient name against registered claim patient name.
    """
    if not _is_staff(current_user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Claim-level extracted data is restricted to claim staff")
    data = await document_service.get_claim_extracted_data(db, claim_id)
    claim = await claim_service.get_claim(db, claim_id)

    if claim and isinstance(data, dict):
        bill_patient = data.get("patient") or {}
        bill_patient_name = (bill_patient.get("name") or "").strip()
        claim_patient_name = (claim.patient_name or "").strip()

        is_exact_name_match = (
            bool(bill_patient_name)
            and bool(claim_patient_name)
            and bill_patient_name.lower() == claim_patient_name.lower()
        )

        bill_hospital = data.get("hospital") or {}
        bill_hospital_name = (bill_hospital.get("name") or "").strip()
        claim_hospital_name = (claim.hospital_name or "").strip()
        is_hospital_match = (
            bool(bill_hospital_name)
            and bool(claim_hospital_name)
            and (
                bill_hospital_name.lower() in claim_hospital_name.lower()
                or claim_hospital_name.lower() in bill_hospital_name.lower()
            )
        )

        data["_verification"] = {
            "is_name_match": is_exact_name_match,
            "claim_patient_name": claim_patient_name,
            "bill_patient_name": bill_patient_name,
            "has_mismatch": bool(bill_patient_name and not is_exact_name_match),
            "is_hospital_match": is_hospital_match,
            "claim_hospital_name": claim_hospital_name,
            "bill_hospital_name": bill_hospital_name,
            "message": (
                "Exact match verified"
                if is_exact_name_match
                else f"Patient name on hospital bill ('{bill_patient_name}') does not match registered claimant ('{claim_patient_name}'). Exact match required."
            )
            if bill_patient_name
            else "No patient name detected on bill",
        }

    return {"claim_id": str(claim_id), "extracted_data": data}


@router.get("/claims/{claim_id}/documents/{doc_id}/extracted-data")
async def get_document_extracted_data(
    claim_id: uuid.UUID,
    doc_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    """Extracted content of one selected document (latest completed extraction)."""
    doc = await _authorized_document(db, claim_id, doc_id, current_user)
    job = await document_service.get_document_extraction(db, doc_id)
    payload = (job.corrected_payload or job.extracted_payload) if job else None
    return {
        "document_id": str(doc.id),
        "filename": doc.original_filename,
        "doc_type": doc.doc_type.value,
        "extraction_status": doc.extraction_status.value,
        "job_id": str(job.id) if job else None,
        "extracted_at": job.completed_at.isoformat() if job and job.completed_at else None,
        "extracted_data": payload,
    }


@router.patch("/claims/{claim_id}/documents/{doc_id}/extracted-data")
async def patch_document_extracted_data(
    claim_id: uuid.UUID,
    doc_id: uuid.UUID,
    body: ExtractedDataPatch,
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Apply manual corrections to one document's extraction (fields edited, items added/removed).
    Insurer staff can correct any time; the hospital only its own documents while the claim is a
    draft. Once submitted, the extraction is the insurer's evidence (same rule as re-extraction).
    """
    doc = await _authorized_document(db, claim_id, doc_id, current_user)
    if not _is_staff(current_user):
        claim = await claim_service.get_claim(db, claim_id)
        if current_user.role != UserRole.HOSPITAL_DESK or claim.status != ClaimStatus.DRAFT:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="Extracted data can only be corrected by the hospital while the claim is a draft",
            )
    job = await document_service.get_document_extraction(db, doc_id)
    if not job:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No completed extraction for this document")
    job.corrected_payload = body.corrected_payload
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(job, "corrected_payload")

    if doc.doc_type == DocumentType.ITEMIZED_BILL and isinstance(body.corrected_payload, dict):
        bill_sum = body.corrected_payload.get("total_billed_inr")
        if bill_sum is None and "line_items" in body.corrected_payload:
            items = body.corrected_payload.get("line_items") or []
            bill_sum = sum(float(i.get("total_price_inr") or 0) for i in items if isinstance(i, dict))
        if bill_sum is not None:
            claim_obj = await claim_service.get_claim(db, claim_id)
            if claim_obj and claim_obj.status == ClaimStatus.DRAFT:
                claim_obj.billed_amount = float(bill_sum)

    await db.flush()
    return {"message": "Extracted data updated", "job_id": str(job.id)}


@router.patch("/claims/{claim_id}/extracted-data")
async def patch_extracted_data(
    claim_id: uuid.UUID,
    body: ExtractedDataPatch,
    db: DBSession,
    current_user: AdjusterOrAbove,
):
    """Apply manual adjuster corrections to the extracted data."""
    job = await document_service.patch_extracted_data(db, claim_id, body.corrected_payload)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No completed extraction job found for this claim",
        )
    return {"message": "Extracted data updated", "job_id": str(job.id)}
