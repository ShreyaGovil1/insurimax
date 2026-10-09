"""
Documents & Extraction routes.

POST   /claims/{claimId}/documents
GET    /claims/{claimId}/documents
GET    /claims/{claimId}/documents/{documentId}
DELETE /claims/{claimId}/documents/{documentId}
POST   /claims/{claimId}/documents/{documentId}/extract
GET    /extraction-jobs/{jobId}
GET    /claims/{claimId}/extracted-data
PATCH  /claims/{claimId}/extracted-data
"""
import uuid

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile, status

from app.core.deps import AdjusterOrAbove, CurrentUser, DBSession
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
    docs = await document_service.list_claim_documents(db, claim_id)
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
    current_user: AdjusterOrAbove,
):
    """Delete a document from GCS and DB."""
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
    current_user: AdjusterOrAbove,
):
    """
    Trigger Gemini extraction for a single document.
    Runs synchronously in this request (for hackathon simplicity).
    In production, push to Cloud Tasks / Pub/Sub.
    """
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
