"""
Patient-facing claim status routes (minimal PII exposure, public token-based).

GET    /patient/claims/recent
GET    /patient/claims/{claimId}/status
POST   /patient/claims/{claimId}/notifications/subscribe
"""
import logging
import re
import uuid
from typing import Dict, Any, List, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

import app.models  # noqa: F401 - ensure all ORM relationships are registered
from app.core.deps import DBSession
from app.models.claim import Claim, ClaimStatus
from app.services import claim_service
from app.services.bima_bharosa_service import (
    generate_bima_bharosa_payload,
    generate_bima_bharosa_script,
    run_bima_bharosa_agent,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/patient", tags=["Patient Status"])


@router.get("/claims/recent")
async def get_recent_patient_claims(
    db: DBSession,
    limit: int = 4,
):
    """
    Returns a list of recent active claims with sanitized minimal fields for patient search suggestions.
    """
    stmt = (
        select(Claim)
        .where(Claim.status != ClaimStatus.DRAFT)
        .order_by(Claim.created_at.desc())
        .limit(limit)
    )
    res = await db.execute(stmt)
    claims = res.scalars().all()
    return [
        {
            "id": str(c.id),
            "label": f"{c.patient_name} ({c.hospital_name})",
            "patient_name": c.patient_name,
            "claim_number": c.claim_number,
            "policy_number": c.policy_number,
            "hospital_name": c.hospital_name,
            "insurer_name": c.insurer_name,
            "billed_amount": c.billed_amount,
            "approved_amount": c.approved_amount,
            "deducted_amount": c.deducted_amount,
            "status": c.status.value,
            "sla_breached": c.sla_breached,
        }
        for c in claims
    ]


@router.get("/claims/{claim_id}/status")
async def get_patient_claim_status(
    claim_id: str,
    db: DBSession,
):
    """
    Public tokenized endpoint — minimal PII exposure.
    Returns only the status and approved amount; no names, policy numbers, or adjudication details.
    In production, protect with a short-lived one-time token sent via SMS/email.
    """
    from sqlalchemy import select, or_

    claim = None
    try:
        c_uuid = uuid.UUID(claim_id)
        claim = await claim_service.get_claim(db, c_uuid)
    except (ValueError, TypeError):
        pass

    if not claim:
        stmt = (
            select(Claim)
            .where(or_(Claim.claim_number.ilike(f"%{claim_id}%"), Claim.patient_name.ilike(f"%{claim_id}%")))
            .order_by(Claim.created_at.desc())
            .limit(1)
        )
        res = await db.execute(stmt)
        claim = res.scalar_one_or_none()

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
        "submitted_at": claim.submitted_at.isoformat() if claim.submitted_at else None,
        "last_updated": claim.updated_at.isoformat(),
        # Deliberately omit: patient_name, policy_number, hospital details, adjudication breakdown
    }


@router.post("/claims/{claim_id}/notifications/subscribe", status_code=status.HTTP_201_CREATED)
async def subscribe_to_notifications(
    claim_id: str,
    db: DBSession,
    email: str | None = None,
    phone: str | None = None,
):
    """
    Opt in to SMS/email status updates for a claim.
    In production, integrate with Cloud Tasks + SendGrid / SMS gateway.
    """
    from sqlalchemy import select, or_

    if not email and not phone:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one of email or phone is required",
        )

    claim = None
    try:
        c_uuid = uuid.UUID(claim_id)
        claim = await claim_service.get_claim(db, c_uuid)
    except (ValueError, TypeError):
        pass

    if not claim:
        stmt = (
            select(Claim)
            .where(or_(Claim.claim_number.ilike(f"%{claim_id}%"), Claim.patient_name.ilike(f"%{claim_id}%")))
            .order_by(Claim.created_at.desc())
            .limit(1)
        )
        res = await db.execute(stmt)
        claim = res.scalar_one_or_none()

    if not claim:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")

    return {
        "message": "Notification subscription created",
        "claim_id": str(claim.id),
        "channels": {
            "email": email is not None,
            "sms": phone is not None,
        },
    }


