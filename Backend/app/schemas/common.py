"""
Shared Pydantic schema utilities.
"""
import uuid
from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class PaginatedResponse(BaseSchema, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


class MessageResponse(BaseSchema):
    message: str


class IDResponse(BaseSchema):
    id: uuid.UUID
