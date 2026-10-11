"""
Builds and runs the Insurimax adjudication agent (Google ADK).

Public entry point: ``run_adjudication_agent`` — returns
(parsed_json, prompt_tokens, completion_tokens) so it's a drop-in
replacement inside ``adjudication_service.run_adjudication``.

The output JSON matches the strict 5-step adjudication schema defined
in ``schemas.py`` (AdjudicationAgentOutput).
"""
import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from functools import lru_cache

from app.agent.prompts import ADJUDICATION_AGENT_INSTRUCTION
from app.agent.schemas import AdjudicationAgentOutput
from app.agent.tools import (
    apply_proportionate_deduction,
    calculate_cap_deduction,
    calculate_copay,
    make_non_payable_matcher,
)
from app.core.config import settings

logger = logging.getLogger(__name__)

_APP_NAME = "Insurimax-adjudication"


def _configure_google_genai_auth() -> None:
    """Points the google-genai SDK (used internally by ADK) at the same
    credentials as app.gcp.gemini, via the environment variables it reads.
    """
    if settings.VERTEX_AI_ENABLED:
        os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "true"
        os.environ["GOOGLE_CLOUD_PROJECT"] = settings.GOOGLE_CLOUD_PROJECT
        os.environ["GOOGLE_CLOUD_LOCATION"] = settings.GOOGLE_CLOUD_LOCATION
    else:
        os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "false"
        if settings.GOOGLE_API_KEY:
            os.environ["GOOGLE_API_KEY"] = settings.GOOGLE_API_KEY


@lru_cache
def _configure_once() -> bool:
    _configure_google_genai_auth()
    return True


def _build_agent(non_payable_items: list[dict], model_name: str | None = None):
    """Fresh Agent per call — its tools close over this claim's non-payable
    list, so the agent can't be safely cached across calls with different data.
    """
    from google.adk.agents import Agent

    check_non_payable_item = make_non_payable_matcher(non_payable_items)
    check_non_payable_item.__name__ = "check_non_payable_item"

    chosen_model = model_name or settings.GEMINI_MODEL

    return Agent(
        name="Insurimax_adjudicator",
        model=chosen_model,
        description=(
            "Audits a hospital discharge claim against policy rules "
            "and the IRDAI non-payable items list using a strict "
            "5-step sequential adjudication flow."
        ),
        instruction=ADJUDICATION_AGENT_INSTRUCTION,
        tools=[
            check_non_payable_item,
            calculate_cap_deduction,
            apply_proportionate_deduction,
            calculate_copay,
        ],
        output_schema=AdjudicationAgentOutput,
    )


def _build_user_message(
    extracted_data: dict,
    policy_rules: list[dict],
    non_payable_items: list[dict],
    claim_patient_name: str | None = None,
    claim_hospital_name: str | None = None,
    policy_evidence: list[dict] | None = None,
) -> str:
    claim_context = {}
    if claim_patient_name:
        claim_context["registered_patient_name"] = claim_patient_name
    if claim_hospital_name:
        claim_context["registered_hospital_name"] = claim_hospital_name

    parts = []
    if claim_context:
        parts.append(f"## Insured Claim Context\n{json.dumps(claim_context, indent=2)}")
    parts.extend([
        f"## Extracted Bill Data\n{json.dumps(extracted_data, indent=2)}",
        f"## Policy Rules\n{json.dumps(policy_rules, indent=2)}",
        f"## IRDAI Non-Payable Items\n{json.dumps(non_payable_items, indent=2)}",
        (
            "## Policy Evidence (passages retrieved from the uploaded policy document; "
            "cite them by evidence_id in policy_evidence_ids)\n"
            + json.dumps(policy_evidence or [], indent=2)
        ),
        (
            "Perform the full 5-step adjudication audit now.\n"
            "CRITICAL: Validate that the patient name on the bill exactly matches "
            "the registered claimant name. If mismatched, status must be DENIED "
            "with identity mismatch recorded in flagged_infractions_or_reasons "
            "and denial_rationale."
        ),
    ])
    return "\n\n".join(parts)


