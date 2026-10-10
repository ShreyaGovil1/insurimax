"""
Claims core routes.

POST   /claims
GET    /claims
GET    /claims/{claimId}
PATCH  /claims/{claimId}/status
POST   /claims/{claimId}/submit
DELETE /claims/{claimId}          (hospital: delete draft; admin: void)
GET    /claims/{claimId}/sla
GET    /claims/{claimId}/summary
GET    /claims/{claimId}/audit-report
"""
import math
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from fastapi.responses import JSONResponse

from app.core.access import STAFF_ROLES, insurer_scope, require_claim_access, require_hospital_desk
from app.core.deps import AdjusterOrAbove, CurrentUser, DBSession
from app.models.claim import ClaimStatus
from app.models.user import OrgType, UserRole
from app.schemas.claim import (
    ClaimAggregateSummary,
    ClaimCreate,
    ClaimRead,
    ClaimStatusUpdate,
    ClaimSummary,
    SLAStatus,
)
from app.schemas.common import MessageResponse, PaginatedResponse
from app.services import claim_service, user_service

router = APIRouter(prefix="/claims", tags=["Claims"])

# Statuses only the hospital moves a claim through (create -> draft, submit -> submitted).
_HOSPITAL_OWNED_STATUSES = (ClaimStatus.DRAFT, ClaimStatus.SUBMITTED)
# Retired statuses: kept in the enum for old history rows, never set again.
_RETIRED_STATUSES = (ClaimStatus.ESCALATED, ClaimStatus.STALE)


@router.post("", response_model=ClaimRead, status_code=status.HTTP_201_CREATED)
async def create_claim(
    body: ClaimCreate,
    db: DBSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """
    Create a new claim as a DRAFT. The hospital then attaches documents and calls
    POST /claims/{id}/submit, which hands it to the insurer and starts the 3-hour IRDAI SLA.
    Hospital desk only; the claim is stamped with the creator's hospital organization.
    """
    if current_user.role != UserRole.HOSPITAL_DESK:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Only hospital desk users can create claims"
        )
    org = (
        await user_service.get_organization(db, current_user.org_id)
        if current_user.org_id
        else None
    )
    if org is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Your account is not linked to a hospital organization",
        )
    insurer = (
        await user_service.get_organization(db, body.insurer_org_id) if body.insurer_org_id else None
    )
    if insurer is None or insurer.org_type != OrgType.INSURER or not insurer.is_active:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Select a valid insurer for this claim"
        )
    # The claim always belongs to the creator's hospital; the client cannot choose it.
    body = body.model_copy(
        update={
            "hospital_org_id": org.id,
            "hospital_name": org.name,
            "insurer_name": insurer.name,
        }
    )

    claim = await claim_service.create_claim(db, body, current_user.id)
    return claim


@router.get("/insurers")
async def list_insurers(db: DBSession, current_user: CurrentUser):
    """Active insurer organizations a claim can be filed against."""
    orgs = await user_service.list_organizations(db)
    return [
        {"id": str(o.id), "name": o.name}
        for o in orgs
        if o.org_type == OrgType.INSURER and o.is_active
    ]


