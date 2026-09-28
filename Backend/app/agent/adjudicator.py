"""
Builds and runs the Insurimax adjudication agent (Google ADK).

Public entry point: ``run_adjudication_agent`` — mirrors the return shape of
``app.gcp.gemini.generate_json`` (parsed_json, prompt_tokens,
completion_tokens) so it's a drop-in replacement inside
``adjudication_service.run_adjudication``.
"""
import json
import logging
import os
import uuid
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


def _build_agent(non_payable_items: list[dict]):
    """Fresh Agent per call — its tools close over this claim's non-payable
    list, so the agent can't be safely cached across calls with different data.
    """
    from google.adk.agents import Agent

    check_non_payable_item = make_non_payable_matcher(non_payable_items)
    check_non_payable_item.__name__ = "check_non_payable_item"

    return Agent(
        name="Insurimax_adjudicator",
        model=settings.GEMINI_MODEL,
        description=(
            "Audits a hospital discharge claim's line items against policy "
            "rules and the IRDAI non-payable items list."
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
) -> str:
    return (
        f"## Extracted Bill Data\n{json.dumps(extracted_data, indent=2)}\n\n"
        f"## Policy Rules\n{json.dumps(policy_rules, indent=2)}\n\n"
        f"## IRDAI Non-Payable Items\n{json.dumps(non_payable_items, indent=2)}\n\n"
        "Perform the full adjudication audit now."
    )


async def run_adjudication_agent(
    extracted_data: dict,
    policy_rules: list[dict],
    non_payable_items: list[dict],
) -> tuple[dict, int, int]:
    """
    Runs the ADK adjudication agent end-to-end for one claim.

    Returns:
        (parsed_output, prompt_tokens, completion_tokens) where parsed_output
        matches app.agent.schemas.AdjudicationAgentOutput's shape (as a dict).
    """
    _configure_once()

    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types

    agent = _build_agent(non_payable_items)
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

    user_text = _build_user_message(extracted_data, policy_rules, non_payable_items)
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
        raise ValueError("Adjudication agent produced no final response")

    try:
        raw = json.loads(final_text)
    except json.JSONDecodeError as exc:
        logger.error("Adjudication agent returned non-JSON output: %s", final_text[:500])
        raise ValueError(f"Adjudication agent returned invalid JSON: {exc}") from exc

    validated = AdjudicationAgentOutput.model_validate(raw)
    return validated.model_dump(mode="json"), prompt_tokens, completion_tokens