def _deterministic_adjudication_fallback(
    extracted_data: dict,
    policy_rules: list[dict],
    non_payable_items: list[dict],
    claim_patient_name: str | None = None,
    claim_hospital_name: str | None = None,
) -> tuple[dict, int, int]:
    """
    Deterministic rule-based audit fallback used when Google's LLM endpoints
    experience temporary 503 UNAVAILABLE or rate limits.
    Audits items directly using IRDAI non-payable rules and policy cap
    calculation tools.  Produces output matching the new 5-step schema.
    """
    logger.info("Executing deterministic IRDAI rule-based adjudication audit fallback...")
    raw_items = extracted_data.get("line_items") or extracted_data.get("items") or []

    matcher = make_non_payable_matcher(non_payable_items)

    # Find relevant policy rules
    room_cap_rule = next(
        (r for r in policy_rules if "room" in (r.get("rule_type") or "").lower()), None
    )
    copay_rule = next(
        (r for r in policy_rules if "copay" in (r.get("rule_type") or "").lower()), None
    )

    line_decisions = []
    flagged_infractions = []
    total_billed = 0.0
    total_approved = 0.0
    total_deducted = 0.0
    consumables_deduction = 0.0
    room_rent_deduction = 0.0
    proportional_deduction = 0.0
    copay_deduction = 0.0

    # Track proportionate ratio if room rent cap is breached
    proportionate_ratio = 1.0

    for idx, item in enumerate(raw_items):
        name = item.get("item_name") or item.get("name") or f"Item {idx + 1}"
        cat = (item.get("item_category") or item.get("category") or "other").lower()
        billed = float(
            item.get("total_price_inr")
            or item.get("total_amount")
            or item.get("total_price")
            or 0.0
        )
        total_billed += billed

        # 1. Check IRDAI non-payable list
        np_match = matcher(name, cat)
        if np_match.get("is_non_payable"):
            line_decisions.append({
                "line_number": item.get("line_number", idx + 1),
                "item_name": name,
                "item_category": cat,
                "billed_amount_inr": billed,
                "approved_amount_inr": 0.0,
                "deducted_amount_inr": billed,
                "status": "non_payable",
                "confidence": 0.98,
                "explanation": (
                    f"Mandatory IRDAI non-payable item ({np_match.get('category', 'consumable')}: "
                    f"{np_match.get('reason', 'Consumable excluded from claim payout')})."
                ),
                "policy_rule_reference": "IRDAI Non-Payable Schedule Section 1",
                "cap_analysis": None,
            })
            flagged_infractions.append({
                "item_name": name,
                "action_taken": "DEDUCTED",
                "amount_impacted": billed,
                "reason_and_policy_citation": (
                    f"IRDAI non-payable item: {np_match.get('reason', 'excluded consumable')}. "
                    f"Ref: IRDAI Non-Payable Schedule."
                ),
            })
            total_deducted += billed
            consumables_deduction += billed
            continue

        # 2. Check Room Rent Cap
        if "room" in cat and room_cap_rule:
            limit_data = room_cap_rule.get("limit_data") or {}
            cap_limit = float(
                limit_data.get("max_amount_per_day_inr")
                or limit_data.get("cap_amount_inr")
                or 5000.0
            )
            cap_res = calculate_cap_deduction(billed, cap_limit, "room_rent_cap")
            if cap_res["cap_applies"]:
                proportionate_ratio = cap_res["proportionate_deduction_ratio"]
                line_decisions.append({
                    "line_number": item.get("line_number", idx + 1),
                    "item_name": name,
                    "item_category": cat,
                    "billed_amount_inr": billed,
                    "approved_amount_inr": cap_res["approved_amount_inr"],
                    "deducted_amount_inr": cap_res["deducted_amount_inr"],
                    "status": "partially_approved",
                    "confidence": 0.95,
                    "explanation": (
                        f"Billed room charge of ₹{billed:,.2f} exceeds policy "
                        f"daily cap of ₹{cap_limit:,.2f}."
                    ),
                    "policy_rule_reference": (
                        room_cap_rule.get("clause_reference")
                        or room_cap_rule.get("title")
                        or "Room Rent Cap Clause"
                    ),
                    "cap_analysis": cap_res,
                })
                flagged_infractions.append({
                    "item_name": name,
                    "action_taken": "DEDUCTED",
                    "amount_impacted": cap_res["deducted_amount_inr"],
                    "reason_and_policy_citation": (
                        f"Room rent ₹{billed:,.2f} exceeds cap ₹{cap_limit:,.2f}. "
                        f"Excess deducted per {room_cap_rule.get('clause_reference', 'Room Rent Cap Clause')}."
                    ),
                })
                total_approved += cap_res["approved_amount_inr"]
                total_deducted += cap_res["deducted_amount_inr"]
                room_rent_deduction += cap_res["deducted_amount_inr"]
                continue

        # 3. Apply proportionate deduction if room rent breach exists
        if proportionate_ratio < 1.0 and cat in (
            "doctor", "nursing", "surgeon", "anesthetist", "ot", "operation",
            "doctor_visit", "nursing_fee", "operation_theater",
        ):
            prop_res = apply_proportionate_deduction(billed, proportionate_ratio)
            prop_deducted = prop_res["deducted_amount_inr"]
            prop_approved = prop_res["approved_amount_inr"]
            line_decisions.append({
                "line_number": item.get("line_number", idx + 1),
                "item_name": name,
                "item_category": cat,
                "billed_amount_inr": billed,
                "approved_amount_inr": prop_approved,
                "deducted_amount_inr": prop_deducted,
                "status": "partially_approved",
                "confidence": 0.95,
                "explanation": (
                    f"Proportionate deduction applied (ratio {proportionate_ratio:.4f}) "
                    f"due to room rent cap breach."
                ),
                "policy_rule_reference": "IRDAI Proportionate Deduction Rule",
                "cap_analysis": None,
            })
            if prop_deducted > 0:
                flagged_infractions.append({
                    "item_name": name,
                    "action_taken": "DEDUCTED",
                    "amount_impacted": prop_deducted,
                    "reason_and_policy_citation": (
                        f"Proportionate deduction (ratio {proportionate_ratio:.4f}) "
                        f"applied due to room rent cap breach per IRDAI guidelines."
                    ),
                })
            total_approved += prop_approved
            total_deducted += prop_deducted
            proportional_deduction += prop_deducted
            continue

        # 4. Standard payable item
        line_decisions.append({
            "line_number": item.get("line_number", idx + 1),
            "item_name": name,
            "item_category": cat,
            "billed_amount_inr": billed,
            "approved_amount_inr": billed,
            "deducted_amount_inr": 0.0,
            "status": "approved",
            "confidence": 0.95,
            "explanation": "Medically justified treatment charge approved in full under standard policy coverage.",
            "policy_rule_reference": "Standard Covered Benefit",
            "cap_analysis": None,
        })
        total_approved += billed

    # Apply co-pay if applicable
    if copay_rule and total_approved > 0:
        limit_data = copay_rule.get("limit_data") or {}
        copay_pct = float(limit_data.get("copay_percentage") or limit_data.get("percentage") or 0)
        if copay_pct > 0:
            copay_res = calculate_copay(total_approved, copay_pct)
            copay_deduction = copay_res["copay_amount_inr"]
            total_approved = copay_res["approved_amount_inr"]
            total_deducted += copay_deduction
            flagged_infractions.append({
                "item_name": "Co-payment Deduction",
                "action_taken": "DEDUCTED",
                "amount_impacted": copay_deduction,
                "reason_and_policy_citation": (
                    f"Mandatory co-pay of {copay_pct}% applied per "
                    f"{copay_rule.get('clause_reference', 'Co-payment Clause')}."
                ),
            })

    # ── Identity mismatch check ────────────────────────────────────────────────
    flags = ["Rule-based verification applied (high demand failover on Gemini endpoint)"]
    has_identity_mismatch = False
    bill_patient = extracted_data.get("patient") or {}
    bill_patient_name = (bill_patient.get("name") or "").strip()
    status = "APPROVED"
    denial_rationale = None

    if claim_patient_name and bill_patient_name:
        if bill_patient_name.lower() != claim_patient_name.strip().lower():
            has_identity_mismatch = True
            status = "DENIED"
            total_approved = 0.0
            denial_rationale = (
                f"CRITICAL IDENTITY MISMATCH: Patient name on hospital bill "
                f"('{bill_patient_name}') does not match registered claimant "
                f"('{claim_patient_name}'). Insurance validity rules require "
                f"an exact match. Claim denied per policy eligibility clause."
            )
            flags.insert(0, denial_rationale)
            flagged_infractions.insert(0, {
                "item_name": "Patient Identity Verification (Step 1)",
                "action_taken": "REJECTED",
                "amount_impacted": total_billed,
                "reason_and_policy_citation": denial_rationale,
            })

    now_iso = datetime.now(timezone.utc).isoformat()

    output = {
        "adjudication_summary": {
            "status": status,
            "policy_number": "UNKNOWN",
            "patient_name": bill_patient_name or (claim_patient_name or "UNKNOWN"),
            "primary_diagnosis": extracted_data.get("diagnosis", "UNKNOWN"),
            "internal_audit_timestamp": now_iso,
        },
        "financial_breakdown": {
            "total_billed_amount": round(total_billed, 2),
            "total_approved_amount": round(total_approved, 2),
            "total_deductions": round(total_deducted, 2),
            "room_rent_deduction": round(room_rent_deduction, 2),
            "consumables_deduction": round(consumables_deduction, 2),
            "proportional_charge_deduction": round(proportional_deduction, 2),
            "co_pay_applied_amount": round(copay_deduction, 2),
        },
        "flagged_infractions_or_reasons": flagged_infractions,
        "required_actions": {
            "hospital_queries": [],
            "denial_rationale": denial_rationale,
        },
        "line_item_decisions": line_decisions,
        "flags": flags,
    }

    validated = AdjudicationAgentOutput.model_validate(output)
    return validated.model_dump(mode="json"), 0, 0


