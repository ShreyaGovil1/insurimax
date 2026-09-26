"""
Patient-facing claim status routes (minimal PII exposure, public token-based).

GET    /patient/claims/{claimId}/status
POST   /patient/claims/{claimId}/notifications/subscribe
"""
import uuid

from fastapi import APIRouter, HTTPException, status

from app.core.deps import DBSession
from app.services import claim_service

router = APIRouter(prefix="/patient", tags=["Patient Status"])


@router.get("/claims/{claim_id}/status")
async def get_patient_claim_status(
    claim_id: uuid.UUID,
    db: DBSession,
):
    """
    Public tokenized endpoint — minimal PII exposure.
    Returns only the status and approved amount; no names, policy numbers, or adjudication details.
    In production, protect with a short-lived one-time token sent via SMS/email.
    """
    claim = await claim_service.get_claim(db, claim_id)
    if not claim:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")

    # Map internal statuses to patient-friendly messages
    status_messages = {
        "submitted": "Your claim has been received and is being reviewed.",
        "documents_pending": "Additional documents are needed for your claim.",
        "in_review": "Your claim is currently under review.",
        "extraction_in_progress": "Your claim documents are being processed.",
        "adjudication_in_progress": "Your claim is being evaluated.",
        "queried": "We have sent a query to your hospital for clarification.",
        "escalated": "Your claim has been referred to a senior reviewer.",
        "auto_approved": "Your claim has been approved.",
        "approved": "Your claim has been approved.",
        "partially_approved": "Your claim has been partially approved.",
        "rejected": "Your claim could not be approved. Please contact your TPA.",
        "finalized": "Your claim has been finalized.",
    }

    return {
        "claim_id": str(claim.id),
        "status": claim.status.value,
        "status_message": status_messages.get(
            claim.status.value, "Your claim is being processed."
        ),
        "approved_amount_inr": claim.approved_amount,
        "submitted_at": claim.submitted_at.isoformat(),
        "last_updated": claim.updated_at.isoformat(),
        # Deliberately omit: patient_name, policy_number, hospital details, adjudication breakdown
    }


@router.post("/claims/{claim_id}/notifications/subscribe", status_code=status.HTTP_201_CREATED)
async def subscribe_to_notifications(
    claim_id: uuid.UUID,
    db: DBSession,
    email: str | None = None,
    phone: str | None = None,
):
    """
    Opt in to SMS/email status updates for a claim.
    In production, integrate with Cloud Tasks + SendGrid / SMS gateway.
    """
    if not email and not phone:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one of email or phone is required",
        )

    claim = await claim_service.get_claim(db, claim_id)
    if not claim:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")

    return {
        "message": "Notification subscription created",
        "claim_id": str(claim_id),
        "channels": {
            "email": email is not None,
            "sms": phone is not None,
        },
    }