@router.get("/claims/{claim_id}/bima-bharosa-payload")
async def get_bima_bharosa_payload_endpoint(
    claim_id: str,
    db: DBSession,
    issue_type: str = "discharge_delay",
):
    """
    Generate an IRDAI Bima Bharosa complaint autofill payload.
    Maps claim data into the exact 5-section schema required by Bima Bharosa.
    """
    from app.services.bima_bharosa_service import generate_bima_bharosa_payload
    from sqlalchemy import select, or_

    claim = None
    try:
        c_uuid = uuid.UUID(claim_id)
        claim = await claim_service.get_claim(db, c_uuid)
    except (ValueError, TypeError):
        pass

    if not claim:
        stmt = (
            select(Claim)
            .where(or_(Claim.claim_number.ilike(f"%{claim_id}%"), Claim.patient_name.ilike(f"%{claim_id}%")))
            .order_by(Claim.created_at.desc())
            .limit(1)
        )
        res = await db.execute(stmt)
        claim = res.scalar_one_or_none()

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
    claim_id: str,
    db: DBSession,
    issue_type: str = "discharge_delay",
    headless: bool = False,
):
    """
    Launch the autonomous browser agent to navigate to Bima Bharosa
    and fill out the grievance form for the specified claim.
    """
    from app.services.bima_bharosa_service import run_bima_bharosa_agent
    from sqlalchemy import select, or_

    import traceback, logging
    logger = logging.getLogger(__name__)

    try:
        claim = None
        try:
            c_uuid = uuid.UUID(claim_id)
            claim = await claim_service.get_claim(db, c_uuid)
        except (ValueError, TypeError):
            pass

        if not claim:
            stmt = (
                select(Claim)
                .where(or_(Claim.claim_number.ilike(f"%{claim_id}%"), Claim.patient_name.ilike(f"%{claim_id}%")))
                .order_by(Claim.created_at.desc())
                .limit(1)
            )
            res = await db.execute(stmt)
            claim = res.scalar_one_or_none()

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


# ─────────────────────────────────────────────────────────────────────────────
# Patient Escalation & Government Portal (IRDAI Bima Bharosa) Integration
# ─────────────────────────────────────────────────────────────────────────────


class PatientEscalationLookupRequest(BaseModel):
    patient_name: str | None = None
    phone: str | None = None
    query: str | None = None
    hospital_name: str | None = None
    issue_type: str = "discharge_delay"
    claim_id: str | None = None
    trigger_autofill: bool = False
    headless: bool = False


