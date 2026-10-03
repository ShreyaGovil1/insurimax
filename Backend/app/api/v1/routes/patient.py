"""
Patient-facing claim status routes (minimal PII exposure, public token-based).

GET    /patient/claims/{claimId}/status
POST   /patient/claims/{claimId}/notifications/subscribe
"""
import uuid

from fastapi import APIRouter, HTTPException, status

import app.models  # noqa: F401 - ensure all ORM relationships are registered
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


@router.get("/claims/{claim_id}/bima-bharosa-payload")
async def get_bima_bharosa_payload_endpoint(
    claim_id: uuid.UUID,
    db: DBSession,
    issue_type: str = "discharge_delay",
):
    """
    Generate an IRDAI Bima Bharosa complaint autofill payload.
    Maps claim data into the exact 5-section schema required by Bima Bharosa.
    """
    from app.services.bima_bharosa_service import generate_bima_bharosa_payload

    claim = await claim_service.get_claim(db, claim_id)
    if not claim:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")

    claim_dict = {
        "claim_number": claim.claim_number,
        "policy_number": claim.policy_number,
        "patient_name": claim.patient_name,
        "patient_phone": claim.patient_phone,
        "hospital_name": claim.hospital_name,
        "insurer_name": claim.insurer_name,
        "billed_amount": claim.billed_amount,
        "approved_amount": claim.approved_amount,
        "deducted_amount": claim.deducted_amount,
        "status": claim.status.value,
    }

    payload = generate_bima_bharosa_payload(claim_dict, issue_type=issue_type)
    return payload.model_dump()


@router.post("/claims/{claim_id}/bima-bharosa-autofill")
async def trigger_bima_bharosa_autofill_agent(
    claim_id: uuid.UUID,
    db: DBSession,
    issue_type: str = "discharge_delay",
    headless: bool = False,
):
    """
    Launch the autonomous browser agent to navigate to Bima Bharosa
    and fill out the grievance form for the specified claim.
    """
    from app.services.bima_bharosa_service import run_bima_bharosa_agent

    import traceback, logging
    logger = logging.getLogger(__name__)

    try:
        claim = await claim_service.get_claim(db, claim_id)
        if not claim:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")

        claim_dict = {
            "claim_number": claim.claim_number,
            "policy_number": claim.policy_number,
            "patient_name": claim.patient_name,
            "patient_phone": claim.patient_phone,
            "hospital_name": claim.hospital_name,
            "insurer_name": claim.insurer_name,
            "billed_amount": claim.billed_amount,
            "approved_amount": claim.approved_amount,
            "deducted_amount": claim.deducted_amount,
            "status": claim.status.value,
        }

        result = await run_bima_bharosa_agent(claim_dict, issue_type=issue_type, headless=headless)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error in trigger_bima_bharosa_autofill_agent: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Browser automation agent error: {str(exc)}",
        )




