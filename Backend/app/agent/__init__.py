"""
DischargePulse adjudication agent — built on Google ADK.

Replaces the single, loosely-instructed Gemini prompt in
``app.gcp.gemini.ADJUDICATION_SYSTEM_PROMPT`` with an ADK ``Agent`` that:

  - Follows an explicit, step-by-step audit procedure (see ``prompts.py``)
  - Calls deterministic Python tools (see ``tools.py``) for every cap /
    co-pay / proportionate-deduction calculation instead of doing the
    arithmetic itself, so numbers can't be hallucinated
  - Emits a strict, schema-validated JSON output (see ``schemas.py``) with a
    confidence score per line item and, for any capped item, the requested
    vs. approved amount
"""
from app.agent.adjudicator import run_adjudication_agent

__all__ = ["run_adjudication_agent"]
