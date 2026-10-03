"""
Bima Bharosa Agent Compatibility Shim
Re-exports canonical functionality from app.services.bima_bharosa_service
to maintain backwards compatibility across legacy imports.
"""

from app.services.bima_bharosa_service import (
    IRDAI_COMPANY_NAMES,
    BANNED_CHARS_REGEX,
    BimaBharosaComplaintPayload,
    sanitize_bima_bharosa_text,
    resolve_irdai_company,
    generate_bima_bharosa_payload,
    run_bima_bharosa_agent,
)

__all__ = [
    "IRDAI_COMPANY_NAMES",
    "BANNED_CHARS_REGEX",
    "BimaBharosaComplaintPayload",
    "sanitize_bima_bharosa_text",
    "resolve_irdai_company",
    "generate_bima_bharosa_payload",
    "run_bima_bharosa_agent",
]
