"""
Documents & Extraction routes.

POST   /claims/{claimId}/documents
GET    /claims/{claimId}/documents
GET    /claims/{claimId}/documents/{documentId}
DELETE /claims/{claimId}/documents/{documentId}
POST   /claims/{claimId}/documents/{documentId}/extract
GET    /extraction-jobs/{jobId}
GET    /claims/{claimId}/documents/{documentId}/extracted-data
PATCH  /claims/{claimId}/documents/{documentId}/extracted-data
GET    /claims/{claimId}/extracted-data
PATCH  /claims/{claimId}/extracted-data
"""
import uuid

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile, status

from app.core.access import require_claim_access
from app.core.deps import AdjusterOrAbove, CurrentUser, DBSession
from app.models.document import Document
from app.models.user import User, UserRole
from app.models.document import DocumentType
from app.schemas.document import (
    DocumentRead,
    DocumentSignedUrl,
    ExtractedDataPatch,
    ExtractionJobRead,
)
from app.schemas.common import MessageResponse
from app.services import claim_service, document_service

router = APIRouter(tags=["Documents & Extraction"])

_STAFF_ROLES = (UserRole.ADMIN, UserRole.SENIOR_ADJUSTER, UserRole.ADJUSTER)


def _is_staff(user: User) -> bool:
    return user.role in _STAFF_ROLES


def _forbid_patient(user: User) -> None:
    if user.role == UserRole.PATIENT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Patients cannot access claim documents")


async def _authorized_document(db, claim_id: uuid.UUID, doc_id: uuid.UUID, user: User) -> Document:
    """
    Load a document and enforce role-based access:
    staff can touch any document on the claim; hospital desk only their own organisation's.
    """
    _forbid_patient(user)
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
    _forbid_patient(current_user)
    await require_claim_access(db, claim_id, current_user)

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
    _forbid_patient(current_user)
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
    """Delete a document. Staff: any; hospital desk: only their organization's."""
    await _authorized_document(db, claim_id, doc_id, current_user)
    deleted = await document_service.delete_document(db, doc_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return {"message": f"Document {doc_id} deleted"}


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
    """
    await _authorized_document(db, claim_id, doc_id, current_user)
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
    current_user: AdjusterOrAbove,
):
    """Apply manual corrections to one document's extraction."""
    await _authorized_document(db, claim_id, doc_id, current_user)
    job = await document_service.get_document_extraction(db, doc_id)
    if not job:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No completed extraction for this document")
    job.corrected_payload = body.corrected_payload
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
