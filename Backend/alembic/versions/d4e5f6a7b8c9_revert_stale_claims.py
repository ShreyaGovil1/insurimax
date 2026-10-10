"""revert claims marked STALE (stale feature removed)

Restores each stale claim to the status it had before it was marked stale (from the status
history), falling back to IN_REVIEW. History rows are kept for audit, so the STALE value
remains in claim_status_enum.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
"""
from typing import Sequence, Union

from alembic import op

revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE claims c
        SET status = h.from_status
        FROM (
            SELECT DISTINCT ON (claim_id) claim_id, from_status
            FROM claim_status_histories
            WHERE to_status = 'STALE'
            ORDER BY claim_id, created_at DESC
        ) h
        WHERE c.id = h.claim_id
          AND c.status = 'STALE'
          AND h.from_status IS NOT NULL
          AND h.from_status <> 'STALE'
        """
    )
    op.execute("UPDATE claims SET status = 'IN_REVIEW' WHERE status = 'STALE'")


def downgrade() -> None:
    # Data-only revert; the original stale markings are preserved in claim_status_histories.
    pass
