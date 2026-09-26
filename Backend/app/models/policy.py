"""
Policy Library models: Policy, PolicyVersion, PolicyRule, NonPayableItem.
"""
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class RuleType(str, enum.Enum):
    ROOM_RENT_CAP = "room_rent_cap"
    ICU_CAP = "icu_cap"
    COPAY = "copay"
    DEDUCTIBLE = "deductible"
    WAITING_PERIOD = "waiting_period"
    EXCLUSION = "exclusion"
    SUB_LIMIT = "sub_limit"
    PROPORTIONATE_DEDUCTION = "proportionate_deduction"
    PRE_EXISTING_DISEASE = "pre_existing_disease"
    NETWORK_RESTRICTION = "network_restriction"
    OTHER = "other"


class Policy(Base):
    __tablename__ = "policies"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    insurer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    policy_type: Mapped[str | None] = mapped_column(String(100), nullable=True)  # individual, family floater, group
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    versions: Mapped[list["PolicyVersion"]] = relationship(
        "PolicyVersion", back_populates="policy", cascade="all, delete-orphan"
    )


class PolicyVersion(Base):
    __tablename__ = "policy_versions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    policy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("policies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_number: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g. "2024-v3"
    effective_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # GCS reference to original policy PDF
    gcs_bucket: Mapped[str | None] = mapped_column(String(255), nullable=True)
    gcs_object_key: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    # Structured rules extracted/validated from the document
    structured_rules: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    sum_insured_inr: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Extraction tracking
    extraction_status: Mapped[str] = mapped_column(
        String(50), default="pending", nullable=False
    )
    extracted_by_model: Mapped[str | None] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    policy: Mapped["Policy"] = relationship("Policy", back_populates="versions")
    rules: Mapped[list["PolicyRule"]] = relationship(
        "PolicyRule", back_populates="policy_version", cascade="all, delete-orphan"
    )


class PolicyRule(Base):
    """Individual, queryable rule extracted from a policy version."""

    __tablename__ = "policy_rules"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    policy_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("policy_versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    rule_type: Mapped[RuleType] = mapped_column(
        Enum(RuleType, name="rule_type_enum"), nullable=False
    )
    clause_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)  # "Clause 4.2"
    clause_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Structured limit/cap data (flexible JSONB)
    limit_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # e.g. {"cap_per_day_inr": 5000, "proportionate_deduction": true}

    applies_to_categories: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    policy_version: Mapped["PolicyVersion"] = relationship(
        "PolicyVersion", back_populates="rules"
    )


class NonPayableItem(Base):
    """
    Shared IRDAI-standard non-payable items list, plus org-specific additions.
    """

    __tablename__ = "non_payable_items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    irdai_standard: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
    )  # NULL = global/IRDAI standard
    keywords: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # for fuzzy matching
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
