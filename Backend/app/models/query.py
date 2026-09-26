"""
ClaimQuery model — hospital query loop.
"""
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class QueryStatus(str, enum.Enum):
    OPEN = "open"
    RESPONDED = "responded"
    RESOLVED = "resolved"
    CLOSED = "closed"


class ClaimQuery(Base):
    __tablename__ = "claim_queries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("claims.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Who raised the query
    raised_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # AI-drafted or manual query text
    query_text: Mapped[str] = mapped_column(Text, nullable=False)
    ai_drafted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Hospital response
    response_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    responded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Clarification documents (GCS references)
    response_documents: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    status: Mapped[QueryStatus] = mapped_column(
        Enum(QueryStatus, name="query_status_enum"),
        nullable=False,
        default=QueryStatus.OPEN,
        index=True,
    )

    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    claim: Mapped["Claim"] = relationship("Claim", back_populates="queries")  # noqa: F821
