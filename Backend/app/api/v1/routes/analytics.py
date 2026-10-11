"""
Fraud & Anomaly Detection, Compliance & Reporting, and Admin routes.

GET    /analytics/hospitals/{hospitalId}/patterns
GET    /analytics/anomalies
GET    /analytics/hospitals/{hospitalId}/override-history
POST   /analytics/anomalies/{anomalyId}/investigate

GET    /compliance/sla-report
GET    /compliance/audit-trail
GET    /compliance/claims/{claimId}/full-trace

GET    /org/{orgId}/auto-approval-thresholds
PATCH  /org/{orgId}/auto-approval-thresholds
GET    /org/{orgId}/settings
PATCH  /org/{orgId}/settings

POST   /webhooks/subscribe
GET    /webhooks
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.core.deps import AdjusterOrAbove, CurrentUser, DBSession
from app.models.user import Organization, UserRole
from app.models.webhook import WebhookSubscription
from app.schemas.analytics import (
    AdjusterDailyDigest,
    SLAReport,
    WebhookSubscriptionCreate,
    WebhookSubscriptionRead,
)
from app.core.access import insurer_scope
from app.services import analytics_service

router = APIRouter(tags=["Analytics & Compliance"])


# ── Fraud & Anomaly Detection ─────────────────────────────────────────────────

@router.get("/analytics/hospitals/{hospital_org_id}/patterns")
async def get_hospital_billing_patterns(
    hospital_org_id: uuid.UUID,
    db: DBSession,
    current_user: AdjusterOrAbove,
):
    """
    Phase 6 pattern detection: item-level override frequencies per hospital.
    'This hospital has had 3 prior overrides on this item type.'
    """
    patterns = await analytics_service.get_hospital_billing_patterns(
        db, hospital_org_id, insurer_org_id=await insurer_scope(db, current_user)
    )
    return patterns


@router.get("/analytics/anomalies")
async def get_anomalies(
    db: DBSession,
    current_user: AdjusterOrAbove,
    severity: str | None = Query(None, description="low | medium | high"),
    limit: int = Query(50, ge=1, le=200),
):
    """Cross-claim anomaly feed, computed live over the caller's insurer scope."""
    anomalies = await analytics_service.get_anomalies(
        db, insurer_org_id=await insurer_scope(db, current_user)
    )
    if severity:
        anomalies = [a for a in anomalies if a["severity"] == severity]
    return {"anomalies": anomalies[:limit], "total": len(anomalies)}


@router.get("/analytics/hospitals/{hospital_org_id}/override-history")
async def get_hospital_override_history(
    hospital_org_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    db: DBSession = None,
    current_user: AdjusterOrAbove = None,
):
    """Per-hospital override history — feeds the adjuster's 'prior overrides' warning."""
    patterns = await analytics_service.get_hospital_billing_patterns(
        db, hospital_org_id, insurer_org_id=await insurer_scope(db, current_user)
    )
    return {
        "hospital_org_id": str(hospital_org_id),
        "common_override_items": patterns.get("common_override_items", []),
        "total_override_count": patterns.get("total_claims", 0),
        "anomaly_flags": patterns.get("anomaly_flags", []),
    }


@router.post("/analytics/anomalies/{anomaly_id}/investigate")
async def mark_anomaly_investigated(
    anomaly_id: uuid.UUID,
    current_user: AdjusterOrAbove,
):
    """Mark an anomaly as under investigation."""
    return {
        "message": f"Anomaly {anomaly_id} marked for investigation",
        "anomaly_id": str(anomaly_id),
        "investigated_by": str(current_user.id),
    }


# ── Compliance & Reporting ────────────────────────────────────────────────────

@router.get("/compliance/sla-report", response_model=SLAReport)
async def get_sla_report(
    db: DBSession,
    current_user: AdjusterOrAbove,
    period_days: int = Query(30, ge=1, le=365),
):
    """
    SLA compliance report over the caller's insurer scope.
    Shows breach rates, average resolution times, and compliance percentage.
    """
    period_end = datetime.now(timezone.utc)
    period_start = period_end - timedelta(days=period_days)

    report = await analytics_service.get_sla_compliance_report(
        db, period_start, period_end, insurer_org_id=await insurer_scope(db, current_user)
    )
    return report


@router.get("/compliance/audit-trail")
async def get_audit_trail(
    db: DBSession,
    current_user: AdjusterOrAbove,
    claim_id: uuid.UUID | None = Query(None),
    user_id: uuid.UUID | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
):
    """
    Immutable audit log export.
    In production, augment with Cloud Audit Logs for full GCP-level traceability.
    """
    from sqlalchemy import func, select
    from app.models.claim import Claim, ClaimStatus, ClaimStatusHistory

    # Same scope as the insurer's claims: its own insurer only, never hospital-side drafts
    conditions = [Claim.status != ClaimStatus.DRAFT]
    scope = await insurer_scope(db, current_user)
    if scope:
        conditions.append(Claim.insurer_org_id == scope)
    if claim_id:
        conditions.append(ClaimStatusHistory.claim_id == claim_id)
    if user_id:
        conditions.append(ClaimStatusHistory.changed_by_id == user_id)

    base = select(ClaimStatusHistory, Claim.claim_number).join(
        Claim, Claim.id == ClaimStatusHistory.claim_id
    ).where(*conditions)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (
        await db.execute(base.order_by(ClaimStatusHistory.created_at.desc()).limit(limit))
    ).all()

    return {
        "entries": [
            {
                "timestamp": e.created_at.isoformat(),
                "claim_id": str(e.claim_id),
                "claim_number": claim_number,
                "from_status": e.from_status.value if e.from_status else None,
                "to_status": e.to_status.value,
                "changed_by_id": str(e.changed_by_id) if e.changed_by_id else None,
                "note": e.note,
            }
            for e, claim_number in rows
        ],
        "total": total,
    }


