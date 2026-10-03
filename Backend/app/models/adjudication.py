"""
Adjudication result and per-line-item decision models.
"""
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class AdjudicationStatus(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    FINALIZED = "finalized"


class LineItemStatus(str, enum.Enum):
    APPROVED = "approved"
    FLAGGED = "flagged"
    REJECTED = "rejected"
    NON_PAYABLE = "non_payable"
    PARTIALLY_APPROVED = "partially_approved"
    PENDING = "pending"


class OverrideReason(str, enum.Enum):
    UPCODING_DETECTED = "upcoding_detected"
    INCORRECT_POLICY_APPLICATION = "incorrect_policy_application"
    DOCUMENT_ILLEGIBLE = "document_illegible"
    CLINICAL_NECESSITY = "clinical_necessity"
    HOSPITAL_CLARIFICATION = "hospital_clarification"
    ADJUSTER_DISCRETION = "adjuster_discretion"
    OTHER = "other"


class AdjudicationResult(Base):
    __tablename__ = "adjudication_results"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("claims.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    status: Mapped[AdjudicationStatus] = mapped_column(
        Enum(AdjudicationStatus, name="adjudication_status_enum"),
        nullable=False,
        default=AdjudicationStatus.PENDING,
    )

    # Aggregate amounts
    total_billed_inr: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_approved_inr: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_deducted_inr: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Per-category deduction breakdown
    deduction_breakdown: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # e.g. {"room_rent_excess": 12000, "non_payables": 14000, "unmatched_pharmacy": 6000}

    # Overall AI confidence (0-1)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Gemini raw response (for audit trail)
    gemini_raw_response: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    gemini_model_used: Mapped[str | None] = mapped_column(String(128), nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Flags
    auto_approved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    flagged_items_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    non_payable_items_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    finalized_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    claim: Mapped["Claim"] = relationship("Claim", back_populates="adjudication_result", lazy="raise")  # noqa: F821
    line_items: Mapped[list["LineItemDecision"]] = relationship(
        "LineItemDecision",
        back_populates="adjudication_result",
        cascade="all, delete-orphan",
        order_by="LineItemDecision.line_number",
        lazy="raise",  # force explicit selectinload — never lazy load in async context
    )


class LineItemDecision(Base):
    """Per-line-item decision with explanation and optional adjuster override."""

    __tablename__ = "line_item_decisions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    adjudication_result_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("adjudication_results.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    item_name: Mapped[str] = mapped_column(String(512), nullable=False)
    item_category: Mapped[str | None] = mapped_column(String(100), nullable=True)

    billed_amount_inr: Mapped[float] = mapped_column(Float, nullable=False)
    approved_amount_inr: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    deducted_amount_inr: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    ai_status: Mapped[LineItemStatus] = mapped_column(
        Enum(LineItemStatus, name="line_item_status_enum"),
        nullable=False,
        default=LineItemStatus.PENDING,
    )
    # Final status after potential override
    final_status: Mapped[LineItemStatus] = mapped_column(
        Enum(LineItemStatus, name="line_item_status_enum"),
        nullable=False,
        default=LineItemStatus.PENDING,
    )

    # AI explanation with policy clause citations
    ai_explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    policy_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("policy_rules.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Citation trace: which document page/section backed this decision
    citation_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Adjuster override fields
    is_overridden: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    override_reason: Mapped[OverrideReason | None] = mapped_column(
        Enum(OverrideReason, name="override_reason_enum"), nullable=True
    )
    override_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    overridden_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    overridden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    adjudication_result: Mapped["AdjudicationResult"] = relationship(
        "AdjudicationResult", back_populates="line_items"
    )