async def run_adjudication_agent(
    extracted_data: dict,
    policy_rules: list[dict],
    non_payable_items: list[dict],
    claim_patient_name: str | None = None,
    claim_hospital_name: str | None = None,
    policy_evidence: list[dict] | None = None,
) -> tuple[dict, int, int]:
    """
    Runs the ADK adjudication agent end-to-end for one claim.
    Includes automated failover from Pro -> Flash -> Deterministic IRDAI rules engine
    when Gemini endpoints experience temporary 503 UNAVAILABLE or high demand spikes.

    Returns:
        (parsed_output, prompt_tokens, completion_tokens) where parsed_output
        matches app.agent.schemas.AdjudicationAgentOutput's shape (as a dict).
    """
    _configure_once()

    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types

    # Candidate models to attempt in order
    candidate_models = [
        settings.GEMINI_MODEL,
        settings.GEMINI_FLASH_MODEL,
    ]
    # Remove duplicate models while preserving order
    models_to_try = []
    for m in candidate_models:
        if m and m not in models_to_try:
            models_to_try.append(m)

    last_error: Exception | None = None

    for model_name in models_to_try:
        try:
            logger.info("Running adjudication agent with model: %s", model_name)
            agent = _build_agent(non_payable_items, model_name=model_name)
            session_service = InMemorySessionService()
            session = await session_service.create_session(
                app_name=_APP_NAME,
                user_id="adjudication-service",
                session_id=str(uuid.uuid4()),
            )
            runner = Runner(
                app_name=_APP_NAME,
                agent=agent,
                session_service=session_service,
            )

            user_text = _build_user_message(
                extracted_data,
                policy_rules,
                non_payable_items,
                claim_patient_name=claim_patient_name,
                claim_hospital_name=claim_hospital_name,
                policy_evidence=policy_evidence,
            )
            new_message = types.Content(role="user", parts=[types.Part(text=user_text)])

            final_text: str | None = None
            prompt_tokens = 0
            completion_tokens = 0

            async for event in runner.run_async(
                user_id="adjudication-service",
                session_id=session.id,
                new_message=new_message,
            ):
                usage = getattr(event, "usage_metadata", None)
                if usage is not None:
                    prompt_tokens += getattr(usage, "prompt_token_count", 0) or 0
                    completion_tokens += getattr(usage, "candidates_token_count", 0) or 0

                if event.is_final_response() and event.content and event.content.parts:
                    text_parts = [p.text for p in event.content.parts if p.text]
                    if text_parts:
                        final_text = "".join(text_parts)

            if not final_text:
                raise ValueError(f"Adjudication agent ({model_name}) produced no final response")

            try:
                raw = json.loads(final_text)
            except json.JSONDecodeError as exc:
                logger.error("Adjudication agent returned non-JSON output: %s", final_text[:500])
                raise ValueError(f"Adjudication agent returned invalid JSON: {exc}") from exc

            validated = AdjudicationAgentOutput.model_validate(raw)
            return validated.model_dump(mode="json"), prompt_tokens, completion_tokens

        except Exception as exc:
            err_msg = str(exc)
            last_error = exc
            is_capacity_error = (
                "503" in err_msg
                or "UNAVAILABLE" in err_msg
                or "high demand" in err_msg
                or "429" in err_msg
                or "RESOURCE_EXHAUSTED" in err_msg
            )
            if is_capacity_error:
                logger.warning(
                    "Model %s returned capacity error (503/429): %s. Trying next candidate...",
                    model_name,
                    err_msg[:200],
                )
                await asyncio.sleep(1.0)
                continue
            else:
                logger.warning("Adjudication attempt with %s failed: %s", model_name, err_msg[:200])
                continue

    # If all LLM attempts encountered 503 / capacity limits or failed, fallback to deterministic rules
    logger.warning(
        "All LLM models failed or were unavailable (%s). Falling back to deterministic IRDAI rules engine.",
        last_error,
    )
    return _deterministic_adjudication_fallback(
        extracted_data=extracted_data,
        policy_rules=policy_rules,
        non_payable_items=non_payable_items,
        claim_patient_name=claim_patient_name,
        claim_hospital_name=claim_hospital_name,
    )
