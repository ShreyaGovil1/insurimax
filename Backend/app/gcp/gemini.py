"""
Gemini (Google Generative AI / Vertex AI) client wrapper.

Supports two modes controlled by settings.VERTEX_AI_ENABLED:
  - False (default / local dev): google-generativeai SDK with API key
  - True  (GCP production)     : google-cloud-aiplatform / Vertex AI

All calls are wrapped in asyncio.run_in_executor so they don't block the
FastAPI event loop.
"""
import asyncio
import json
import logging
from functools import lru_cache
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)


# ── Client factory ────────────────────────────────────────────────────────────

@lru_cache
def _get_genai_model(model_name: str):
    """Returns a google.generativeai GenerativeModel (API-key mode)."""
    import google.generativeai as genai  # type: ignore

    genai.configure(api_key=settings.GOOGLE_API_KEY)
    return genai.GenerativeModel(
        model_name=model_name,
        generation_config={
            "temperature": 0.1,       # low temp for deterministic extraction
            "top_p": 0.95,
            "response_mime_type": "application/json",
        },
    )


@lru_cache
def _get_vertex_model(model_name: str):
    """Returns a Vertex AI GenerativeModel (service-account / ADC mode)."""
    import vertexai  # type: ignore
    from vertexai.generative_models import GenerativeModel  # type: ignore

    vertexai.init(
        project=settings.GOOGLE_CLOUD_PROJECT,
        location=settings.GOOGLE_CLOUD_LOCATION,
    )
    return GenerativeModel(model_name)


# ── Core call helper ──────────────────────────────────────────────────────────

async def generate_json(
    prompt: str,
    inline_data: list[dict] | None = None,
    model_name: str | None = None,
) -> tuple[dict | list, int, int]:
    """
    Send a prompt to Gemini and expect a JSON response.

    Args:
        prompt:       The text prompt (system + user combined).
        inline_data:  Optional list of {"mime_type": str, "data": bytes} dicts
                      for multimodal (image / PDF) inputs.
        model_name:   Override the default model.

    Returns:
        (parsed_json, prompt_token_count, completion_token_count)
    """
    chosen_model = model_name or settings.GEMINI_MODEL
    loop = asyncio.get_event_loop()

    def _call() -> tuple[dict | list, int, int]:
        if settings.VERTEX_AI_ENABLED:
            return _call_vertex(chosen_model, prompt, inline_data)
        else:
            return _call_genai(chosen_model, prompt, inline_data)

    return await loop.run_in_executor(None, _call)


def _call_genai(
    model_name: str,
    prompt: str,
    inline_data: list[dict] | None,
) -> tuple[dict | list, int, int]:
    """google-generativeai path."""
    import google.generativeai as genai  # type: ignore
    from google.generativeai.types import HarmBlockThreshold, HarmCategory  # type: ignore

    model = _get_genai_model(model_name)

    parts: list[Any] = [prompt]
    if inline_data:
        for item in inline_data:
            parts.append({"inline_data": item})

    response = model.generate_content(
        parts,
        safety_settings={
            HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
        },
    )

    text = response.text
    parsed = _safe_parse_json(text)

    usage = response.usage_metadata
    prompt_tokens = getattr(usage, "prompt_token_count", 0) or 0
    completion_tokens = getattr(usage, "candidates_token_count", 0) or 0

    return parsed, prompt_tokens, completion_tokens


def _call_vertex(
    model_name: str,
    prompt: str,
    inline_data: list[dict] | None,
) -> tuple[dict | list, int, int]:
    """Vertex AI path."""
    from vertexai.generative_models import GenerativeModel, Part  # type: ignore

    model = _get_vertex_model(model_name)

    parts: list[Any] = [prompt]
    if inline_data:
        for item in inline_data:
            parts.append(
                Part.from_data(data=item["data"], mime_type=item["mime_type"])
            )

    response = model.generate_content(parts)
    text = response.text
    parsed = _safe_parse_json(text)

    usage = response.usage_metadata
    prompt_tokens = getattr(usage, "prompt_token_count", 0) or 0
    completion_tokens = getattr(usage, "candidates_token_count", 0) or 0

    return parsed, prompt_tokens, completion_tokens


def _safe_parse_json(text: str) -> dict | list:
    """Parse JSON from Gemini response, stripping markdown code fences if present."""
    text = text.strip()
    if text.startswith("```"):
        # Strip ```json ... ``` or ``` ... ```
        lines = text.split("\n")
        # Remove first and last fence lines
        inner = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        text = inner.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse Gemini JSON response: %s\nRaw: %s", exc, text[:500])
        raise ValueError(f"Gemini returned non-JSON content: {text[:200]}") from exc


