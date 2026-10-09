"""
Adjudication Pydantic schemas.
"""
import uuid
from datetime import datetime

from app.models.adjudication import (
    AdjudicationStatus,
    LineItemStatus,
    OverrideReason,
)
from app.schemas.common import BaseSchema


class LineItemDecisionRead(BaseSchema):
    id: uuid.UUID
    adjudication_result_id: uuid.UUID
    line_number: int
    item_name: str
    item_category: str | None
    billed_amount_inr: float
    approved_amount_inr: float
    deducted_amount_inr: float
    ai_status: LineItemStatus
    final_status: LineItemStatus
    ai_explanation: str | None
    policy_rule_id: uuid.UUID | None
    citation_data: dict | None
    is_overridden: bool
    override_reason: OverrideReason | None
    override_note: str | None
    overridden_by_id: uuid.UUID | None
    overridden_at: datetime | None
    created_at: datetime


class LineItemExplanation(BaseSchema):
    """Right-panel explanation response (Phase 2)."""
    item_id: uuid.UUID
    item_name: str
    ai_explanation: str | None
    policy_rule_id: uuid.UUID | None
    clause_reference: str | None
    clause_page: int | None
    policy_version_id: uuid.UUID | None
    citation_data: dict | None
    billed_amount_inr: float
    approved_amount_inr: float
    deducted_amount_inr: float
    final_status: LineItemStatus


class LineItemOverrideRequest(BaseSchema):
    new_status: LineItemStatus
    override_reason: OverrideReason
    override_note: str | None = None
    new_approved_amount_inr: float | None = None


class AdjudicationResultRead(BaseSchema):
    id: uuid.UUID
    claim_id: uuid.UUID
    status: AdjudicationStatus
    total_billed_inr: float | None
    total_approved_inr: float | None
    total_deducted_inr: float | None
    deduction_breakdown: dict | None
    confidence_score: float | None
    auto_approved: bool
    flagged_items_count: int
    non_payable_items_count: int
    gemini_model_used: str | None
    finalized_by_id: uuid.UUID | None
    finalized_at: datetime | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    gemini_raw_response: dict | None = None
    line_items: list[LineItemDecisionRead] = []


class FinalizeRequest(BaseSchema):
    adjuster_notes: str | None = None
