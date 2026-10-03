"""
Adjudication service — runs the Gemini audit and persists results.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.agent.adjudicator import run_adjudication_agent
from app.core.config import settings
from app.models.adjudication import (
    AdjudicationResult,
    AdjudicationStatus,
    LineItemDecision,
    LineItemStatus,
    OverrideReason,
)
from app.models.claim import Claim, ClaimStatus
from app.models.policy import NonPayableItem, PolicyRule
from app.schemas.adjudication import FinalizeRequest, LineItemOverrideRequest
from app.services.document_service import get_claim_extracted_data


# ── Helper: map string status from Gemini → enum ─────────────────────────────

_STATUS_MAP: dict[str, LineItemStatus] = {
    "approved": LineItemStatus.APPROVED,
    "partially_approved": LineItemStatus.PARTIALLY_APPROVED,
    "flagged": LineItemStatus.FLAGGED,
    "non_payable": LineItemStatus.NON_PAYABLE,
    "rejected": LineItemStatus.REJECTED,
}


async def run_adjudication(db: AsyncSession, claim_id: uuid.UUID) -> AdjudicationResult:
    """
    Main adjudication pipeline:
    1. Load extracted bill data
    2. Load policy rules
    3. Load non-payable items
    4. Send to Gemini
    5. Persist line-item decisions
    """
    # ── Load claim ────────────────────────────────────────────────────────────
    claim_result = await db.execute(
        select(Claim)
        .where(Claim.id == claim_id)
        .options(selectinload(Claim.adjudication_result))
    )
    claim = claim_result.scalar_one_or_none()
    if not claim:
        raise ValueError(f"Claim {claim_id} not found")

    # Create or reuse adjudication result row
    adj = claim.adjudication_result
    if adj is None:
        adj = AdjudicationResult(claim_id=claim_id)
        db.add(adj)
    adj.status = AdjudicationStatus.IN_PROGRESS
    await db.flush()

    # Update claim status
    claim.status = ClaimStatus.ADJUDICATION_IN_PROGRESS
    await db.flush()

    try:
        # ── Extracted bill data ────────────────────────────────────────────────
        extracted_data = await get_claim_extracted_data(db, claim_id)

        # ── Policy rules ───────────────────────────────────────────────────────
        policy_rules: list[dict] = []
        rule_id_map: dict[str, uuid.UUID] = {}

        if claim.policy_version_id:
            rules_result = await db.execute(
                select(PolicyRule).where(
                    PolicyRule.policy_version_id == claim.policy_version_id,
                    PolicyRule.is_active == True,  # noqa: E712
                )
            )
            for rule in rules_result.scalars().all():
                policy_rules.append(
                    {
                        "rule_id": str(rule.id),
                        "rule_type": rule.rule_type.value,
                        "clause_reference": rule.clause_reference,
                        "title": rule.title,
                        "description": rule.description,
                        "limit_data": rule.limit_data,
                        "applies_to_categories": rule.applies_to_categories,
                    }
                )
                rule_id_map[rule.clause_reference or rule.title] = rule.id

        # ── Non-payable items ──────────────────────────────────────────────────
        npi_result = await db.execute(
            select(NonPayableItem).where(NonPayableItem.is_active == True)  # noqa: E712
        )
        non_payable_items = [
            {"name": item.name, "category": item.category, "keywords": item.keywords}
            for item in npi_result.scalars().all()
        ]

        # ── Run the ADK adjudication agent ─────────────────────────────────────
        gemini_output, prompt_tokens, completion_tokens = await run_adjudication_agent(
            extracted_data=extracted_data,
            policy_rules=policy_rules,
            non_payable_items=non_payable_items,
        )

        # ── Parse Gemini output ────────────────────────────────────────────────
        summary = gemini_output.get("adjudication_summary", {})
        line_decisions = gemini_output.get("line_item_decisions", [])

        # ── Delete old line items if re-running ────────────────────────────────
        old_items_result = await db.execute(
            select(LineItemDecision).where(
                LineItemDecision.adjudication_result_id == adj.id
            )
        )
        for old in old_items_result.scalars().all():
            await db.delete(old)
        await db.flush()

        # ── Persist line items ─────────────────────────────────────────────────
        flagged_count = 0
        non_payable_count = 0
        new_line_items: list[LineItemDecision] = []

        for idx, item in enumerate(line_decisions):
            raw_status = item.get("status", "flagged").lower()
            ai_status = _STATUS_MAP.get(raw_status, LineItemStatus.FLAGGED)

            if ai_status in (LineItemStatus.FLAGGED,):
                flagged_count += 1
            if ai_status == LineItemStatus.NON_PAYABLE:
                non_payable_count += 1

            # Try to link to a policy rule
            rule_ref = item.get("policy_rule_reference")
            policy_rule_id = rule_id_map.get(rule_ref) if rule_ref else None

            lid = LineItemDecision(
                adjudication_result_id=adj.id,
                line_number=item.get("line_number", idx + 1),
                item_name=item.get("item_name", "Unknown"),
                item_category=item.get("item_category"),
                billed_amount_inr=float(item.get("billed_amount_inr", 0)),
                approved_amount_inr=float(item.get("approved_amount_inr", 0)),
                deducted_amount_inr=float(item.get("deducted_amount_inr", 0)),
                ai_status=ai_status,
                final_status=ai_status,
                ai_explanation=item.get("explanation"),
                policy_rule_id=policy_rule_id,
                citation_data={
                    "policy_rule_reference": rule_ref,
                    "confidence": item.get("confidence"),
                    "cap_analysis": item.get("cap_analysis"),
                },
            )
            db.add(lid)
            new_line_items.append(lid)

        await db.flush()

        # ── Update adjudication result ─────────────────────────────────────────
        adj.status = AdjudicationStatus.COMPLETED
        adj.total_billed_inr = float(summary.get("total_billed_inr", 0))
        adj.total_approved_inr = float(summary.get("total_approved_inr", 0))
        adj.total_deducted_inr = float(summary.get("total_deducted_inr", 0))
        adj.deduction_breakdown = summary.get("deduction_breakdown")
        adj.confidence_score = float(summary.get("confidence_score", 0))
        adj.flagged_items_count = flagged_count
        adj.non_payable_items_count = non_payable_count
        adj.gemini_model_used = settings.GEMINI_MODEL
        adj.prompt_tokens = prompt_tokens
        adj.completion_tokens = completion_tokens
        adj.gemini_raw_response = gemini_output

        # Check auto-approval thresholds
        auto_approvable = summary.get("auto_approvable", False)
        if (
            auto_approvable
            and adj.confidence_score >= settings.AUTO_APPROVAL_CONFIDENCE_THRESHOLD
            and (adj.total_approved_inr or 0) <= settings.AUTO_APPROVAL_MAX_AMOUNT_INR
        ):
            adj.auto_approved = True
            claim.status = ClaimStatus.AUTO_APPROVED
        else:
            claim.status = ClaimStatus.IN_REVIEW

        # Sync amounts to claim
        claim.approved_amount = adj.total_approved_inr
        claim.deducted_amount = adj.total_deducted_inr
        claim.ai_confidence_score = adj.confidence_score
        claim.deduction_summary = adj.deduction_breakdown

        await db.flush()

    except Exception as exc:
        adj.status = AdjudicationStatus.FAILED
        adj.error_message = str(exc)
        claim.status = ClaimStatus.IN_REVIEW
        await db.flush()
        raise

    # Re-fetch with line_items eagerly loaded — the adj object returned from
    # run_adjudication() was loaded via Claim.adjudication_result which does NOT
    # include line_items. Pydantic serialization will hit a lazy-load which
    # raises MissingGreenlet in async context.
    refreshed = await db.execute(
        select(AdjudicationResult)
        .where(AdjudicationResult.id == adj.id)
        .options(selectinload(AdjudicationResult.line_items))
    )
    return refreshed.scalar_one()


async def get_adjudication(db: AsyncSession, claim_id: uuid.UUID) -> AdjudicationResult | None:
    result = await db.execute(
        select(AdjudicationResult)
        .where(AdjudicationResult.claim_id == claim_id)
        .options(selectinload(AdjudicationResult.line_items))
    )
    return result.scalar_one_or_none()


async def get_line_item(
    db: AsyncSession, item_id: uuid.UUID
) -> LineItemDecision | None:
    result = await db.execute(
        select(LineItemDecision).where(LineItemDecision.id == item_id)
    )
    return result.scalar_one_or_none()


async def override_line_item(
    db: AsyncSession,
    item_id: uuid.UUID,
    override: LineItemOverrideRequest,
    adjuster_id: uuid.UUID,
) -> LineItemDecision | None:
    item = await get_line_item(db, item_id)
    if not item:
        return None

    item.is_overridden = True
    item.final_status = override.new_status
    item.override_reason = override.override_reason
    item.override_note = override.override_note
    item.overridden_by_id = adjuster_id
    item.overridden_at = datetime.now(timezone.utc)

    if override.new_approved_amount_inr is not None:
        item.approved_amount_inr = override.new_approved_amount_inr
        item.deducted_amount_inr = item.billed_amount_inr - override.new_approved_amount_inr

    await db.flush()

    # Recalculate adjudication totals
    adj_result = await db.execute(
        select(AdjudicationResult)
        .where(AdjudicationResult.id == item.adjudication_result_id)
        .options(selectinload(AdjudicationResult.line_items))
    )
    adj = adj_result.scalar_one_or_none()
    if adj:
        adj.total_approved_inr = sum(
            li.approved_amount_inr for li in adj.line_items
        )
        adj.total_deducted_inr = sum(
            li.deducted_amount_inr for li in adj.line_items
        )
        adj.flagged_items_count = sum(
            1 for li in adj.line_items if li.final_status == LineItemStatus.FLAGGED
        )
        adj.non_payable_items_count = sum(
            1 for li in adj.line_items if li.final_status == LineItemStatus.NON_PAYABLE
        )
        await db.flush()

    return item


async def finalize_adjudication(
    db: AsyncSession,
    claim_id: uuid.UUID,
    request: FinalizeRequest,
    finalized_by_id: uuid.UUID,
) -> AdjudicationResult | None:
    adj = await get_adjudication(db, claim_id)
    if not adj:
        return None

    adj.status = AdjudicationStatus.FINALIZED
    adj.finalized_by_id = finalized_by_id
    adj.finalized_at = datetime.now(timezone.utc)

    # Update claim
    claim_result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = claim_result.scalar_one_or_none()
    if claim:
        claim.status = ClaimStatus.FINALIZED
        claim.finalized_at = datetime.now(timezone.utc)
        if request.adjuster_notes:
            claim.adjuster_notes = request.adjuster_notes
        claim.approved_amount = adj.total_approved_inr
        claim.deducted_amount = adj.total_deducted_inr

    await db.flush()

    # Re-fetch to ensure line_items are still eagerly loaded after flush
    refreshed = await db.execute(
        select(AdjudicationResult)
        .where(AdjudicationResult.id == adj.id)
        .options(selectinload(AdjudicationResult.line_items))
    )
    return refreshed.scalar_one()
