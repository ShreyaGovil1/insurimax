"""Schemas for the admin AI model settings (Gemini model per AI step)."""
from datetime import datetime

from pydantic import BaseModel, Field


class AIStepModel(BaseModel):
    key: str
    label: str
    description: str
    model: str
    default_model: str
    is_default: bool


class AvailableModel(BaseModel):
    id: str
    preset: bool
    on_account: bool | None  # None when the account's model list could not be fetched


class AIModelSettings(BaseModel):
    steps: list[AIStepModel]
    available_models: list[AvailableModel]
    fetch_error: str | None = None
    updated_at: datetime | None = None


class AIModelSettingsUpdate(BaseModel):
    # step key -> model id; null resets the step to its environment default
    models: dict[str, str | None] = Field(default_factory=dict)
