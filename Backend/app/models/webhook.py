"""
WebhookSubscription model.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class WebhookSubscription(Base):
    __tablename__ = "webhook_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Event type this subscription listens to
    event_type: Mapped[str] = mapped_column(
        String(100), nullable=False
    )  # e.g. "claim.status_changed", "sla.breach_warning"

    target_url: Mapped[str] = mapped_column(Text, nullable=False)
    secret_token: Mapped[str | None] = mapped_column(String(255), nullable=True)  # HMAC signing key

    # Filters (optional JSONB) e.g. {"hospital_org_id": "..."}
    filters: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
