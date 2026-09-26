"""
Policy Library Pydantic schemas.
"""
import uuid
from datetime import datetime

from pydantic import Field

from app.models.policy import RuleType
from app.schemas.common import BaseSchema


# ── Policy ─────────────────────────────────────────────────────────────────

class PolicyCreate(BaseSchema):
    name: str = Field(..., min_length=2, max_length=255)
    insurer_name: str = Field(..., min_length=2, max_length=255)
    policy_type: str | None = None
    description: str | None = None
    org_id: uuid.UUID | None = None


class PolicyRead(BaseSchema):
    id: uuid.UUID
    name: str
    insurer_name: str
    policy_type: str | None
    description: str | None
    org_id: uuid.UUID | None
    is_active: bool
    created_at: datetime


# ── PolicyVersion ─────────────────────────────────────────────────────────

class PolicyVersionCreate(BaseSchema):
    version_number: str = Field(..., min_length=1, max_length=50)
    effective_from: datetime | None = None
    effective_to: datetime | None = None
    sum_insured_inr: float | None = Field(None, ge=0)
    is_current: bool = False


class PolicyVersionRead(BaseSchema):
    id: uuid.UUID
    policy_id: uuid.UUID
    version_number: str
    effective_from: datetime | None
    effective_to: datetime | None
    sum_insured_inr: float | None
    is_current: bool
    extraction_status: str
    extracted_by_model: str | None
    gcs_object_key: str | None
    created_at: datetime


# ── PolicyRule ────────────────────────────────────────────────────────────

class PolicyRuleCreate(BaseSchema):
    rule_type: RuleType
    clause_reference: str | None = None
    clause_page: int | None = None
    title: str = Field(..., min_length=2, max_length=255)
    description: str | None = None
    limit_data: dict | None = None
    applies_to_categories: list[str] | None = None


class PolicyRuleRead(BaseSchema):
    id: uuid.UUID
    policy_version_id: uuid.UUID
    rule_type: RuleType
    clause_reference: str | None
    clause_page: int | None
    title: str
    description: str | None
    limit_data: dict | None
    applies_to_categories: list | None
    is_active: bool
    created_at: datetime


class PolicyRulePatch(BaseSchema):
    title: str | None = None
    description: str | None = None
    limit_data: dict | None = None
    is_active: bool | None = None


# ── NonPayableItem ────────────────────────────────────────────────────────

class NonPayableItemCreate(BaseSchema):
    name: str = Field(..., min_length=2, max_length=255)
    description: str | None = None
    category: str | None = None
    irdai_standard: bool = False
    org_id: uuid.UUID | None = None
    keywords: list[str] | None = None


class NonPayableItemRead(BaseSchema):
    id: uuid.UUID
    name: str
    description: str | None
    category: str | None
    irdai_standard: bool
    org_id: uuid.UUID | None
    keywords: list | None
    is_active: bool
    created_at: datetime