# ── Specialised prompt builders ───────────────────────────────────────────────

EXTRACTION_SYSTEM_PROMPT = """
You are InsuriMax's document extraction engine.
Extract structured data from the provided hospital documents (itemized bill, prescription, discharge summary).
Return ONLY valid JSON — no markdown, no explanation, no prose.

Output schema:
{
  "patient": {
    "name": "string",
    "age": number | null,
    "gender": "string | null",
    "uhid": "string | null",
    "admission_date": "ISO8601 | null",
    "discharge_date": "ISO8601 | null",
    "diagnosis": ["string"],
    "procedures": ["string"]
  },
  "hospital": {
    "name": "string",
    "ward_type": "general | semi-private | private | ICU | null",
    "room_rent_per_day_inr": number | null,
    "icu_charges_per_day_inr": number | null
  },
  "line_items": [
    {
      "line_number": number,
      "item_name": "string",
      "item_category": "room_rent | icu | pharmacy | procedure | consultation | lab | consumables | other",
      "quantity": number,
      "unit_price_inr": number,
      "total_price_inr": number,
      "date": "ISO8601 | null",
      "prescribed_by": "string | null",
      "handwritten": boolean
    }
  ],
  "total_billed_inr": number,
  "currency": "INR",
  "extraction_notes": ["string"],
  "confidence_score": number
}
"""

ADJUDICATION_SYSTEM_PROMPT = """
You are InsuriMax's adjudication engine — an expert insurance claims auditor trained on IRDAI regulations.
You will receive:
1. Extracted hospital bill data (JSON)
2. The applicable insurance policy rules (JSON)
3. The IRDAI standard non-payable items list

Your task is to audit every line item and decide: APPROVED, PARTIALLY_APPROVED, FLAGGED, NON_PAYABLE, or REJECTED.

Rules you MUST apply:
- Room rent cap: if room rent exceeds policy cap, apply proportionate deduction to ALL associated charges
- ICU cap: same proportionate logic
- Non-payable items (IRDAI list): ALWAYS reject — no exceptions
- Co-pay clause: calculate co-pay on eligible charges
- Exclusions: any procedure/item matching policy exclusions → REJECTED
- Sub-limits: apply per-category caps

Return ONLY valid JSON. Never invent a policy clause that wasn't provided.
If a rule does not apply, say so explicitly in the explanation.

Output schema:
{
  "adjudication_summary": {
    "total_billed_inr": number,
    "total_approved_inr": number,
    "total_deducted_inr": number,
    "confidence_score": number,
    "auto_approvable": boolean,
    "deduction_breakdown": {
      "room_rent_excess_inr": number,
      "icu_excess_inr": number,
      "non_payables_inr": number,
      "copay_inr": number,
      "exclusions_inr": number,
      "sub_limit_deductions_inr": number,
      "other_deductions_inr": number
    }
  },
  "line_item_decisions": [
    {
      "line_number": number,
      "item_name": "string",
      "item_category": "string",
      "billed_amount_inr": number,
      "approved_amount_inr": number,
      "deducted_amount_inr": number,
      "status": "approved | partially_approved | flagged | non_payable | rejected",
      "explanation": "string — cite the exact policy clause or IRDAI rule",
      "policy_rule_reference": "string | null",
      "confidence": number
    }
  ],
  "flags": ["string"],
  "adjudication_notes": ["string"]
}
"""

PRE_CHECK_SYSTEM_PROMPT = """
You are InsuriMax's pre-submission checker for hospital billing desks.
Review the submitted bill against the patient's policy BEFORE formal claim submission.
Identify likely deductions, non-payable items, and missing documentation so the hospital can correct or annotate upfront.

Return ONLY valid JSON with this schema:
{
  "likely_deductions": [
    {
      "item_name": "string",
      "reason": "string",
      "estimated_deduction_inr": number,
      "severity": "info | warning | error"
    }
  ],
  "missing_documents": ["string"],
  "recommended_corrections": ["string"],
  "estimated_approved_inr": number,
  "submission_readiness_score": number,
  "notes": ["string"]
}
"""

QUERY_DRAFT_SYSTEM_PROMPT = """
You are assisting a TPA claims adjuster draft a professional, concise query to the hospital.
The adjuster needs clarification on a specific item or document in the claim.
Write a polite, specific query in 2-3 sentences.
Return ONLY valid JSON: {"query_text": "string"}
"""
