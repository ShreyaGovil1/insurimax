"""
Document and ExtractionJob Pydantic schemas.
"""
import uuid
from datetime import datetime

from app.models.document import DocumentType, ExtractionStatus
from app.schemas.common import BaseSchema


class DocumentRead(BaseSchema):
    id: uuid.UUID
    claim_id: uuid.UUID
    doc_type: DocumentType
    original_filename: str
    mime_type: str
    file_size_bytes: int | None
    gcs_bucket: str
    gcs_object_key: str
    extraction_status: ExtractionStatus
    extraction_confidence: float | None
    ocr_highlights: list | None
    uploaded_by_id: uuid.UUID | None
    created_at: datetime


class DocumentSignedUrl(BaseSchema):
    document_id: uuid.UUID
    signed_url: str
    expires_at: datetime


class ExtractionJobRead(BaseSchema):
    id: uuid.UUID
    document_id: uuid.UUID
    claim_id: uuid.UUID
    status: ExtractionStatus
    extracted_payload: dict | None
    corrected_payload: dict | None
    gemini_model_used: str | None
    prompt_tokens: int | None
    completion_tokens: int | None
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime


class ExtractedDataPatch(BaseSchema):
    """Manual correction of extracted fields — partial update."""
    corrected_payload: dict
    correction_note: str | None = None
