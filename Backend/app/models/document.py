"""
Document and ExtractionJob models.
Documents are stored in GCS; metadata lives in the DB.
"""
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class DocumentType(str, enum.Enum):
    ITEMIZED_BILL = "itemized_bill"
    PRESCRIPTION = "prescription"
    DISCHARGE_SUMMARY = "discharge_summary"
    POLICY_DOCUMENT = "policy_document"
    LAB_REPORT = "lab_report"
    CONSULTATION_NOTES = "consultation_notes"
    OTHER = "other"


class ExtractionStatus(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("claims.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    doc_type: Mapped[DocumentType] = mapped_column(
        Enum(DocumentType, name="document_type_enum"), nullable=False
    )
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # GCS reference
    gcs_bucket: Mapped[str] = mapped_column(String(255), nullable=False)
    gcs_object_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    gcs_public_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Extraction state
    extraction_status: Mapped[ExtractionStatus] = mapped_column(
        Enum(ExtractionStatus, name="extraction_status_enum"),
        nullable=False,
        default=ExtractionStatus.PENDING,
    )
    extraction_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)

    # OCR-highlighted region data (Gemini returns bounding boxes / text spans)
    ocr_highlights: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    claim: Mapped["Claim"] = relationship("Claim", back_populates="documents")  # noqa: F821
    extraction_jobs: Mapped[list["ExtractionJob"]] = relationship(
        "ExtractionJob", back_populates="document", cascade="all, delete-orphan"
    )


class ExtractionJob(Base):
    """Async extraction job record — allows polling and history."""

    __tablename__ = "extraction_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )

    status: Mapped[ExtractionStatus] = mapped_column(
        Enum(ExtractionStatus, name="extraction_status_enum"),
        nullable=False,
        default=ExtractionStatus.PENDING,
    )

    # Structured output from Gemini (the extracted hospital data payload)
    extracted_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Manual corrections applied by adjuster
    corrected_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    gemini_model_used: Mapped[str | None] = mapped_column(String(128), nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    document: Mapped["Document"] = relationship("Document", back_populates="extraction_jobs")
