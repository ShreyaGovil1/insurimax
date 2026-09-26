"""
Import this module ONLY in alembic/env.py so that all models are registered
with SQLAlchemy's metadata for autogenerate to work.

Never import this in application code — use app.db.base.Base directly.
"""
from app.db.base import Base  # noqa: F401

# Register all models
from app.models.user import User, Organization  # noqa: F401
from app.models.claim import Claim, ClaimStatusHistory  # noqa: F401
from app.models.document import Document, ExtractionJob  # noqa: F401
from app.models.policy import Policy, PolicyVersion, PolicyRule, NonPayableItem  # noqa: F401
from app.models.adjudication import AdjudicationResult, LineItemDecision  # noqa: F401
from app.models.query import ClaimQuery  # noqa: F401
from app.models.webhook import WebhookSubscription  # noqa: F401