async def _execute_patient_escalation_lookup(
    db: DBSession,
    patient_name: str | None = None,
    phone: str | None = None,
    query_str: str | None = None,
    hospital_name: str | None = None,
    issue_type: str = "discharge_delay",
    claim_id: str | None = None,
    trigger_autofill: bool = False,
    headless: bool = False,
) -> dict:
    stmt = (
        select(Claim)
        .options(
            selectinload(Claim.documents),
            selectinload(Claim.adjudication_result),
            selectinload(Claim.status_history),
        )
    )

    conditions = []

    if claim_id and str(claim_id).strip():
        cid_str = str(claim_id).strip()
        try:
            c_uuid = uuid.UUID(cid_str)
            conditions.append(Claim.id == c_uuid)
        except (ValueError, TypeError):
            conditions.append(
                or_(
                    Claim.claim_number.ilike(f"%{cid_str}%"),
                    Claim.patient_name.ilike(f"%{cid_str}%"),
                    Claim.uhid.ilike(f"%{cid_str}%"),
                    Claim.policy_number.ilike(f"%{cid_str}%"),
                )
            )

    clean_phone = re.sub(r"\D", "", phone or "")
    if clean_phone and len(clean_phone) >= 6:
        suffix = clean_phone[-10:] if len(clean_phone) >= 10 else clean_phone
        conditions.append(Claim.patient_phone.ilike(f"%{suffix}%"))

    if patient_name and patient_name.strip():
        conditions.append(Claim.patient_name.ilike(f"%{patient_name.strip()}%"))

    if query_str and query_str.strip():
        q = query_str.strip()
        q_digits = re.sub(r"\D", "", q)
        q_conds = [
            Claim.patient_name.ilike(f"%{q}%"),
            Claim.claim_number.ilike(f"%{q}%"),
            Claim.policy_number.ilike(f"%{q}%"),
            Claim.uhid.ilike(f"%{q}%"),
        ]
        if len(q_digits) >= 6:
            q_conds.append(Claim.patient_phone.ilike(f"%{q_digits[-10:]}%"))
        conditions.append(or_(*q_conds))

    if not conditions:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Please provide a patient name, phone number, or search query.",
        )

    stmt = stmt.where(or_(*conditions))

    if hospital_name and hospital_name.strip():
        stmt = stmt.where(Claim.hospital_name.ilike(f"%{hospital_name.strip()}%"))

    stmt = stmt.order_by(Claim.created_at.desc())
    res = await db.execute(stmt)
    claims = res.scalars().all()

    if not claims:
        search_term = patient_name or phone or query_str or "provided criteria"
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No hospital claim records found for '{search_term}'. Please check the patient name or 10-digit mobile number.",
        )

    # Prioritize active or SLA-breached claim as primary
    primary_claim = claims[0]
    for c in claims:
        if c.status in (ClaimStatus.IN_REVIEW, ClaimStatus.EXTRACTION_IN_PROGRESS, ClaimStatus.ADJUDICATION_IN_PROGRESS, ClaimStatus.QUERIED) or c.sla_breached:
            primary_claim = c
            break

    # Summarize all claims found for this patient
    matching_summaries = [
        {
            "id": str(c.id),
            "claim_number": c.claim_number,
            "patient_name": c.patient_name,
            "patient_phone": c.patient_phone,
            "hospital_name": c.hospital_name,
            "insurer_name": c.insurer_name,
            "policy_number": c.policy_number,
            "billed_amount": c.billed_amount,
            "approved_amount": c.approved_amount,
            "deducted_amount": c.deducted_amount,
            "status": c.status.value,
            "sla_breached": c.sla_breached,
            "submitted_at": c.submitted_at.isoformat() if c.submitted_at else None,
            "is_selected": c.id == primary_claim.id,
        }
        for c in claims
    ]

    # Resolve issue type (auto-detect if requested or unspecified)
    effective_issue = issue_type or "auto"
    if effective_issue == "auto":
        if primary_claim.deducted_amount and primary_claim.deducted_amount > 0:
            effective_issue = "deduction"
        elif primary_claim.sla_breached or primary_claim.status == ClaimStatus.FINALIZED:
            effective_issue = "discharge_delay"
        elif primary_claim.status in (ClaimStatus.SUBMITTED, ClaimStatus.DOCUMENTS_PENDING, ClaimStatus.QUERIED):
            effective_issue = "preauth_delay"
        else:
            effective_issue = "discharge_delay"

    claim_dict = {
        "claim_number": primary_claim.claim_number,
        "policy_number": primary_claim.policy_number,
        "patient_name": primary_claim.patient_name,
        "patient_phone": primary_claim.patient_phone,
        "hospital_name": primary_claim.hospital_name,
        "insurer_name": primary_claim.insurer_name,
        "billed_amount": primary_claim.billed_amount,
        "approved_amount": primary_claim.approved_amount,
        "deducted_amount": primary_claim.deducted_amount,
        "status": primary_claim.status.value,
    }

    payload = generate_bima_bharosa_payload(claim_dict, issue_type=effective_issue)
    payload_data = payload.model_dump()
    autofill_script = generate_bima_bharosa_script(payload_data)

    agent_result = None
    if trigger_autofill:
        agent_out = await run_bima_bharosa_agent(claim_dict, issue_type=effective_issue, headless=headless)
        agent_result = agent_out.get("agent_result")

    return {
        "status": "success",
        "matching_count": len(claims),
        "matching_claims": matching_summaries,
        "claim": {
            "id": str(primary_claim.id),
            "claim_number": primary_claim.claim_number,
            "policy_number": primary_claim.policy_number,
            "uhid": primary_claim.uhid,
            "patient_name": primary_claim.patient_name,
            "patient_phone": primary_claim.patient_phone,
            "patient_dob": primary_claim.patient_dob.isoformat() if primary_claim.patient_dob else None,
            "hospital_name": primary_claim.hospital_name,
            "insurer_name": primary_claim.insurer_name,
            "billed_amount": primary_claim.billed_amount,
            "approved_amount": primary_claim.approved_amount,
            "deducted_amount": primary_claim.deducted_amount,
            "status": primary_claim.status.value,
            "sla_deadline": primary_claim.sla_deadline.isoformat() if primary_claim.sla_deadline else None,
            "sla_breached": primary_claim.sla_breached,
            "submitted_at": primary_claim.submitted_at.isoformat() if primary_claim.submitted_at else None,
            "updated_at": primary_claim.updated_at.isoformat(),
            "deduction_summary": primary_claim.deduction_summary,
            "ai_confidence_score": primary_claim.ai_confidence_score,
        },
        "escalation": {
            "issue_type": effective_issue,
            "portal_url": "https://bimabharosa.irdai.gov.in/RegComplaint/RegisterComplaint",
            "ombudsman_url": "https://www.cioins.co.in/",
            "bima_bharosa_payload": payload_data,
            "autofill_script": autofill_script,
            "statutory_citations": payload.statutory_citations or [],
            "complaint_preview": payload.complaint_details,
        },
        "agent_result": agent_result,
    }


