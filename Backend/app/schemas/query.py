"""
ClaimQuery Pydantic schemas.
"""
import uuid
from datetime import datetime

from app.models.query import QueryStatus
from app.schemas.common import BaseSchema


class ClaimQueryCreate(BaseSchema):
    query_text: str
    ai_drafted: bool = False


class ClaimQueryRead(BaseSchema):
    id: uuid.UUID
    claim_id: uuid.UUID
    raised_by_id: uuid.UUID | None
    query_text: str
    ai_drafted: bool
    response_text: str | None
    responded_by_id: uuid.UUID | None
    responded_at: datetime | None
    response_documents: list | None
    status: QueryStatus
    resolved_at: datetime | None
    resolution_note: str | None
    created_at: datetime


class QueryResponseRequest(BaseSchema):
    response_text: str
    response_documents: list[dict] | None = None  # [{gcs_key, filename}]


class QueryResolveRequest(BaseSchema):
    resolution_note: str | None = None
