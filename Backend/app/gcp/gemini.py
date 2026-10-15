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
from app.core.telemetry import get_tracer

logger = logging.getLogger(__name__)
_tracer = get_tracer(__name__)


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
def _get_vertex_model(model_name: str, location: str | None = None):
    """Returns a Vertex AI GenerativeModel (service-account / ADC mode)."""
    import vertexai  # type: ignore
    from vertexai.generative_models import GenerativeModel  # type: ignore

    loc = location or settings.GOOGLE_CLOUD_LOCATION
    vertexai.init(
        project=settings.GOOGLE_CLOUD_PROJECT,
        location=loc,
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

    with _tracer.start_as_current_span("gemini.generate_json") as span:
        span.set_attribute("gemini.model", chosen_model)
        span.set_attribute("gemini.has_inline_data", inline_data is not None)
        span.set_attribute("gemini.inline_data_count", len(inline_data) if inline_data else 0)
        span.set_attribute("gemini.prompt_length", len(prompt))

        def _call() -> tuple[dict | list, int, int]:
            if settings.VERTEX_AI_ENABLED:
                try:
                    return _call_vertex(chosen_model, prompt, inline_data)
                except Exception as exc:
                    logger.warning("Vertex AI call failed (%s); attempting fallback", exc)
                    if settings.GOOGLE_API_KEY:
                        try:
                            return _call_genai(chosen_model, prompt, inline_data)
                        except Exception as genai_exc:
                            logger.warning("google-generativeai fallback also failed: %s", genai_exc)
                    raise
            else:
                return _call_genai(chosen_model, prompt, inline_data)

        result, prompt_tokens, completion_tokens = await loop.run_in_executor(None, _call)

        span.set_attribute("gemini.prompt_tokens", prompt_tokens)
        span.set_attribute("gemini.completion_tokens", completion_tokens)
        span.set_attribute("gemini.total_tokens", prompt_tokens + completion_tokens)

        return result, prompt_tokens, completion_tokens


def _call_genai(
    model_name: str,
    prompt: str,
    inline_data: list[dict] | None,
) -> tuple[dict | list, int, int]:
    """google-generativeai path with model fallback."""
    import google.generativeai as genai  # type: ignore
    from google.generativeai.types import HarmBlockThreshold, HarmCategory  # type: ignore

    candidate_models = [model_name]
    simplified = model_name.replace("-002", "").replace("-001", "")
    if simplified not in candidate_models:
        candidate_models.append(simplified)
    for fallback in ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.1-flash-lite", "gemini-1.5-flash"]:
        if fallback not in candidate_models:
            candidate_models.append(fallback)

    parts: list[Any] = [prompt]
    if inline_data:
        for item in inline_data:
            parts.append({"inline_data": item})

    last_exc = None
    for m_name in candidate_models:
        try:
            model = _get_genai_model(m_name)
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
        except Exception as exc:
            last_exc = exc
            logger.warning("google-generativeai generation with %s failed: %s", m_name, exc)
            continue

    raise last_exc or RuntimeError("All google-generativeai model attempts failed")


def _call_vertex(
    model_name: str,
    prompt: str,
    inline_data: list[dict] | None,
) -> tuple[dict | list, int, int]:
    """Vertex AI path with model and location fallbacks."""
    from vertexai.generative_models import GenerativeModel, Part  # type: ignore

    parts: list[Any] = [prompt]
    if inline_data:
        for item in inline_data:
            parts.append(
                Part.from_data(data=item["data"], mime_type=item["mime_type"])
            )

    # Models to try in order
    candidate_models = [model_name]
    simplified = model_name.replace("-002", "").replace("-001", "")
    if simplified not in candidate_models:
        candidate_models.append(simplified)
    for fallback in ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash"]:
        if fallback not in candidate_models:
            candidate_models.append(fallback)

    # Locations to try: configured location first, then us-central1
    candidate_locations = [settings.GOOGLE_CLOUD_LOCATION]
    if "us-central1" not in candidate_locations:
        candidate_locations.append("us-central1")

    # Try the chosen model in every location before substituting another model, so a model
    # that isn't offered in the configured region still runs as chosen (see vertex_locations()
    # in app.services.ai_model_service, which lists models from these same locations).
    last_exc = None
    for m_name in candidate_models:
        for loc in candidate_locations:
            try:
                model = _get_vertex_model(m_name, loc)
                response = model.generate_content(parts)
                text = response.text
                parsed = _safe_parse_json(text)

                usage = response.usage_metadata
                prompt_tokens = getattr(usage, "prompt_token_count", 0) or 0
                completion_tokens = getattr(usage, "candidates_token_count", 0) or 0

                return parsed, prompt_tokens, completion_tokens
            except Exception as exc:
                last_exc = exc
                logger.warning("Vertex AI generation with %s in %s failed: %s", m_name, loc, exc)
                continue

    raise last_exc or RuntimeError("All Vertex AI generation attempts failed")


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

# Charges are read from every claim document, not only ones uploaded as bills: a pharmacy invoice,
# OPD/diagnostic receipt or a bill page inside a discharge-summary PDF must all reach adjudication.
# The "bill" block lets the backend reconcile several bills (see app/services/bill_consolidation.py).
_BILLING_FIELDS = """  "bill": {
    "bill_number": "string | null (the bill / invoice / receipt number printed on this document)",
    "bill_date": "ISO8601 | null",
    "issuer_name": "string | null (hospital, pharmacy, laboratory or diagnostic centre that issued it)",
    "document_role": "bill | itemised_breakup | reference_charge_sheet | null",
    "included_in_bill_number": "string | null",
    "claim_phase": "pre_hospitalisation | hospitalisation | post_hospitalisation | null"
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
      "handwritten": boolean,
      "summarises_other_bill": boolean,
      "referenced_bill_number": "string | null",
      "source": { "page": number, "text": "string" }
    }
  ],
  "total_billed_inr": number | null,"""

_BILLING_RULES = """
BILLING RULES (apply to every document that lists priced charges):
- line_items: one row per charged service or item exactly as printed. Never add payments, advances, deposits,
  refunds, sub-totals or grand totals as line items. If the document has no priced charges, use [] and null total.
- bill.document_role:
  * "bill" - an actual bill, invoice, cash memo or receipt for charges (hospital final/interim bill, pharmacy
    invoice, OPD / laboratory / radiology receipt, ambulance bill).
  * "itemised_breakup" - the document details charges that another bill carries as a single total (e.g. it states
    it is "transferred to", "credited to", "included in" or "part of" another bill / the final bill).
  * "reference_charge_sheet" - a tariff, rate list, price schedule, estimate or quotation; nothing was charged.
- bill.included_in_bill_number: the other bill's number when the document says its amount is carried into it.
- A line that only carries the total of a separate bill/invoice (e.g. "Pharmacy as per bill no. X",
  "Lab charges - see enclosed invoice") sets summarises_other_bill=true and referenced_bill_number to that number
  (null if not printed).
- bill.claim_phase: hospitalisation for charges during the admission; pre_/post_hospitalisation for charges before
  admission or after discharge (when the document makes this clear), else null.
"""

EXTRACTION_SYSTEM_PROMPT = """
You are InsuriMax's document extraction engine.
Extract structured data from the provided billing document (hospital bill, pharmacy invoice, receipt, charge sheet).
Return ONLY valid JSON — no markdown, no explanation, no prose.""" + _BILLING_RULES + """
CITATIONS: every object inside a list (line items, medications, tests, coverage items, amounts) MUST include "source": {"page": <1-based page number of this file where it appears>, "text": "<the exact text of that row/line copied verbatim from the document, same spelling, numbers and punctuation; for table rows include every cell of the row>"}. For an image file use page 1.

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
""" + _BILLING_FIELDS + """
  "currency": "INR",
  "extraction_notes": ["string"],
  "confidence_score": number
}
"""

_EXTRACTION_PREAMBLE = """
You are InsuriMax's document extraction engine.
{doc_label}
Return ONLY valid JSON — no markdown, no explanation, no prose.
Use null for anything not present in the document; never guess or copy values from other kinds of documents.
CITATIONS: every object inside a list (line items, medications, tests, coverage items, amounts) MUST include "source": {{"page": <1-based page number of this file where it appears>, "text": "<the exact text of that row/line copied verbatim from the document, same spelling, numbers and punctuation; for table rows include every cell of the row>"}}. For an image file use page 1.
{notes}
Output schema:
"""

_COMMON_TAIL = '''  "extraction_notes": ["string"],
  "confidence_score": number
}
'''

_PATIENT = '''  "patient": {
    "name": "string | null",
    "age": number | null,
    "gender": "string | null",
    "uhid": "string | null"
  },'''

EXTRACTION_PROMPTS_BY_DOC_TYPE: dict[str, str] = {
    "discharge_summary": _EXTRACTION_PREAMBLE.format(
        doc_label="The document is a hospital DISCHARGE SUMMARY.", notes=""
    ) + """{
  "patient": {
    "name": "string | null", "age": number | null, "gender": "string | null", "uhid": "string | null",
    "admission_date": "ISO8601 | null", "discharge_date": "ISO8601 | null",
    "diagnosis": ["string"], "procedures": ["string"]
  },
  "hospital": { "name": "string | null" },
  "treating_doctor": "string | null",
  "length_of_stay_days": number | null,
  "condition_at_discharge": "string | null",
  "medications_on_discharge": [{ "name": "string", "dosage": "string | null", "duration": "string | null", "source": { "page": number, "text": "string" } }],
  "follow_up_instructions": "string | null",
""" + _COMMON_TAIL,
    "prescription": _EXTRACTION_PREAMBLE.format(
        doc_label="The document is a doctor's PRESCRIPTION.", notes=""
    ) + """{
""" + _PATIENT + """
  "doctor": { "name": "string | null", "registration_number": "string | null", "specialization": "string | null" },
  "hospital": { "name": "string | null" },
  "prescription_date": "ISO8601 | null",
  "diagnosis": ["string"],
  "medications": [{ "name": "string", "dosage": "string | null", "frequency": "string | null", "duration": "string | null", "route": "string | null", "source": { "page": number, "text": "string" } }],
  "tests_advised": ["string"],
  "advice": "string | null",
""" + _COMMON_TAIL,
    "lab_report": _EXTRACTION_PREAMBLE.format(
        doc_label="The document is a DIAGNOSTIC / LAB REPORT.", notes=""
    ) + """{
""" + _PATIENT + """
  "lab": { "name": "string | null" },
  "referring_doctor": "string | null",
  "report_date": "ISO8601 | null",
  "tests": [{ "test_name": "string", "result": "string | null", "unit": "string | null", "reference_range": "string | null", "flag": "normal | high | low | abnormal | null", "source": { "page": number, "text": "string" } }],
  "summary": "string | null",
""" + _COMMON_TAIL,
    "consultation_notes": _EXTRACTION_PREAMBLE.format(
        doc_label="The document is a doctor's CONSULTATION NOTE.", notes=""
    ) + """{
""" + _PATIENT + """
  "doctor": { "name": "string | null", "registration_number": "string | null", "specialization": "string | null" },
  "hospital": { "name": "string | null" },
  "consultation_date": "ISO8601 | null",
  "chief_complaints": ["string"],
  "findings": "string | null",
  "diagnosis": ["string"],
  "treatment_plan": "string | null",
  "follow_up": "string | null",
""" + _COMMON_TAIL,
    "policy_document": _EXTRACTION_PREAMBLE.format(
        doc_label="The document is an INSURANCE POLICY document / schedule.",
        notes=(
            "IMPORTANT: the organisation named on this document is the INSURER / TPA that issued the policy. "
            "It is NOT a hospital. Never output a 'hospital' field. "
            "Fill 'coverage_items' with EVERY benefit, coverage and add-on listed in the schedule/certificate "
            "(one row each, covered=true) and every explicitly excluded/not-covered item (covered=false)."
        ),
    ) + """{
  "policy": {
    "insurer_name": "string | null",
    "tpa_name": "string | null",
    "policy_number": "string | null",
    "product_name": "string | null",
    "policyholder_name": "string | null",
    "policy_start_date": "ISO8601 | null",
    "policy_end_date": "ISO8601 | null",
    "sum_insured_inr": number | null,
    "co_pay_percent": number | null,
    "room_rent_cap_inr_per_day": number | null,
    "icu_cap_inr_per_day": number | null
  },
  "coverage_items": [
    {
      "category": "string (e.g. In-patient, Day care, Pre/Post hospitalization, Maternity, Ambulance, Add-on cover)",
      "benefit": "string (the covered item / benefit / treatment as named in the policy)",
      "covered": true | false | null,
      "limit_inr": number | null,
      "limit_description": "string | null (e.g. '1% of sum insured per day', 'up to 60 days before admission')",
      "conditions": "string | null (waiting period, sub-conditions, co-pay)",
      "source": { "page": number, "text": "string" }
    }
  ],
  "insured_members": [{ "name": "string", "relation": "string | null", "date_of_birth": "ISO8601 | null" }],
  "waiting_periods": [{ "type": "string", "months": number | null }],
  "sub_limits": [{ "category": "string", "limit_inr": number | null }],
  "exclusions": ["string"],
""" + _COMMON_TAIL,
    "other": _EXTRACTION_PREAMBLE.format(
        doc_label="The document is a SUPPORTING document of unknown type.", notes=""
    ) + """{
  "document_title": "string | null",
  "summary": "string",
  "key_fields": { "<label>": "string" },
  "people": ["string"],
  "organizations": ["string"],
  "dates": [{ "label": "string", "date": "ISO8601" }],
  "amounts": [{ "label": "string", "amount_inr": number, "source": { "page": number, "text": "string" } }],
""" + _COMMON_TAIL,
}

# Bills are often uploaded under another section, or bound into the same PDF as clinical papers:
# every non-policy document type also extracts any priced charges it contains.
_EMBEDDED_BILLING_NOTE = (
    "\nIf this document (or any page of it) also lists priced charges - a bill, invoice, receipt or charge "
    "sheet - extract them as well; otherwise leave line_items empty." + _BILLING_RULES
)
for _doc_type in ("discharge_summary", "prescription", "lab_report", "consultation_notes", "other"):
    EXTRACTION_PROMPTS_BY_DOC_TYPE[_doc_type] = (
        EXTRACTION_PROMPTS_BY_DOC_TYPE[_doc_type]
        .replace("Output schema:", _EMBEDDED_BILLING_NOTE + "\nOutput schema:", 1)
        .replace(_COMMON_TAIL, _BILLING_FIELDS + "\n" + _COMMON_TAIL, 1)
    )


CLASSIFY_PROMPT = """
Classify the attached document. Return ONLY JSON:
{"document_type": "itemized_bill | discharge_summary | prescription | lab_report | consultation_notes | policy_document | other", "confidence": number}
Use policy_document for insurance policy schedules, certificates, policy wording and benefit tables.
Use itemized_bill for ANY bill, invoice, cash memo, receipt or charge sheet whose main content is priced
charges - hospital bills, pharmacy invoices, OPD / laboratory / radiology receipts, ambulance bills, tariffs.
"""


BILL_RECONCILIATION_PROMPT = """
You are a senior TPA billing auditor. Below is every document on ONE health insurance claim that lists
priced charges, as already extracted (header details and every line with its amount). Documents may have been
uploaded under any section, and names, wording and numbering differ between hospitals, pharmacies and labs.
Work out from the MEANING of the documents how they relate, so that every charge is claimed exactly once.

For each document decide its role:
- "bill": an actual bill / invoice / receipt for charges that no other uploaded bill already includes
  (e.g. the hospital final bill; separate pre- or post-hospitalisation OPD, pharmacy, lab or imaging receipts).
- "itemised_breakup": a detailed bill whose total another uploaded bill already carries as ONE line
  (e.g. final bill line "Pharmacy charges 11,339.40" and a pharmacy invoice for 11,339.40 with the medicines;
  or "Investigations" on the final bill and a lab bill itemising them). Set "itemises" to that line.
  Use dates, patient, issuer, amounts, the nature of the items and any reference / transfer wording -
  the line need not name the document or its number. Amounts normally match; if they differ slightly, still
  link when the meaning is clearly the same and mention the difference in "reason".
- "reference_charge_sheet": a tariff, rate list, price schedule, estimate or quotation - nothing was charged.
- "duplicate": another copy of a document already in the list (same charges); set "duplicate_of".
- "payment_receipt": only proves a payment (advance, deposit, settlement) for charges billed elsewhere.
Also give the claim_phase of each document's charges relative to the admission (pre_hospitalisation,
hospitalisation, post_hospitalisation, or null if unclear).
Never link a document to itself, never link two documents to the same line, and do not invent links: if a
detailed bill's total is not carried by any line, it is a "bill".

Return ONLY JSON:
{"documents": [{"document_id": "string", "role": "bill | itemised_breakup | reference_charge_sheet | duplicate | payment_receipt",
  "itemises": {"document_id": "string", "line_number": number} | null, "duplicate_of": "string | null",
  "claim_phase": "pre_hospitalisation | hospitalisation | post_hospitalisation | null",
  "reason": "one plain sentence a claims adjuster can verify"}]}
"""


def get_extraction_prompt(doc_type: str) -> str:
    """System prompt for a document type (itemized bills use the original line-item schema)."""
    return EXTRACTION_PROMPTS_BY_DOC_TYPE.get(doc_type, EXTRACTION_SYSTEM_PROMPT)


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