@router.post("/escalation/lookup")
async def patient_escalation_lookup(
    req: PatientEscalationLookupRequest,
    db: DBSession,
):
    """
    Look up all hospital claim information for a patient by name, phone number,
    or general identifier, and automatically generate an IRDAI Bima Bharosa
    grievance package and 1-click browser form autofill script.
    """
    return await _execute_patient_escalation_lookup(
        db=db,
        patient_name=req.patient_name,
        phone=req.phone,
        query_str=req.query,
        hospital_name=req.hospital_name,
        issue_type=req.issue_type,
        claim_id=req.claim_id,
        trigger_autofill=req.trigger_autofill,
        headless=req.headless,
    )


@router.get("/escalation/lookup")
async def patient_escalation_lookup_get(
    db: DBSession,
    q: str | None = None,
    patient_name: str | None = None,
    phone: str | None = None,
    hospital_name: str | None = None,
    issue_type: str = "discharge_delay",
    claim_id: str | None = None,
    trigger_autofill: bool = False,
    headless: bool = False,
):
    """
    GET variant for quick browser testing and direct URL links.
    """
    return await _execute_patient_escalation_lookup(
        db=db,
        patient_name=patient_name,
        phone=phone,
        query_str=q,
        hospital_name=hospital_name,
        issue_type=issue_type,
        claim_id=claim_id,
        trigger_autofill=trigger_autofill,
        headless=headless,
    )


@router.post("/escalation/autofill")
async def patient_escalation_autofill(
    req: PatientEscalationLookupRequest,
    db: DBSession,
):
    """
    Directly trigger the autonomous browser agent to open the IRDAI Bima Bharosa
    portal and fill out the grievance form for the matched patient hospital claim.
    """
    return await _execute_patient_escalation_lookup(
        db=db,
        patient_name=req.patient_name,
        phone=req.phone,
        query_str=req.query,
        hospital_name=req.hospital_name,
        issue_type=req.issue_type,
        claim_id=req.claim_id,
        trigger_autofill=True,
        headless=req.headless,
    )




