"""backfill: QUERIED claims with no open query go back to IN_REVIEW

Claims now return to IN_REVIEW automatically once every query is answered. This applies
that rule to claims that got stuck in QUERIED before it existed.

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
"""
from typing import Sequence, Union

from alembic import op

revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STUCK = """
    SELECT c.id FROM claims c
    WHERE c.status = 'QUERIED'
      AND NOT EXISTS (SELECT 1 FROM claim_queries q WHERE q.claim_id = c.id AND q.status = 'OPEN')
"""


def upgrade() -> None:
    op.execute(
        f"""
        INSERT INTO claim_status_histories (id, claim_id, from_status, to_status, note, created_at)
        SELECT gen_random_uuid(), id, 'QUERIED', 'IN_REVIEW', 'All queries answered by the hospital', now()
        FROM ({_STUCK}) stuck
        """
    )
    op.execute(f"UPDATE claims SET status = 'IN_REVIEW' WHERE id IN ({_STUCK})")


def downgrade() -> None:
    pass
