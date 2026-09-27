"""
Structured output schema for the adjudication agent.

This is passed to the ADK ``Agent`` as ``output_schema`` so Gemini's final
answer is validated/coerced into this shape instead of freeform JSON text.
"""
from typing import Literal

from pydantic import BaseModel, Field

LineItemStatusLiteral = Literal[
    "approved",
    "partially_approved",
    "flagged",
    "non_payable",
    "rejected",
]


class CapAnalysis(BaseModel):
    """Requested-vs-approved breakdown for a line item that hit a policy cap."""

    cap_applies: bool = Field(
        description="Whether a policy cap/sub-limit was breached for this item."
    )
    cap_type: str | None = Field(
        default=None,
        description="Which cap applied, e.g. 'room_rent_cap', 'icu_cap', 'sub_limit'.",
    )
    cap_limit_inr: float | None = Field(
        default=None, description="The capped/allowed amount from the policy."
    )
    requested_amount_inr: float = Field(
        description="The amount actually billed/requested for this item."
    )
    approved_amount_inr: float = Field(
        description="The amount approved for this item after applying the cap."
    )
    proportionate_deduction_ratio: float | None = Field(
        default=None,
        description=(
            "approved/requested ratio from the room-rent or ICU cap breach, "
            "applied to associated charges per IRDAI proportionate-deduction rules."
        ),
    )


class LineItemAdjudication(BaseModel):
    line_number: int
    item_name: str
    item_category: str | None = None

    billed_amount_inr: float
    approved_amount_inr: float
    deducted_amount_inr: float

    status: LineItemStatusLiteral
    confidence: float = Field(
        ge=0,
        le=1,
        description="Model's confidence in this specific line-item decision (0-1).",
    )
    explanation: str = Field(
        description="Cite the exact policy clause or IRDAI rule that was applied."
    )
    policy_rule_reference: str | None = Field(
        default=None, description="Clause reference or rule title this decision cites."
    )
    cap_analysis: CapAnalysis | None = Field(
        default=None,
        description="Populated only when a policy cap/sub-limit applied to this item.",
    )


class DeductionBreakdown(BaseModel):
    room_rent_excess_inr: float = 0
    icu_excess_inr: float = 0
    non_payables_inr: float = 0
    copay_inr: float = 0
    exclusions_inr: float = 0
    sub_limit_deductions_inr: float = 0
    other_deductions_inr: float = 0


class AdjudicationSummary(BaseModel):
    total_billed_inr: float
    total_approved_inr: float
    total_deducted_inr: float
    confidence_score: float = Field(
        ge=0, le=1, description="Overall confidence across the whole claim."
    )
    auto_approvable: bool
    deduction_breakdown: DeductionBreakdown


class AdjudicationAgentOutput(BaseModel):
    adjudication_summary: AdjudicationSummary
    line_item_decisions: list[LineItemAdjudication]
    flags: list[str] = []
    adjudication_notes: list[str] = []
