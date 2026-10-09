"""
Claim service — business logic for creating, listing, and managing claims.
"""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.claim import Claim, ClaimStatus, ClaimStatusHistory
from app.models.adjudication import AdjudicationResult
from app.schemas.claim import ClaimCreate, ClaimStatusUpdate


def _generate_claim_number() -> str:
    """Generate a human-readable claim reference number."""
    now = datetime.now(timezone.utc)
    suffix = str(uuid.uuid4())[:6].upper()
    return f"DP-{now.strftime('%Y%m%d')}-{suffix}"


async def create_claim(db: AsyncSession, data: ClaimCreate, created_by_id: uuid.UUID) -> Claim:
    claim = Claim(
        claim_number=_generate_claim_number(),
        patient_name=data.patient_name,
        patient_dob=data.patient_dob,
        patient_phone=data.patient_phone,
        hospital_name=data.hospital_name,
        hospital_org_id=data.hospital_org_id,
        insurer_name=data.insurer_name,
        insurer_org_id=data.insurer_org_id,
        tpa_org_id=data.tpa_org_id,
        policy_number=data.policy_number,
        uhid=data.uhid,
        policy_version_id=data.policy_version_id,
        billed_amount=data.billed_amount,
        adjuster_notes=data.adjuster_notes,
        status=ClaimStatus.SUBMITTED,
        sla_deadline=datetime.now(timezone.utc) + timedelta(hours=settings.SLA_HOURS),
    )
    db.add(claim)
    await db.flush()

    # Record initial status history
    history = ClaimStatusHistory(
        claim_id=claim.id,
        from_status=None,
        to_status=ClaimStatus.SUBMITTED,
        changed_by_id=created_by_id,
        note="Claim created",
    )
    db.add(history)
    await db.flush()
    return claim


async def get_claim(db: AsyncSession, claim_id: uuid.UUID) -> Claim | None:
    result = await db.execute(
        select(Claim)
        .where(Claim.id == claim_id)
        .options(
            selectinload(Claim.documents),
            selectinload(Claim.adjudication_result),
            selectinload(Claim.status_history),
        )
    )
    return result.scalar_one_or_none()


async def list_claims(
    db: AsyncSession,
    status: ClaimStatus | None = None,
    hospital_org_id: uuid.UUID | None = None,
    insurer_org_id: uuid.UUID | None = None,
    assigned_adjuster_id: uuid.UUID | None = None,
    sla_remaining_lt_minutes: int | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Claim], int]:
    query = select(Claim)

    if status:
        query = query.where(Claim.status == status)
    if hospital_org_id:
        query = query.where(Claim.hospital_org_id == hospital_org_id)
    if insurer_org_id:
        query = query.where(Claim.insurer_org_id == insurer_org_id)
    if assigned_adjuster_id:
        query = query.where(Claim.assigned_adjuster_id == assigned_adjuster_id)
    if sla_remaining_lt_minutes is not None:
        deadline_threshold = datetime.now(timezone.utc) + timedelta(minutes=sla_remaining_lt_minutes)
        query = query.where(Claim.sla_deadline <= deadline_threshold)

    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    query = (
        query
        .options(selectinload(Claim.adjudication_result))
        .order_by(Claim.sla_deadline.asc().nulls_last())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    result = await db.execute(query)
    return result.scalars().all(), total


async def update_claim_status(
    db: AsyncSession,
    claim_id: uuid.UUID,
    update_data: ClaimStatusUpdate,
    changed_by_id: uuid.UUID,
) -> Claim | None:
    claim = await get_claim(db, claim_id)
    if not claim:
        return None

    old_status = claim.status
    claim.status = update_data.status

    history = ClaimStatusHistory(
        claim_id=claim.id,
        from_status=old_status,
        to_status=update_data.status,
        changed_by_id=changed_by_id,
        note=update_data.note,
    )
    db.add(history)
    await db.flush()
    return claim


async def get_sla_status(db: AsyncSession, claim_id: uuid.UUID) -> dict | None:
    claim = await get_claim(db, claim_id)
    if not claim:
        return None

    now = datetime.now(timezone.utc)
    remaining_seconds = None
    remaining_minutes = None
    breach_risk = False

    if claim.sla_deadline:
        delta = claim.sla_deadline - now
        remaining_seconds = max(0, int(delta.total_seconds()))
        remaining_minutes = remaining_seconds // 60
        breach_risk = remaining_minutes < settings.SLA_WARNING_MINUTES

    return {
        "claim_id": claim.id,
        "sla_deadline": claim.sla_deadline,
        "remaining_seconds": remaining_seconds,
        "remaining_minutes": remaining_minutes,
        "breach_risk": breach_risk,
        "sla_breached": claim.sla_breached,
    }


async def get_claim_aggregate_summary(db: AsyncSession, claim_id: uuid.UUID) -> dict | None:
    claim = await get_claim(db, claim_id)
    if not claim:
        return None

    result = await db.execute(
        select(AdjudicationResult).where(AdjudicationResult.claim_id == claim_id)
    )
    adj = result.scalar_one_or_none()

    return {
        "claim_id": claim.id,
        "total_billed_inr": claim.billed_amount or 0,
        "total_approved_inr": (adj.total_approved_inr if adj else None) or 0,
        "total_deducted_inr": (adj.total_deducted_inr if adj else None) or 0,
        "deduction_breakdown": adj.deduction_breakdown if adj else None,
        "flagged_items_count": adj.flagged_items_count if adj else 0,
        "non_payable_items_count": adj.non_payable_items_count if adj else 0,
        "ai_confidence_score": adj.confidence_score if adj else None,
    }


async def assign_adjuster(
    db: AsyncSession, claim_id: uuid.UUID, adjuster_id: uuid.UUID
) -> Claim | None:
    claim = await get_claim(db, claim_id)
    if not claim:
        return None
    claim.assigned_adjuster_id = adjuster_id
    await db.flush()
    return claim


async def check_and_update_sla_breach(db: AsyncSession) -> int:
    """Background-friendly: mark all overdue claims as sla_breached=True. Returns count."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        update(Claim)
        .where(Claim.sla_deadline <= now, Claim.sla_breached == False)  # noqa: E712
        .values(sla_breached=True)
        .returning(Claim.id)
    )
    rows = result.fetchall()
    return len(rows)
