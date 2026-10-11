"""
Analytics, compliance reporting, and adjuster digest service.
"""
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
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
            Claim.status == ClaimStatus.FINALIZED,
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


_IST = ZoneInfo("Asia/Kolkata")
_AI_AGREEMENT_WINDOW_DAYS = 30


async def get_queue_stats(
    db: AsyncSession,
    hospital_org_id: uuid.UUID | None = None,
    insurer_org_id: uuid.UUID | None = None,
    exclude_drafts: bool = False,
) -> dict:
    """
    Headline metrics for the queue page, over the same claims the caller's queue shows.
    "Today" is the current calendar day in India (IST), the business day of the users.
    """
    now = datetime.now(timezone.utc)
    day_start = now.astimezone(_IST).replace(hour=0, minute=0, second=0, microsecond=0)

    scope = []
    if hospital_org_id:
        scope.append(Claim.hospital_org_id == hospital_org_id)
    if insurer_org_id:
        scope.append(Claim.insurer_org_id == insurer_org_id)
    if exclude_drafts:
        scope.append(Claim.status != ClaimStatus.DRAFT)

    # Claims finalized today: count and average submit -> finalize turnaround
    finalized = (
        await db.execute(
            select(Claim.submitted_at, Claim.finalized_at).where(
                *scope,
                Claim.status == ClaimStatus.FINALIZED,
                Claim.finalized_at >= day_start,
            )
        )
    ).all()
    turnarounds = [
        (fin - sub).total_seconds() / 60 for sub, fin in finalized if sub and fin and fin >= sub
    ]

    # Adjudications run today: deductions the AI identified (non-payables, caps, exclusions)
    adjudicated_today = select(AdjudicationResult).join(Claim, Claim.id == AdjudicationResult.claim_id).where(
        *scope, AdjudicationResult.updated_at >= day_start
    )
    adj_rows = (await db.execute(adjudicated_today)).scalars().all()
    deductions_today = sum(a.total_deducted_inr or 0 for a in adj_rows)

    # AI agreement: share of AI line-item decisions adjusters kept as-is (not overridden)
    window_start = now - timedelta(days=_AI_AGREEMENT_WINDOW_DAYS)
    total_items, overridden_items = (
        await db.execute(
            select(
                func.count(LineItemDecision.id),
                func.count(LineItemDecision.id).filter(LineItemDecision.is_overridden.is_(True)),
            )
            .join(AdjudicationResult, AdjudicationResult.id == LineItemDecision.adjudication_result_id)
            .join(Claim, Claim.id == AdjudicationResult.claim_id)
            .where(*scope, LineItemDecision.created_at >= window_start)
        )
    ).one()
    agreement = (
        round((total_items - overridden_items) / total_items * 100, 1) if total_items else None
    )

    return {
        "finalized_today": len(finalized),
        "avg_turnaround_minutes": round(sum(turnarounds) / len(turnarounds)) if turnarounds else None,
        "adjudicated_today": len(adj_rows),
        "deductions_identified_today_inr": round(deductions_today, 2),
        "ai_agreement_rate": agreement,
        "ai_line_items_reviewed": total_items,
        "ai_overrides": overridden_items,
        "ai_agreement_window_days": _AI_AGREEMENT_WINDOW_DAYS,
        "auto_approval_confidence_threshold": settings.AUTO_APPROVAL_CONFIDENCE_THRESHOLD,
        "auto_approval_max_amount_inr": settings.AUTO_APPROVAL_MAX_AMOUNT_INR,
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
    db: AsyncSession, hospital_org_id: uuid.UUID, insurer_org_id: uuid.UUID | None = None
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
            *([Claim.insurer_org_id == insurer_org_id] if insurer_org_id else []),
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

    # Approval rate (approved / billed) over adjudicated claims only: claims not yet
    # adjudicated have no approved amount and would wrongly drag the rate towards 0%.
    hospital_scope = [Claim.hospital_org_id == hospital_org_id]
    if insurer_org_id:
        hospital_scope.append(Claim.insurer_org_id == insurer_org_id)
    total_claims = (
        await db.execute(select(func.count(Claim.id)).where(*hospital_scope))
    ).scalar_one()
    row = (
        await db.execute(
            select(
                func.count(AdjudicationResult.id).label("adjudicated"),
                func.avg(
                    AdjudicationResult.total_approved_inr
                    / func.nullif(AdjudicationResult.total_billed_inr, 0)
                ).label("avg_approval_rate"),
            )
            .join(Claim, Claim.id == AdjudicationResult.claim_id)
            .where(*hospital_scope, AdjudicationResult.total_billed_inr > 0)
        )
    ).one()
    adjudicated_claims = row.adjudicated or 0
    avg_approval_rate = float(row.avg_approval_rate or 0) * 100

    return {
        "hospital_org_id": str(hospital_org_id),
        "total_claims": total_claims,
        "adjudicated_claims": adjudicated_claims,
        "common_override_items": override_patterns,
        "avg_approval_rate": round(avg_approval_rate, 1),
        "anomaly_flags": (
            _detect_anomaly_flags(override_patterns, avg_approval_rate) if adjudicated_claims else []
        ),
    }


_LOW_APPROVAL_RATE = 70  # % of billed amount approved, below which a hospital is flagged
_REPEAT_OVERRIDE_COUNT = 3  # overrides on the same item before it is flagged


def _detect_anomaly_flags(override_patterns: list[dict], avg_approval_rate: float) -> list[str]:
    flags: list[str] = []
    if avg_approval_rate < _LOW_APPROVAL_RATE:
        flags.append(f"Approval rate below {_LOW_APPROVAL_RATE}% — review billing practices")
    for pattern in override_patterns:
        if pattern["override_count"] >= _REPEAT_OVERRIDE_COUNT:
            flags.append(
                f"Item '{pattern['item_name']}' has {pattern['override_count']} prior overrides"
            )
    return flags


async def get_sla_compliance_report(
    db: AsyncSession,
    period_start: datetime,
    period_end: datetime,
    hospital_org_id: uuid.UUID | None = None,
    insurer_org_id: uuid.UUID | None = None,
) -> dict:
    """
    IRDAI SLA report over claims submitted in the period (drafts have no submitted_at).

    A claim's SLA outcome is derived from its deadline, not the sla_breached flag (that flag is
    only set by a background job): finalized on/before the deadline = met; finalized after it,
    or still open past it = breached; still open before it = pending.
    """
    query = select(Claim).where(
        Claim.submitted_at >= period_start,
        Claim.submitted_at < period_end,
    )
    if hospital_org_id:
        query = query.where(Claim.hospital_org_id == hospital_org_id)
    if insurer_org_id:
        query = query.where(Claim.insurer_org_id == insurer_org_id)
    claims = (await db.execute(query)).scalars().all()

    now = datetime.now(timezone.utc)
    met = breached = pending = 0
    durations = []
    for c in claims:
        deadline = c.sla_deadline
        if c.status == ClaimStatus.FINALIZED and c.finalized_at:
            durations.append((c.finalized_at - c.submitted_at).total_seconds() / 60)
            if deadline is None or c.finalized_at <= deadline:
                met += 1
            else:
                breached += 1
        elif c.status in (ClaimStatus.REJECTED,):
            continue  # voided claims have no SLA outcome
        elif c.sla_breached or (deadline is not None and now > deadline):
            breached += 1
        else:
            pending += 1

    decided = met + breached
    return {
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "total_claims": len(claims),
        "resolved_within_sla": met,
        "sla_breached": breached,
        "pending_within_sla": pending,
        "finalized_claims": len(durations),
        "sla_compliance_rate": round(met / decided * 100, 1) if decided else None,
        "avg_resolution_minutes": round(sum(durations) / len(durations), 1) if durations else None,
    }


async def get_anomalies(
    db: AsyncSession,
    hospital_org_id: uuid.UUID | None = None,
    insurer_org_id: uuid.UUID | None = None,
) -> list[dict]:
    """
    Cross-claim billing anomalies per hospital, computed live from adjudication outcomes:
    a low approval rate on adjudicated claims, and line items adjusters repeatedly override.
    """
    scope = []
    if hospital_org_id:
        scope.append(Claim.hospital_org_id == hospital_org_id)
    if insurer_org_id:
        scope.append(Claim.insurer_org_id == insurer_org_id)

    hospitals = (
        await db.execute(
            select(Claim.hospital_org_id, func.max(Claim.hospital_name))
            .where(*scope, Claim.hospital_org_id.is_not(None), Claim.status != ClaimStatus.DRAFT)
            .group_by(Claim.hospital_org_id)
        )
    ).all()

    anomalies = []
    for org_id, hospital_name in hospitals:
        patterns = await get_hospital_billing_patterns(db, org_id, insurer_org_id=insurer_org_id)
        if patterns["adjudicated_claims"] and patterns["avg_approval_rate"] < _LOW_APPROVAL_RATE:
            anomalies.append({
                "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"approval:{org_id}")),
                "hospital_org_id": str(org_id),
                "hospital_name": hospital_name,
                "severity": "high" if patterns["avg_approval_rate"] < 50 else "medium",
                "category": "Low approval rate",
                "description": (
                    f"Only {patterns['avg_approval_rate']}% of the billed amount was approved on average "
                    f"across {patterns['adjudicated_claims']} adjudicated claim(s)."
                ),
                "suggested_action": "Review this hospital's billing practices and tariff compliance.",
            })
        for item in patterns["common_override_items"]:
            if item["override_count"] >= _REPEAT_OVERRIDE_COUNT:
                anomalies.append({
                    "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"override:{org_id}:{item['item_name']}")),
                    "hospital_org_id": str(org_id),
                    "hospital_name": hospital_name,
                    "severity": "medium",
                    "category": "Repeatedly overridden line item",
                    "description": (
                        f"Adjusters overrode the AI decision on '{item['item_name']}' "
                        f"{item['override_count']} times on this hospital's claims."
                    ),
                    "suggested_action": "Check whether this item is consistently mis-billed or the policy rule needs tuning.",
                })
    return anomalies


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
