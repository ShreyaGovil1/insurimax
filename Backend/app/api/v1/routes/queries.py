"""
Queries (hospital clarification loop) + Queue + Adjuster Workflow routes.

POST   /claims/{claimId}/queries
GET    /claims/{claimId}/queries
GET    /queries/{queryId}
POST   /queries/{queryId}/respond
PATCH  /queries/{queryId}/resolve

GET    /queue
GET    /queue/unassigned
POST   /queue/{claimId}/assign
POST   /queue/{claimId}/escalate

GET    /adjusters/{adjusterId}/daily-digest
GET    /adjusters/{adjusterId}/overrides
"""
import uuid

from fastapi import APIRouter, HTTPException, Query, status

from app.core.deps import AdjusterOrAbove, AdminOrSenior, CurrentUser, DBSession
from app.models.claim import ClaimStatus
from app.models.user import UserRole
from app.schemas.claim import ClaimSummary, ClaimStatusUpdate
from app.schemas.query import ClaimQueryCreate, ClaimQueryRead, QueryResolveRequest, QueryResponseRequest
from app.services import analytics_service, claim_service, query_service

router = APIRouter(tags=["Queries & Adjuster Workflow"])


# ── Claim Queries ─────────────────────────────────────────────────────────────

@router.post(
    "/claims/{claim_id}/queries",
    response_model=ClaimQueryRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_query(
    claim_id: uuid.UUID,
    body: ClaimQueryCreate,
    db: DBSession,
    current_user: AdjusterOrAbove,
):
    """
    Raise a query to the hospital for clarification.
    Set ai_drafted=true to get an AI-generated query text drafted from context.
    Pass context in query_text when ai_drafted=true; the AI will rewrite it.
    """
    query_text = body.query_text
    if body.ai_drafted and body.query_text:
        # Use Gemini to polish/draft the query from the context the adjuster provided
        query_text = await query_service.draft_query_with_ai(claim_id, body.query_text)

    create_data = ClaimQueryCreate(query_text=query_text, ai_drafted=body.ai_drafted)
    q = await query_service.create_query(db, claim_id, create_data, current_user.id)
    return q


@router.get("/claims/{claim_id}/queries", response_model=list[ClaimQueryRead])
async def list_claim_queries(
    claim_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    return await query_service.list_claim_queries(db, claim_id)


@router.get("/queries/{query_id}", response_model=ClaimQueryRead)
async def get_query(
    query_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    q = await query_service.get_query(db, query_id)
    if not q:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Query not found")
    return q


@router.post("/queries/{query_id}/respond", response_model=ClaimQueryRead)
async def respond_to_query(
    query_id: uuid.UUID,
    body: QueryResponseRequest,
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Hospital desk responds to a query.
    Accepted by any authenticated user (hospital_desk role in production).
    """
    q = await query_service.respond_to_query(db, query_id, body, current_user.id)
    if not q:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Query not found")
    return q


@router.patch("/queries/{query_id}/resolve", response_model=ClaimQueryRead)
async def resolve_query(
    query_id: uuid.UUID,
    body: QueryResolveRequest,
    db: DBSession,
    current_user: AdjusterOrAbove,
):
    """Mark a query as resolved once the adjuster is satisfied with the response."""
    q = await query_service.resolve_query(db, query_id, body, current_user.id)
    if not q:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Query not found")
    return q


# ── Queue ─────────────────────────────────────────────────────────────────────

@router.get("/queue", response_model=list[ClaimSummary])
async def get_queue(
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Adjuster's assigned case queue, sorted by SLA urgency (nearest deadline first).
    Admins and senior adjusters see all active claims.
    Regular adjusters only see their own assignments.
    """
    adjuster_id = None
    if current_user.role == UserRole.ADJUSTER:
        adjuster_id = current_user.id

    claims = await analytics_service.get_queue(db, adjuster_id=adjuster_id)
    return [
        ClaimSummary(
            id=c.id,
            claim_number=c.claim_number,
            patient_name=c.patient_name,
            hospital_name=c.hospital_name,
            billed_amount=c.billed_amount,
            approved_amount=c.approved_amount,
            status=c.status,
            ai_confidence_score=c.ai_confidence_score,
            flagged_items_count=None,
            sla_deadline=c.sla_deadline,
            sla_breached=c.sla_breached,
            submitted_at=c.submitted_at,
        )
        for c in claims
    ]


@router.get("/queue/unassigned", response_model=list[ClaimSummary])
async def get_unassigned_queue(
    db: DBSession,
    current_user: AdminOrSenior,
):
    """Unassigned claims for routing by senior adjusters / admins."""
    claims = await analytics_service.get_queue(db, unassigned_only=True)
    return [
        ClaimSummary(
            id=c.id,
            claim_number=c.claim_number,
            patient_name=c.patient_name,
            hospital_name=c.hospital_name,
            billed_amount=c.billed_amount,
            approved_amount=c.approved_amount,
            status=c.status,
            ai_confidence_score=c.ai_confidence_score,
            flagged_items_count=None,
            sla_deadline=c.sla_deadline,
            sla_breached=c.sla_breached,
            submitted_at=c.submitted_at,
        )
        for c in claims
    ]


@router.post("/queue/{claim_id}/assign", response_model=dict)
async def assign_claim(
    claim_id: uuid.UUID,
    adjuster_id: uuid.UUID,
    db: DBSession,
    current_user: AdminOrSenior,
):
    """Assign or reassign a claim to an adjuster."""
    claim = await claim_service.assign_adjuster(db, claim_id, adjuster_id)
    if not claim:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")
    return {
        "message": f"Claim {claim_id} assigned to adjuster {adjuster_id}",
        "claim_id": str(claim_id),
        "adjuster_id": str(adjuster_id),
    }


@router.post("/queue/{claim_id}/escalate", response_model=dict)
async def escalate_claim(
    claim_id: uuid.UUID,
    reason: str | None = None,
    db: DBSession = None,
    current_user: CurrentUser = None,
):
    """Escalate a claim to a senior adjuster."""
    update_data = ClaimStatusUpdate(
        status=ClaimStatus.ESCALATED,
        note=reason or "Escalated by adjuster",
    )
    claim = await claim_service.update_claim_status(db, claim_id, update_data, current_user.id)
    if not claim:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")
    return {"message": f"Claim {claim_id} escalated", "claim_id": str(claim_id)}


# ── Adjuster analytics ────────────────────────────────────────────────────────

@router.get("/adjusters/{adjuster_id}/daily-digest")
async def get_adjuster_daily_digest(
    adjuster_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
    date: str | None = Query(None, description="ISO date YYYY-MM-DD, defaults to today"),
):
    """
    Phase 7 end-of-day performance digest.
    Adjusters can only see their own digest; admins can see anyone's.
    """
    if current_user.role != UserRole.ADMIN and current_user.id != adjuster_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    target_date = None
    if date:
        from datetime import datetime, timezone
        target_date = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)

    digest = await analytics_service.get_adjuster_daily_digest(db, adjuster_id, target_date)
    return digest


@router.get("/adjusters/{adjuster_id}/overrides")
async def get_adjuster_overrides(
    adjuster_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    db: DBSession = None,
    current_user: CurrentUser = None,
):
    """
    Full override history for an adjuster.
    Used for the 'system learns from corrections' feature (Phase 6).
    Visible to the adjuster themselves and admins.
    """
    if current_user.role != UserRole.ADMIN and current_user.id != adjuster_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    overrides = await analytics_service.get_adjuster_override_history(db, adjuster_id, limit)
    return {"adjuster_id": str(adjuster_id), "overrides": overrides, "total": len(overrides)}