@router.get("", response_model=PaginatedResponse[ClaimSummary])
async def list_claims(
    db: DBSession,
    current_user: CurrentUser,
    claim_status: ClaimStatus | None = Query(None, alias="status"),
    hospital_org_id: uuid.UUID | None = Query(None),
    sla_remaining_lt_minutes: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """
    List claims with optional filters.
    Adjusters and admins see every claim in their insurer scope; hospital desk only its own.
    """
    if current_user.role == UserRole.HOSPITAL_DESK:
        if current_user.org_id is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not linked to a hospital organization")
        hospital_org_id = current_user.org_id  # ignore any client-supplied filter
    elif current_user.role not in STAFF_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not allowed to list claims")
    insurer_org_id = await insurer_scope(db, current_user)

    claims, total = await claim_service.list_claims(
        db,
        status=claim_status,
        hospital_org_id=hospital_org_id,
        insurer_org_id=insurer_org_id,
        sla_remaining_lt_minutes=sla_remaining_lt_minutes,
        exclude_drafts=current_user.role != UserRole.HOSPITAL_DESK,  # insurer sees submitted claims only
        page=page,
        page_size=page_size,
    )

    # Build summary items — merge adjudication flagged count if available
    summaries: list[ClaimSummary] = []
    for c in claims:
        # adjudication_result is now eagerly loaded by list_claims — access it
        # directly from the instance dict to avoid any lazy-load attempt.
        adj = c.__dict__.get("adjudication_result")
        has_mismatch = False
        if adj and adj.gemini_raw_response:
            flags = adj.gemini_raw_response.get("flags") or []
            has_mismatch = any("IDENTITY MISMATCH" in str(f) for f in flags)
        summaries.append(
            ClaimSummary(
                id=c.id,
                claim_number=c.claim_number,
                patient_name=c.patient_name,
                hospital_name=c.hospital_name,
                billed_amount=c.billed_amount,
                approved_amount=c.approved_amount,
                status=c.status,
                ai_confidence_score=c.ai_confidence_score,
                flagged_items_count=adj.flagged_items_count if adj else None,
                sla_deadline=c.sla_deadline,
                sla_breached=c.sla_breached,
                submitted_at=c.submitted_at,
                has_identity_mismatch=has_mismatch,
            )
        )

    return PaginatedResponse(
        items=summaries,
        total=total,
        page=page,
        page_size=page_size,
        pages=math.ceil(total / page_size) if total else 0,
    )


@router.get("/{claim_id}", response_model=ClaimRead)
async def get_claim(claim_id: uuid.UUID, db: DBSession, current_user: CurrentUser):
    return await require_claim_access(db, claim_id, current_user)


@router.patch("/{claim_id}/status", response_model=ClaimRead)
async def update_claim_status(
    claim_id: uuid.UUID,
    body: ClaimStatusUpdate,
    db: DBSession,
    current_user: AdjusterOrAbove,
):
    """Transition a claim to a new status (with audit history)."""
    await require_claim_access(db, claim_id, current_user)
    if body.status in _RETIRED_STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"'{body.status.value}' is no longer a valid status")
    if body.status in _HOSPITAL_OWNED_STATUSES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Draft and submitted states are controlled by the hospital",
        )
    claim = await claim_service.update_claim_status(db, claim_id, body, current_user.id)
    if not claim:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")
    return claim


@router.post("/{claim_id}/submit", response_model=ClaimRead)
async def submit_claim(claim_id: uuid.UUID, db: DBSession, current_user: CurrentUser):
    """
    Hospital submits a drafted claim once its documents are attached.
    Only now does the claim reach the insurer, and only now does the IRDAI SLA clock start.
    """
    require_hospital_desk(current_user, "submit claims")
    claim = await require_claim_access(db, claim_id, current_user)
    if claim.status != ClaimStatus.DRAFT:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This claim has already been submitted")
    if not claim.documents:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Attach at least one document before submitting the claim",
        )
    return await claim_service.submit_claim(db, claim, current_user.id)


