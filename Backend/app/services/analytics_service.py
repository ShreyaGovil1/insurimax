"""
Analytics, compliance reporting, and adjuster digest service.
"""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.adjudication import AdjudicationResult, LineItemDecision, OverrideReason
from app.models.claim import Claim, ClaimStatus
from app.models.user import User


async def get_adjuster_daily_digest(
    db: AsyncSession, adjuster_id: uuid.UUID, date: datetime | None = None
) -> dict:
    """Phase 7 — daily performance digest for an adjuster."""
    target_date = date or datetime.now(timezone.utc)
    day_start = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    # Claims finalized today by this adjuster
    finalized_result = await db.execute(
        select(Claim).where(
            Claim.assigned_adjuster_id == adjuster_id,
            Claim.finalized_at >= day_start,
            Claim.finalized_at < day_end,
        )
    )
    finalized_claims = finalized_result.scalars().all()
    cases_processed = len(finalized_claims)

    total_value = sum(c.approved_amount or 0 for c in finalized_claims)

    # SLA compliance
    sla_compliant = sum(1 for c in finalized_claims if not c.sla_breached)
    sla_rate = (sla_compliant / cases_processed * 100) if cases_processed > 0 else 100.0

    # Average minutes per case
    durations = []
    for c in finalized_claims:
        if c.finalized_at and c.submitted_at:
            delta = c.finalized_at - c.submitted_at
            durations.append(delta.total_seconds() / 60)
    avg_minutes = sum(durations) / len(durations) if durations else 0

    # Override count
    override_result = await db.execute(
        select(func.count(LineItemDecision.id)).where(
            LineItemDecision.overridden_by_id == adjuster_id,
            LineItemDecision.overridden_at >= day_start,
            LineItemDecision.overridden_at < day_end,
        )
    )
    override_count = override_result.scalar_one() or 0

    return {
        "adjuster_id": adjuster_id,
        "date": target_date.date().isoformat(),
        "cases_processed": cases_processed,
        "avg_minutes_per_case": round(avg_minutes, 1),
        "sla_compliance_rate": round(sla_rate, 1),
        "total_value_adjudicated_inr": round(total_value, 2),
        "override_count": override_count,
    }


async def get_adjuster_override_history(
    db: AsyncSession, adjuster_id: uuid.UUID, limit: int = 50
) -> list[dict]:
    """All overrides by this adjuster — feeds the pattern learning display."""
    result = await db.execute(
        select(LineItemDecision)
        .where(LineItemDecision.overridden_by_id == adjuster_id)
        .order_by(LineItemDecision.overridden_at.desc())
        .limit(limit)
    )
    items = result.scalars().all()
    return [
        {
            "item_id": str(i.id),
            "item_name": i.item_name,
            "ai_status": i.ai_status.value,
            "final_status": i.final_status.value,
            "override_reason": i.override_reason.value if i.override_reason else None,
            "override_note": i.override_note,
            "overridden_at": i.overridden_at.isoformat() if i.overridden_at else None,
        }
        for i in items
    ]


async def get_hospital_billing_patterns(
    db: AsyncSession, hospital_org_id: uuid.UUID
) -> dict:
    """Phase 6 — billing pattern flags for a hospital."""
    # Override history for this hospital's claims
    override_result = await db.execute(
        select(
            LineItemDecision.item_name,
            func.count(LineItemDecision.id).label("override_count"),
        )
        .join(
            AdjudicationResult,
            LineItemDecision.adjudication_result_id == AdjudicationResult.id,
        )
        .join(Claim, AdjudicationResult.claim_id == Claim.id)
        .where(
            Claim.hospital_org_id == hospital_org_id,
            LineItemDecision.is_overridden == True,  # noqa: E712
        )
        .group_by(LineItemDecision.item_name)
        .order_by(func.count(LineItemDecision.id).desc())
        .limit(10)
    )
    override_patterns = [
        {"item_name": row.item_name, "override_count": row.override_count}
        for row in override_result.fetchall()
    ]

    # Total claims and approval rate
    claim_stats = await db.execute(
        select(
            func.count(Claim.id).label("total"),
            func.avg(
                func.coalesce(Claim.approved_amount, 0)
                / func.nullif(Claim.billed_amount, 0)
            ).label("avg_approval_rate"),
        ).where(Claim.hospital_org_id == hospital_org_id)
    )
    row = claim_stats.fetchone()
    total_claims = row.total or 0
    avg_approval_rate = float(row.avg_approval_rate or 0) * 100

    return {
        "hospital_org_id": str(hospital_org_id),
        "total_claims": total_claims,
        "common_override_items": override_patterns,
        "avg_approval_rate": round(avg_approval_rate, 1),
        "anomaly_flags": _detect_anomaly_flags(override_patterns, avg_approval_rate),
    }


