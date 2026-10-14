"""
Claim query (hospital clarification loop) service.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import ai_model_service
from app.gcp.gemini import QUERY_DRAFT_SYSTEM_PROMPT, generate_json
from app.models.claim import Claim, ClaimStatus, ClaimStatusHistory
from app.models.query import ClaimQuery, QueryStatus
from app.schemas.query import ClaimQueryCreate, QueryResponseRequest, QueryResolveRequest


async def create_query(
    db: AsyncSession,
    claim_id: uuid.UUID,
    data: ClaimQueryCreate,
    raised_by_id: uuid.UUID,
) -> ClaimQuery:
    query = ClaimQuery(
        claim_id=claim_id,
        raised_by_id=raised_by_id,
        query_text=data.query_text,
        ai_drafted=data.ai_drafted,
        status=QueryStatus.OPEN,
    )
    db.add(query)

    # Update claim status to queried
    claim_result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = claim_result.scalar_one_or_none()
    if claim and claim.status != ClaimStatus.QUERIED:
        db.add(
            ClaimStatusHistory(
                claim_id=claim.id,
                from_status=claim.status,
                to_status=ClaimStatus.QUERIED,
                changed_by_id=raised_by_id,
                note="Query raised to hospital",
            )
        )
        claim.status = ClaimStatus.QUERIED

    await db.flush()
    return query


async def draft_query_with_ai(
    claim_id: uuid.UUID, context: str
) -> str:
    """Use Gemini to auto-draft a query to the hospital."""
    prompt = (
        f"{QUERY_DRAFT_SYSTEM_PROMPT}\n\n"
        f"Context about the claim issue:\n{context}\n\n"
        "Draft the query now."
    )
    result, _, _ = await generate_json(prompt=prompt, model_name=await ai_model_service.model_for("query_draft"))
    if isinstance(result, dict):
        return result.get("query_text", "Please clarify the item in question.")
    return "Please clarify the item in question."


async def list_claim_queries(db: AsyncSession, claim_id: uuid.UUID) -> list[ClaimQuery]:
    result = await db.execute(
        select(ClaimQuery)
        .where(ClaimQuery.claim_id == claim_id)
        .order_by(ClaimQuery.created_at.desc())
    )
    return result.scalars().all()


async def get_query(db: AsyncSession, query_id: uuid.UUID) -> ClaimQuery | None:
    result = await db.execute(select(ClaimQuery).where(ClaimQuery.id == query_id))
    return result.scalar_one_or_none()


async def _return_to_review_if_answered(
    db: AsyncSession, claim_id: uuid.UUID, changed_by_id: uuid.UUID
) -> None:
    """Once no query on the claim is still open (unanswered), a QUERIED claim goes back to IN_REVIEW."""
    open_left = (
        await db.execute(
            select(func.count())
            .select_from(ClaimQuery)
            .where(ClaimQuery.claim_id == claim_id, ClaimQuery.status == QueryStatus.OPEN)
        )
    ).scalar_one()
    if open_left:
        return
    claim = (await db.execute(select(Claim).where(Claim.id == claim_id))).scalar_one_or_none()
    if claim and claim.status == ClaimStatus.QUERIED:
        claim.status = ClaimStatus.IN_REVIEW
        db.add(
            ClaimStatusHistory(
                claim_id=claim.id,
                from_status=ClaimStatus.QUERIED,
                to_status=ClaimStatus.IN_REVIEW,
                changed_by_id=changed_by_id,
                note="All queries answered by the hospital",
            )
        )
        await db.flush()


async def respond_to_query(
    db: AsyncSession,
    query_id: uuid.UUID,
    data: QueryResponseRequest,
    responded_by_id: uuid.UUID,
) -> ClaimQuery | None:
    query = await get_query(db, query_id)
    if not query:
        return None

    query.response_text = data.response_text
    query.response_documents = data.response_documents
    query.responded_by_id = responded_by_id
    query.responded_at = datetime.now(timezone.utc)
    query.status = QueryStatus.RESPONDED
    await db.flush()

    await _return_to_review_if_answered(db, query.claim_id, responded_by_id)
    return query


async def resolve_query(
    db: AsyncSession,
    query_id: uuid.UUID,
    data: QueryResolveRequest,
    resolved_by_id: uuid.UUID,
) -> ClaimQuery | None:
    query = await get_query(db, query_id)
    if not query:
        return None

    query.status = QueryStatus.RESOLVED
    query.resolved_by_id = resolved_by_id
    query.resolved_at = datetime.now(timezone.utc)
    query.resolution_note = data.resolution_note
    await db.flush()
    await _return_to_review_if_answered(db, query.claim_id, resolved_by_id)
    return query