@router.delete("/{claim_id}", response_model=MessageResponse)
async def delete_or_void_claim(
    claim_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Hospital desk: permanently delete its own claim while it is still a draft. Once submitted,
    the claim belongs to the insurer's review and can no longer be deleted by the hospital.
    Admin: soft-void a claim (sets status to REJECTED).
    """
    if current_user.role == UserRole.HOSPITAL_DESK:
        claim = await require_claim_access(db, claim_id, current_user)
        if claim.status != ClaimStatus.DRAFT:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="Only draft claims can be deleted; this claim has already been submitted to the insurer",
            )
        number = claim.claim_number
        await claim_service.delete_claim(db, claim)
        return {"message": f"Claim {number} deleted"}

    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to delete claims")
    await require_claim_access(db, claim_id, current_user)

    update = ClaimStatusUpdate(status=ClaimStatus.REJECTED, note="Voided by admin")
    claim = await claim_service.update_claim_status(db, claim_id, update, current_user.id)
    if not claim:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")
    return {"message": f"Claim {claim_id} voided"}


@router.get("/{claim_id}/sla", response_model=SLAStatus)
async def get_claim_sla(claim_id: uuid.UUID, db: DBSession, current_user: CurrentUser):
    """
    Real-time SLA status for a claim.
    breach_risk=True means < 30 minutes remaining.
    """
    await require_claim_access(db, claim_id, current_user)
    sla = await claim_service.get_sla_status(db, claim_id)
    if not sla:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")
    return sla


@router.get("/{claim_id}/summary", response_model=ClaimAggregateSummary)
async def get_claim_summary(claim_id: uuid.UUID, db: DBSession, current_user: CurrentUser):
    """
    Phase 4 summary bar: billed → approved → deducted breakdown.
    """
    await require_claim_access(db, claim_id, current_user)
    summary = await claim_service.get_claim_aggregate_summary(db, claim_id)
    if not summary:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")
    return summary


@router.get("/{claim_id}/audit-report")
async def get_audit_report(claim_id: uuid.UUID, db: DBSession, current_user: CurrentUser):
    """
    Return a structured, compliance-ready audit report for a finalized claim.
    Includes every line item, decision, citation, override, and timestamp.
    """
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.models.claim import Claim
    from app.models.adjudication import AdjudicationResult

    claim = await require_claim_access(db, claim_id, current_user)

    adj_result = await db.execute(
        select(AdjudicationResult)
        .where(AdjudicationResult.claim_id == claim_id)
        .options(selectinload(AdjudicationResult.line_items))
    )
    adj = adj_result.scalar_one_or_none()

    report = {
        "report_generated_at": datetime.now(timezone.utc).isoformat(),
        "claim": {
            "id": str(claim.id),
            "claim_number": claim.claim_number,
            "patient_name": claim.patient_name,
            "hospital_name": claim.hospital_name,
            "insurer_name": claim.insurer_name,
            "status": claim.status.value,
            "submitted_at": claim.submitted_at.isoformat() if claim.submitted_at else None,
            "finalized_at": claim.finalized_at.isoformat() if claim.finalized_at else None,
            "sla_deadline": claim.sla_deadline.isoformat() if claim.sla_deadline else None,
            "sla_breached": claim.sla_breached,
        },
        "adjudication": {
            "total_billed_inr": adj.total_billed_inr if adj else None,
            "total_approved_inr": adj.total_approved_inr if adj else None,
            "total_deducted_inr": adj.total_deducted_inr if adj else None,
            "deduction_breakdown": adj.deduction_breakdown if adj else None,
            "confidence_score": adj.confidence_score if adj else None,
            "auto_approved": adj.auto_approved if adj else False,
            "finalized_at": adj.finalized_at.isoformat() if adj and adj.finalized_at else None,
        },
        "line_items": [
            {
                "line_number": li.line_number,
                "item_name": li.item_name,
                "item_category": li.item_category,
                "billed_amount_inr": li.billed_amount_inr,
                "approved_amount_inr": li.approved_amount_inr,
                "deducted_amount_inr": li.deducted_amount_inr,
                "ai_status": li.ai_status.value,
                "final_status": li.final_status.value,
                "ai_explanation": li.ai_explanation,
                "citation_data": li.citation_data,
                "is_overridden": li.is_overridden,
                "override_reason": li.override_reason.value if li.override_reason else None,
                "override_note": li.override_note,
            }
            for li in (adj.line_items if adj else [])
        ],
        "status_history": [
            {
                "from_status": h.from_status.value if h.from_status else None,
                "to_status": h.to_status.value,
                "note": h.note,
                "created_at": h.created_at.isoformat(),
            }
            for h in claim.status_history
        ],
    }
    return JSONResponse(content=report)