def _detect_anomaly_flags(override_patterns: list[dict], avg_approval_rate: float) -> list[str]:
    flags: list[str] = []
    if avg_approval_rate < 70:
        flags.append("Approval rate below 70% — review billing practices")
    for pattern in override_patterns:
        if pattern["override_count"] >= 3:
            flags.append(
                f"Item '{pattern['item_name']}' has {pattern['override_count']} prior overrides"
            )
    return flags


async def get_sla_compliance_report(
    db: AsyncSession,
    period_start: datetime,
    period_end: datetime,
    org_id: uuid.UUID | None = None,
) -> dict:
    query = select(Claim).where(
        Claim.submitted_at >= period_start,
        Claim.submitted_at < period_end,
    )
    if org_id:
        query = query.where(Claim.tpa_org_id == org_id)

    result = await db.execute(query)
    claims = result.scalars().all()

    total = len(claims)
    breached = sum(1 for c in claims if c.sla_breached)
    resolved_within_sla = total - breached
    compliance_rate = (resolved_within_sla / total * 100) if total > 0 else 100.0

    durations = []
    for c in claims:
        if c.finalized_at and c.submitted_at:
            durations.append((c.finalized_at - c.submitted_at).total_seconds() / 60)
    avg_resolution = sum(durations) / len(durations) if durations else 0

    return {
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "total_claims": total,
        "resolved_within_sla": resolved_within_sla,
        "sla_breached": breached,
        "sla_compliance_rate": round(compliance_rate, 1),
        "avg_resolution_minutes": round(avg_resolution, 1),
    }


async def get_queue(
    db: AsyncSession,
    adjuster_id: uuid.UUID | None = None,
    unassigned_only: bool = False,
    include_auto_approved: bool = True,
    include_finalized: bool = False,
    status_filter: ClaimStatus | None = None,
    hospital_org_id: uuid.UUID | None = None,
    insurer_org_id: uuid.UUID | None = None,
    exclude_drafts: bool = False,
) -> list[Claim]:
    """
    Returns claims sorted by SLA urgency.
    Keeps auto-approved and in-process claims visible in the active queue so they
    never disappear post-adjudication.
    """
    query = select(Claim).options(selectinload(Claim.adjudication_result))

    if status_filter:
        query = query.where(Claim.status == status_filter)
    else:
        excluded = [ClaimStatus.REJECTED]
        if not include_finalized:
            excluded.append(ClaimStatus.FINALIZED)
        if not include_auto_approved:
            excluded.append(ClaimStatus.AUTO_APPROVED)
        query = query.where(Claim.status.not_in(excluded))

    if exclude_drafts:
        query = query.where(Claim.status != ClaimStatus.DRAFT)
    if hospital_org_id:
        query = query.where(Claim.hospital_org_id == hospital_org_id)
    if insurer_org_id:
        query = query.where(Claim.insurer_org_id == insurer_org_id)

    if unassigned_only:
        query = query.where(Claim.assigned_adjuster_id == None)  # noqa: E711
    elif adjuster_id:
        query = query.where(Claim.assigned_adjuster_id == adjuster_id)

    query = (
        query
        .options(selectinload(Claim.adjudication_result))
        .order_by(Claim.sla_deadline.asc().nulls_last())
    )

    result = await db.execute(query)
    return result.scalars().all()
