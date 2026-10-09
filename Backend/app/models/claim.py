"""
Claim and ClaimStatusHistory models.
"""
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    Enum,
    Float,
    ForeignKey,
    String,
    Text,
    Integer,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ClaimStatus(str, enum.Enum):
    SUBMITTED = "submitted"
    DOCUMENTS_PENDING = "documents_pending"
    IN_REVIEW = "in_review"
    EXTRACTION_IN_PROGRESS = "extraction_in_progress"
    ADJUDICATION_IN_PROGRESS = "adjudication_in_progress"
    QUERIED = "queried"           # waiting on hospital clarification
    ESCALATED = "escalated"
    AUTO_APPROVED = "auto_approved"
    APPROVED = "approved"
    PARTIALLY_APPROVED = "partially_approved"
    REJECTED = "rejected"
    FINALIZED = "finalized"


class Claim(Base):
    __tablename__ = "claims"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # Reference numbers
    claim_number: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )
    policy_number: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    uhid: Mapped[str | None] = mapped_column(String(64), nullable=True)  # unique health ID

    # Patient info
    patient_name: Mapped[str] = mapped_column(String(255), nullable=False)
    patient_dob: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    patient_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Hospital info
    hospital_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hospital_org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Insurance
    insurer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    insurer_org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    tpa_org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Policy link
    policy_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("policy_versions.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Amounts (INR)
    billed_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    approved_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    deducted_amount: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Status
    status: Mapped[ClaimStatus] = mapped_column(
        Enum(ClaimStatus, name="claim_status_enum"),
        nullable=False,
        default=ClaimStatus.SUBMITTED,
        index=True,
    )

    # Adjuster assignment
    assigned_adjuster_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # SLA tracking
    sla_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sla_breached: Mapped[bool] = mapped_column(default=False, nullable=False)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # AI confidence score (0-1) from last adjudication run
    ai_confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Deduction breakdown summary (JSONB for flexibility)
    deduction_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Notes
    adjuster_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Submission metadata
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    documents: Mapped[list["Document"]] = relationship(  # noqa: F821
        "Document", back_populates="claim", cascade="all, delete-orphan"
    )
    adjudication_result: Mapped["AdjudicationResult | None"] = relationship(  # noqa: F821
        "AdjudicationResult", back_populates="claim", uselist=False
    )
    status_history: Mapped[list["ClaimStatusHistory"]] = relationship(
        "ClaimStatusHistory", back_populates="claim", order_by="ClaimStatusHistory.created_at"
    )
    queries: Mapped[list["ClaimQuery"]] = relationship(  # noqa: F821
        "ClaimQuery", back_populates="claim", cascade="all, delete-orphan"
    )


class ClaimStatusHistory(Base):
    __tablename__ = "claim_status_histories"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("claims.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    from_status: Mapped[ClaimStatus | None] = mapped_column(
        Enum(ClaimStatus, name="claim_status_enum"), nullable=True
    )
    to_status: Mapped[ClaimStatus] = mapped_column(
        Enum(ClaimStatus, name="claim_status_enum"), nullable=False
    )
    changed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    claim: Mapped["Claim"] = relationship("Claim", back_populates="status_history")
