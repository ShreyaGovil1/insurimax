"""three roles only (adjuster, admin, hospital desk); escalation retired

- SENIOR_ADJUSTER users become ADJUSTER (adjusters now hold the former senior permissions).
- PATIENT users, if any, are deactivated and parked as ADJUSTER: patient status is a public,
  login-free page, so these accounts have no remaining purpose.
- ESCALATED claims go back to IN_REVIEW.

PostgreSQL cannot drop single enum values, so the retired labels stay in the types unused.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
"""
from typing import Sequence, Union

from alembic import op

revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE users SET role = 'ADJUSTER' WHERE role = 'SENIOR_ADJUSTER'")
    op.execute("UPDATE users SET role = 'ADJUSTER', is_active = false WHERE role = 'PATIENT'")
    op.execute(
        """
        INSERT INTO claim_status_histories (id, claim_id, from_status, to_status, note, created_at)
        SELECT gen_random_uuid(), id, 'ESCALATED', 'IN_REVIEW', 'Escalation retired: returned to review', now()
        FROM claims WHERE status = 'ESCALATED'
        """
    )
    op.execute("UPDATE claims SET status = 'IN_REVIEW' WHERE status = 'ESCALATED'")


def downgrade() -> None:
    # The former senior adjusters / escalated claims can't be told apart afterwards; nothing to undo.
    pass