@router.get("/compliance/claims/{claim_id}/full-trace")
async def get_claim_full_trace(
    claim_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Every action, override, and timestamp on a single claim — the full compliance trace.
    """
    from app.core.access import require_claim_access
    from app.services import claim_service, adjudication_service

    await require_claim_access(db, claim_id, current_user)
    claim = await claim_service.get_claim(db, claim_id)
    if not claim:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")

    adj = await adjudication_service.get_adjudication(db, claim_id)

    overrides = []
    if adj:
        overrides = [
            {
                "item_id": str(li.id),
                "item_name": li.item_name,
                "ai_status": li.ai_status.value,
                "final_status": li.final_status.value,
                "override_reason": li.override_reason.value if li.override_reason else None,
                "override_note": li.override_note,
                "overridden_by_id": str(li.overridden_by_id) if li.overridden_by_id else None,
                "overridden_at": li.overridden_at.isoformat() if li.overridden_at else None,
            }
            for li in adj.line_items
            if li.is_overridden
        ]

    return {
        "claim_id": str(claim_id),
        "claim_number": claim.claim_number,
        "status_history": [
            {
                "from_status": h.from_status.value if h.from_status else None,
                "to_status": h.to_status.value,
                "changed_by_id": str(h.changed_by_id) if h.changed_by_id else None,
                "note": h.note,
                "timestamp": h.created_at.isoformat(),
            }
            for h in claim.status_history
        ],
        "adjudication_overrides": overrides,
        "finalized_at": claim.finalized_at.isoformat() if claim.finalized_at else None,
        "sla_breached": claim.sla_breached,
    }


# ── Admin / Configuration ─────────────────────────────────────────────────────

@router.get("/org/{org_id}/auto-approval-thresholds")
async def get_auto_approval_thresholds(
    org_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation not found")

    return {
        "org_id": str(org_id),
        "auto_approval_confidence_threshold": org.auto_approval_confidence_threshold,
        "auto_approval_max_amount_inr": org.auto_approval_max_amount_inr,
    }


@router.patch("/org/{org_id}/auto-approval-thresholds")
async def update_auto_approval_thresholds(
    org_id: uuid.UUID,
    confidence_threshold: float | None = None,
    max_amount_inr: float | None = None,
    db: DBSession = None,
    current_user: AdjusterOrAbove = None,
):
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation not found")

    if confidence_threshold is not None:
        if not 0.0 <= confidence_threshold <= 1.0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="confidence_threshold must be between 0 and 1",
            )
        org.auto_approval_confidence_threshold = confidence_threshold

    if max_amount_inr is not None:
        if max_amount_inr < 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="max_amount_inr must be non-negative",
            )
        org.auto_approval_max_amount_inr = max_amount_inr

    await db.flush()
    return {
        "message": "Thresholds updated",
        "org_id": str(org_id),
        "auto_approval_confidence_threshold": org.auto_approval_confidence_threshold,
        "auto_approval_max_amount_inr": org.auto_approval_max_amount_inr,
    }


@router.get("/org/{org_id}/settings")
async def get_org_settings(
    org_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation not found")

    return {
        "org_id": str(org.id),
        "name": org.name,
        "org_type": org.org_type.value,
        "contact_email": org.contact_email,
        "contact_phone": org.contact_phone,
        "gstin": org.gstin,
        "address": org.address,
        "is_active": org.is_active,
        "auto_approval_confidence_threshold": org.auto_approval_confidence_threshold,
        "auto_approval_max_amount_inr": org.auto_approval_max_amount_inr,
        "created_at": org.created_at.isoformat(),
    }


@router.patch("/org/{org_id}/settings")
async def update_org_settings(
    org_id: uuid.UUID,
    body: dict,
    db: DBSession,
    current_user: AdjusterOrAbove,
):
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation not found")

    allowed_fields = {"name", "contact_email", "contact_phone", "gstin", "address"}
    for field, value in body.items():
        if field in allowed_fields:
            setattr(org, field, value)

    await db.flush()
    return {"message": "Settings updated", "org_id": str(org_id)}


# ── Webhooks ──────────────────────────────────────────────────────────────────

@router.post(
    "/webhooks/subscribe",
    response_model=WebhookSubscriptionRead,
    status_code=status.HTTP_201_CREATED,
)
async def subscribe_webhook(
    body: WebhookSubscriptionCreate,
    db: DBSession,
    current_user: CurrentUser,
):
    """Register a webhook endpoint to receive claim events."""
    if not current_user.org_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="User must belong to an organisation to subscribe to webhooks",
        )

    sub = WebhookSubscription(
        org_id=current_user.org_id,
        event_type=body.event_type,
        target_url=body.target_url,
        secret_token=body.secret_token,
        filters=body.filters,
    )
    db.add(sub)
    await db.flush()
    return sub


@router.get("/webhooks", response_model=list[WebhookSubscriptionRead])
async def list_webhooks(
    db: DBSession,
    current_user: CurrentUser,
):
    """List all webhook subscriptions for the current user's organisation."""
    if not current_user.org_id:
        return []

    result = await db.execute(
        select(WebhookSubscription).where(
            WebhookSubscription.org_id == current_user.org_id,
            WebhookSubscription.is_active == True,  # noqa: E712
        )
    )
    return result.scalars().all()
