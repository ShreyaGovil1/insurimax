"""add DRAFT to claim_status_enum; submitted_at becomes nullable

Hospitals now create a claim as a DRAFT, attach documents, then submit it. Only submission
makes the claim visible to the insurer and starts the SLA clock, so a draft has no
submitted_at and no sla_deadline yet.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older PostgreSQL
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE claim_status_enum ADD VALUE IF NOT EXISTS 'DRAFT'")
    op.alter_column("claims", "submitted_at", existing_type=sa.DateTime(timezone=True), nullable=True)


def downgrade() -> None:
    # Drafts were never submitted; stamp them with their creation time so the column can be NOT NULL again.
    op.execute("UPDATE claims SET submitted_at = created_at WHERE submitted_at IS NULL")
    op.alter_column("claims", "submitted_at", existing_type=sa.DateTime(timezone=True), nullable=False)
    # PostgreSQL cannot drop a single enum value; DRAFT stays in the type.
