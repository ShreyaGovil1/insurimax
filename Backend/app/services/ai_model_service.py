"""
AI model settings: which Gemini model each AI step uses.

Admins choose a model per step from the admin panel. A step with no choice saved
uses the model from the environment (GEMINI_MODEL / GEMINI_FLASH_MODEL), so a fresh
deployment behaves exactly as before.

Choices live in the ``app_settings`` table under ``ai_models`` and are cached in-process
for a short time, so a change reaches every API instance within ``_CACHE_TTL_SECONDS``.
"""
import asyncio
import logging
import time
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.app_setting import AppSetting

logger = logging.getLogger(__name__)

SETTING_KEY = "ai_models"

# Models offered in the admin panel even when the account's model list can't be fetched.
GEMINI_MODELS = [
    "gemini-4-argon",
    "gemini-3.1-pro-preview",
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-2.5-pro",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash",
]

# Every AI step, in pipeline order: key -> (label, description, env setting it defaults to)
AI_STEPS: dict[str, tuple[str, str, str]] = {
    "document_classification": (
        "Document type detection",
        "Checks an uploaded file is the document type it was uploaded as.",
        "GEMINI_MODEL",
    ),
    "document_extraction": (
        "Document data extraction",
        "Reads bills, discharge summaries and other claim documents into structured data.",
        "GEMINI_MODEL",
    ),
    "bill_reconciliation": (
        "Bill reconciliation",
        "Reads all of a claim's bills together: which are separate bills, itemised breakups, duplicates or tariffs.",
        "GEMINI_MODEL",
    ),
    "policy_extraction": (
        "Policy rule extraction",
        "Reads an uploaded policy wording into structured rules.",
        "GEMINI_MODEL",
    ),
    "adjudication": (
        "Claim adjudication",
        "The AI auditor that decides every line item against the policy.",
        "GEMINI_MODEL",
    ),
    "adjudication_fallback": (
        "Adjudication fallback",
        "Used when the adjudication model is unavailable or overloaded.",
        "GEMINI_FLASH_MODEL",
    ),
    "hospital_precheck": (
        "Hospital pre-check",
        "Flags likely deductions before the hospital submits a claim.",
        "GEMINI_FLASH_MODEL",
    ),
    "query_draft": (
        "Query drafting",
        "Drafts a query to the hospital from the adjuster's notes.",
        "GEMINI_MODEL",
    ),
}

_CACHE_TTL_SECONDS = 30
_overrides_cache: dict = {"value": {}, "loaded_at": 0.0}

_AVAILABLE_TTL_SECONDS = 600
_available_cache: dict = {"models": None, "error": None, "loaded_at": 0.0}


def default_model(step: str) -> str:
    return getattr(settings, AI_STEPS[step][2])


def _clean_overrides(value) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {k: v for k, v in value.items() if k in AI_STEPS and isinstance(v, str) and v}


async def _load_overrides() -> dict[str, str]:
    """Saved per-step choices, cached briefly. Never raises: an AI call must not fail
    because the settings table is unreachable, so it falls back to the last known value."""
    now = time.monotonic()
    if now - _overrides_cache["loaded_at"] < _CACHE_TTL_SECONDS:
        return _overrides_cache["value"]
    try:
        async with AsyncSessionLocal() as db:
            row = await db.get(AppSetting, SETTING_KEY)
        value = _clean_overrides(row.value if row else {})
        _overrides_cache.update(value=value, loaded_at=now)
    except Exception as exc:  # pragma: no cover - depends on the database
        logger.warning("Could not load AI model settings, using the last known values: %s", exc)
    return _overrides_cache["value"]


async def model_for(step: str) -> str:
    """The Gemini model to use for an AI step: the admin's choice, else the env default."""
    overrides = await _load_overrides()
    return overrides.get(step) or default_model(step)


# ── Available models ──────────────────────────────────────────────────────────

def vertex_locations() -> list[str]:
    """Regions Vertex AI calls are made in, in order (mirrors app.gcp.gemini._call_vertex)."""
    locations = [settings.GOOGLE_CLOUD_LOCATION]
    if "us-central1" not in locations:
        locations.append("us-central1")
    return locations


