"""
Structured output schema for the adjudication agent.
Senior Medical Claims Auditor & TPA Specialist (IRDAI compliant).

Follows the strict 5-step adjudication output JSON structure:
  adjudication_summary → financial_breakdown → flagged_infractions_or_reasons
  → required_actions → line_item_decisions
"""
from typing import Literal
from pydantic import BaseModel, Field

# ── Literal types ──────────────────────────────────────────────────────────────
AuditDecisionStatusLiteral = Literal["APPROVED", "DENIED", "QUERY_RAISED"]
ActionTakenLiteral = Literal["DEDUCTED", "REJECTED", "FLAGGED_FOR_QUERY"]
LineItemStatusLiteral = Literal[
    "approved",
    "partially_approved",
    "flagged",
    "non_payable",
    "rejected",
]


# ── STEP 1-4: Adjudication Summary ────────────────────────────────────────────
class AdjudicationSummary(BaseModel):
    """Top-level claim decision produced by the 5-step adjudication flow."""
    status: AuditDecisionStatusLiteral = Field(
        description="Overall claim decision: APPROVED, DENIED, or QUERY_RAISED."
    )
    policy_number: str = Field(
        default="UNKNOWN",
        description="Policy reference number extracted from the documents.",
    )
    patient_name: str = Field(
        default="UNKNOWN",
        description="Name of the insured claimant / patient.",
    )
    primary_diagnosis: str = Field(
        default="UNKNOWN",
        description="Primary clinical diagnosis for the admission.",
    )
    internal_audit_timestamp: str = Field(
        default="",
        description="ISO 8601 timestamp when the audit decision was rendered.",
    )


# ── STEP 5: Financial Breakdown ───────────────────────────────────────────────
class FinancialBreakdown(BaseModel):
    """Detailed financial payout calculation from Step 5 of the adjudication."""
    total_billed_amount: float = Field(
        default=0.0,
        description="Total amount billed by the hospital in INR.",
    )
    total_approved_amount: float = Field(
        default=0.0,
        description="Total approved / admissible payout amount in INR.",
    )
    total_deductions: float = Field(
        default=0.0,
        description="Total deductions applied across all categories in INR.",
    )
    room_rent_deduction: float = Field(
        default=0.0,
        description="Direct room rent cap excess deduction in INR.",
    )
    consumables_deduction: float = Field(
        default=0.0,
        description="IRDAI non-payable consumables deduction in INR.",
    )
    proportional_charge_deduction: float = Field(
        default=0.0,
        description="Proportional deduction on associated charges due to room rent breach in INR.",
    )
    co_pay_applied_amount: float = Field(
        default=0.0,
        description="Mandatory co-pay amount deducted from the net payable in INR.",
    )


# ── Flagged Infractions / Reasons ─────────────────────────────────────────────
class FlaggedInfraction(BaseModel):
    """An individual item or section flagged during the adjudication audit."""
    item_name: str = Field(
        description="String name of the line item or section reference being flagged."
    )
    action_taken: ActionTakenLiteral = Field(
        description="Action taken: DEDUCTED, REJECTED, or FLAGGED_FOR_QUERY."
    )
    amount_impacted: float = Field(
        default=0.0,
        description="Financial amount impacted by this infraction in INR.",
    )
    reason_and_policy_citation: str = Field(
        description=(
            "Thorough explanation detailing why this item was adjusted, "
            "referencing specific document pages or policy clauses."
        ),
    )


# ── Required Actions (Query / Denial) ────────────────────────────────────────
class RequiredActions(BaseModel):
    """Actions required from hospital or denial rationale."""
    hospital_queries: list[str] = Field(
        default_factory=list,
        description=(
            "Clear, numbered questions specifying exactly what documents "
            "or data points the hospital billing desk needs to resubmit "
            "to clear the check. Only populate if status is QUERY_RAISED."
        ),
    )
    denial_rationale: str | None = Field(
        default=None,
        description=(
            "Clear, legally robust explanation of why the claim was rejected "
            "under the policy terms. Only populate if status is DENIED."
        ),
    )


# ── Cap Analysis (sub-model for line items) ───────────────────────────────────
class CapAnalysis(BaseModel):
    """Details of any cap / sub-limit applied to a line item."""
    cap_applies: bool = Field(default=False)
    cap_type: str | None = None
    cap_limit_inr: float | None = None
    requested_amount_inr: float = 0.0
    approved_amount_inr: float = 0.0
    proportionate_deduction_ratio: float | None = None


# ── Per-line-item Decision ────────────────────────────────────────────────────
class LineItemAdjudication(BaseModel):
    """Individual line-item adjudication decision."""
    line_number: int
    item_name: str
    item_category: str | None = None
    billed_amount_inr: float
    approved_amount_inr: float
    deducted_amount_inr: float
    status: LineItemStatusLiteral
    confidence: float = Field(ge=0, le=1, default=0.95)
    explanation: str
    policy_rule_reference: str | None = None
    cap_analysis: CapAnalysis | None = None


# ── Top-level Agent Output ────────────────────────────────────────────────────
class AdjudicationAgentOutput(BaseModel):
    """
    Complete output of the adjudication agent.
    This is the single JSON object the agent must produce.
    """
    adjudication_summary: AdjudicationSummary
    financial_breakdown: FinancialBreakdown = Field(default_factory=FinancialBreakdown)
    flagged_infractions_or_reasons: list[FlaggedInfraction] = Field(default_factory=list)
    required_actions: RequiredActions = Field(default_factory=RequiredActions)
    line_item_decisions: list[LineItemAdjudication] = Field(default_factory=list)
    # Internal flags (not part of user-facing schema but useful for service-layer logic)
    flags: list[str] = Field(default_factory=list)
