"""add STALE to claim_status_enum

Revision ID: c3d4e5f6a7b8
Revises: b7c1d2e3f4a5
"""
from typing import Sequence, Union

from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b7c1d2e3f4a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older PostgreSQL
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE claim_status_enum ADD VALUE IF NOT EXISTS 'STALE'")


def downgrade() -> None:
    # PostgreSQL cannot drop a single enum value; claims already marked STALE must stay valid.
    pass
