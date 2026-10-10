"""
Analytics, compliance, and reporting schemas.
"""
import uuid
from datetime import datetime

from app.schemas.common import BaseSchema


class HospitalBillingPattern(BaseSchema):
    hospital_org_id: uuid.UUID
    hospital_name: str
    total_claims: int
    total_override_count: int
    common_override_items: list[dict]  # [{item_name, override_count}]
    avg_approval_rate: float
    anomaly_flags: list[str]


class AnomalyRecord(BaseSchema):
    id: uuid.UUID
    claim_id: uuid.UUID
    hospital_org_id: uuid.UUID | None
    anomaly_type: str
    description: str
    severity: str  # "low", "medium", "high"
    detected_at: datetime
    investigated: bool


class SLAReport(BaseSchema):
    period_start: datetime
    period_end: datetime
    total_claims: int
    resolved_within_sla: int
    sla_breached: int
    sla_compliance_rate: float
    avg_resolution_minutes: float


class AdjusterDailyDigest(BaseSchema):
    adjuster_id: uuid.UUID
    date: str
    cases_processed: int
    avg_minutes_per_case: float
    sla_compliance_rate: float
    total_value_adjudicated_inr: float
    override_count: int


class AuditTrailEntry(BaseSchema):
    timestamp: datetime
    claim_id: uuid.UUID | None
    user_id: uuid.UUID | None
    action: str
    entity_type: str
    entity_id: uuid.UUID | None
    details: dict | None


class WebhookSubscriptionCreate(BaseSchema):
    event_type: str
    target_url: str
    secret_token: str | None = None
    filters: dict | None = None


class WebhookSubscriptionRead(BaseSchema):
    id: uuid.UUID
    org_id: uuid.UUID
    event_type: str
    target_url: str
    is_active: bool
    created_at: datetime
