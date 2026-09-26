"""
Claim Pydantic schemas.
"""
import uuid
from datetime import datetime

from pydantic import Field

from app.models.claim import ClaimStatus
from app.schemas.common import BaseSchema


class ClaimCreate(BaseSchema):
    patient_name: str = Field(..., min_length=2, max_length=255)
    patient_dob: datetime | None = None
    patient_phone: str | None = None
    hospital_name: str = Field(..., min_length=2, max_length=255)
    hospital_org_id: uuid.UUID | None = None
    insurer_name: str | None = None
    tpa_org_id: uuid.UUID | None = None
    policy_number: str | None = None
    uhid: str | None = None
    policy_version_id: uuid.UUID | None = None
    billed_amount: float | None = Field(None, ge=0)
    adjuster_notes: str | None = None


class ClaimRead(BaseSchema):
    id: uuid.UUID
    claim_number: str
    patient_name: str
    patient_dob: datetime | None
    hospital_name: str
    insurer_name: str | None
    policy_number: str | None
    billed_amount: float | None
    approved_amount: float | None
    deducted_amount: float | None
    status: ClaimStatus
    assigned_adjuster_id: uuid.UUID | None
    sla_deadline: datetime | None
    sla_breached: bool
    ai_confidence_score: float | None
    deduction_summary: dict | None
    submitted_at: datetime
    finalized_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ClaimSummary(BaseSchema):
    """Lightweight card for the queue view."""
    id: uuid.UUID
    claim_number: str
    patient_name: str
    hospital_name: str
    billed_amount: float | None
    approved_amount: float | None
    status: ClaimStatus
    ai_confidence_score: float | None
    flagged_items_count: int | None = None
    sla_deadline: datetime | None
    sla_breached: bool
    submitted_at: datetime


class ClaimStatusUpdate(BaseSchema):
    status: ClaimStatus
    note: str | None = None


class ClaimAggregateSummary(BaseSchema):
    """Phase 4 summary bar response."""
    claim_id: uuid.UUID
    total_billed_inr: float
    total_approved_inr: float
    total_deducted_inr: float
    deduction_breakdown: dict | None
    flagged_items_count: int
    non_payable_items_count: int
    ai_confidence_score: float | None


class SLAStatus(BaseSchema):
    claim_id: uuid.UUID
    sla_deadline: datetime | None
    remaining_seconds: int | None
    remaining_minutes: int | None
    breach_risk: bool  # True if < 30 min remaining
    sla_breached: bool
