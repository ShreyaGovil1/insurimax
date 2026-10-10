"""
Adjudication Engine routes.

POST   /claims/{claimId}/adjudicate
GET    /claims/{claimId}/adjudication
GET    /claims/{claimId}/adjudication/line-items/{itemId}
GET    /claims/{claimId}/adjudication/line-items/{itemId}/explanation
POST   /claims/{claimId}/adjudication/line-items/{itemId}/override
POST   /claims/{claimId}/adjudication/finalize
"""
import uuid

from fastapi import APIRouter, HTTPException, status

from app.core.access import require_claim_access
from app.core.deps import AdjusterOrAbove, CurrentUser, DBSession
from app.schemas.adjudication import (
    AdjudicationResultRead,
    FinalizeRequest,
    LineItemDecisionRead,
    LineItemExplanation,
    LineItemOverrideRequest,
)
from app.services import adjudication_service
from app.services import policy_service

router = APIRouter(tags=["Adjudication Engine"])


@router.post(
    "/claims/{claim_id}/adjudicate",
    response_model=AdjudicationResultRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def run_adjudication(
    claim_id: uuid.UUID,
    db: DBSession,
    current_user: AdjusterOrAbove,
):
    """
    Trigger the Gemini adjudication pipeline for a claim.

    Flow:
      1. Merge all extracted bill data for the claim
      2. Load applicable policy rules (if a policy version is linked)
      3. Load IRDAI non-payable items list
      4. Send unified prompt to Gemini 1.5 Pro
      5. Persist per-line-item decisions with explanations and citations
      6. Auto-approve if confidence ≥ threshold AND amount ≤ limit

    Can be re-run: existing line-item decisions are replaced.
    """
    await require_claim_access(db, claim_id, current_user)
    try:
        result = await adjudication_service.run_adjudication(db, claim_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Adjudication failed: {exc}",
        )
    return result


@router.get("/claims/{claim_id}/adjudication", response_model=AdjudicationResultRead)
async def get_adjudication(
    claim_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    """Return the full adjudication result with all line-item decisions."""
    await require_claim_access(db, claim_id, current_user)
    adj = await adjudication_service.get_adjudication(db, claim_id)
    if not adj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No adjudication result found for this claim",
        )
    return adj


@router.get(
    "/claims/{claim_id}/adjudication/line-items/{item_id}",
    response_model=LineItemDecisionRead,
)
async def get_line_item(
    claim_id: uuid.UUID,
    item_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    """Fetch a single line-item decision."""
    await require_claim_access(db, claim_id, current_user)
    item = await adjudication_service.get_line_item(db, item_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Line item not found"
        )
    return item


@router.get(
    "/claims/{claim_id}/adjudication/line-items/{item_id}/explanation",
    response_model=LineItemExplanation,
)
async def get_line_item_explanation(
    claim_id: uuid.UUID,
    item_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Phase 2 right-panel: full explanation with policy clause citation.
    Returns the AI reasoning + a direct link to the policy clause.
    """
    await require_claim_access(db, claim_id, current_user)
    item = await adjudication_service.get_line_item(db, item_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Line item not found"
        )

    # Enrich with policy rule details if linked
    clause_reference = None
    clause_page = None
    policy_version_id = None

    if item.policy_rule_id:
        rule = await policy_service.get_policy_rule(db, item.policy_rule_id)
        if rule:
            clause_reference = rule.clause_reference
            clause_page = rule.clause_page
            policy_version_id = rule.policy_version_id

    return LineItemExplanation(
        item_id=item.id,
        item_name=item.item_name,
        ai_explanation=item.ai_explanation,
        policy_rule_id=item.policy_rule_id,
        clause_reference=clause_reference,
        clause_page=clause_page,
        policy_version_id=policy_version_id,
        citation_data=item.citation_data,
        billed_amount_inr=item.billed_amount_inr,
        approved_amount_inr=item.approved_amount_inr,
        deducted_amount_inr=item.deducted_amount_inr,
        final_status=item.final_status,
    )


@router.post(
    "/claims/{claim_id}/adjudication/line-items/{item_id}/override",
    response_model=LineItemDecisionRead,
)
async def override_line_item(
    claim_id: uuid.UUID,
    item_id: uuid.UUID,
    body: LineItemOverrideRequest,
    db: DBSession,
    current_user: AdjusterOrAbove,
):
    """
    Phase 3 adjuster override.
    - Near-zero friction: one endpoint, minimal required fields.
    - Logs the override reason for pattern learning and audit trail.
    - Automatically recalculates adjudication totals.
    """
    await require_claim_access(db, claim_id, current_user)
    item = await adjudication_service.override_line_item(
        db, item_id, body, current_user.id
    )
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Line item not found"
        )
    return item


@router.post(
    "/claims/{claim_id}/adjudication/finalize",
    response_model=AdjudicationResultRead,
)
async def finalize_adjudication(
    claim_id: uuid.UUID,
    body: FinalizeRequest,
    db: DBSession,
    current_user: AdjusterOrAbove,
):
    """
    Phase 5: Lock the adjudication decision.
    - Sets adjudication status to FINALIZED
    - Sets claim status to FINALIZED
    - Records the finalizing adjuster and timestamp
    - This is the compliance record — immutable after this point
    """
    await require_claim_access(db, claim_id, current_user)
    adj = await adjudication_service.finalize_adjudication(
        db, claim_id, body, current_user.id
    )
    if not adj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No adjudication result found for this claim",
        )
    return adj