def _fetch_account_models() -> list[str]:
    """Gemini models the configured Google account can use. Uses Vertex AI when enabled and,
    like the Gemini calls themselves, falls back to the API key if Vertex can't be reached."""
    from google import genai  # type: ignore

    if settings.VERTEX_AI_ENABLED:
        try:
            found: set[str] = set()
            for location in vertex_locations():
                client = genai.Client(vertexai=True, project=settings.GOOGLE_CLOUD_PROJECT, location=location)
                found.update(_gemini_names(client.models.list(config={"query_base": True, "page_size": 100})))
            return sorted(found, reverse=True)
        except Exception as exc:
            if not settings.GOOGLE_API_KEY:
                raise
            logger.warning("Listing Vertex AI models failed (%s); trying the API key", exc)
    if settings.GOOGLE_API_KEY:
        client = genai.Client(api_key=settings.GOOGLE_API_KEY)
        return _gemini_names(client.models.list(config={"page_size": 100}))
    raise RuntimeError("No Google credentials configured (VERTEX_AI_ENABLED is off and GOOGLE_API_KEY is unset)")


# Specialised models that can't do the app's text-to-JSON generation
_NON_TEXT_MARKERS = (
    "embedding", "tts", "image", "live", "audio", "transcribe", "translate",
    "computer-use", "robotics", "nano-banana", "omni",
)


def _gemini_names(pager) -> list[str]:
    found: set[str] = set()
    for model in pager:
        name = (getattr(model, "name", "") or "").rsplit("/", 1)[-1]
        if not name.startswith("gemini") or any(marker in name for marker in _NON_TEXT_MARKERS):
            continue
        actions = getattr(model, "supported_actions", None)
        if actions and "generateContent" not in actions:
            continue
        found.add(name)
    return sorted(found, reverse=True)


async def available_models(refresh: bool = False) -> tuple[list[dict], str | None]:
    """Models an admin can choose from: the preset list plus whatever the account reports.

    Returns (models, fetch_error). Each model is {"id", "on_account": bool | None, "preset": bool};
    on_account is None when the account's list could not be fetched.
    """
    now = time.monotonic()
    if refresh or _available_cache["models"] is None or now - _available_cache["loaded_at"] > _AVAILABLE_TTL_SECONDS:
        try:
            fetched = await asyncio.wait_for(asyncio.to_thread(_fetch_account_models), timeout=15)
            _available_cache.update(models=fetched, error=None, loaded_at=now)
        except Exception as exc:
            logger.warning("Could not list Gemini models for the account: %s", exc)
            _available_cache.update(models=[], error=str(exc) or exc.__class__.__name__, loaded_at=now)

    account = _available_cache["models"] or []
    error = _available_cache["error"]
    ids: list[str] = []
    for m in [*GEMINI_MODELS, *account, *(default_model(s) for s in AI_STEPS)]:
        if m and m not in ids:
            ids.append(m)
    models = [
        {"id": m, "preset": m in GEMINI_MODELS, "on_account": (m in account) if error is None else None}
        for m in ids
    ]
    return models, error


# ── Admin read / update ───────────────────────────────────────────────────────

async def get_config(db: AsyncSession, refresh: bool = False) -> dict:
    row = await db.get(AppSetting, SETTING_KEY)
    overrides = _clean_overrides(row.value if row else {})
    models, error = await available_models(refresh=refresh)
    return {
        "steps": [
            {
                "key": key,
                "label": label,
                "description": description,
                "model": overrides.get(key) or default_model(key),
                "default_model": default_model(key),
                "is_default": key not in overrides,
            }
            for key, (label, description, _env) in AI_STEPS.items()
        ],
        "available_models": models,
        "fetch_error": error,
        "updated_at": row.updated_at if row else None,
    }


class InvalidModelChoice(ValueError):
    pass


async def update_config(db: AsyncSession, choices: dict[str, str | None], user_id: uuid.UUID) -> dict:
    """Saves per-step choices. A value of None (or the env default) resets that step to the default."""
    unknown = [k for k in choices if k not in AI_STEPS]
    if unknown:
        raise InvalidModelChoice(f"Unknown AI step(s): {', '.join(sorted(unknown))}")

    models, _ = await available_models()
    allowed = {m["id"] for m in models}

    row = await db.get(AppSetting, SETTING_KEY)
    overrides = _clean_overrides(row.value if row else {})
    for step, model in choices.items():
        if model is None or model == default_model(step):
            overrides.pop(step, None)
            continue
        if model not in allowed:
            raise InvalidModelChoice(f"'{model}' is not an available Gemini model")
        overrides[step] = model

    if row:
        row.value = overrides
        row.updated_by_id = user_id
    else:
        db.add(AppSetting(key=SETTING_KEY, value=overrides, updated_by_id=user_id))
    await db.flush()

    _overrides_cache.update(value=overrides, loaded_at=time.monotonic())
    return await get_config(db)
