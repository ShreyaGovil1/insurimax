"""add claims.insurer_org_id

Revision ID: b7c1d2e3f4a5
Revises: a396eddb45a6
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7c1d2e3f4a5"
down_revision: Union[str, None] = "a396eddb45a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("claims", sa.Column("insurer_org_id", sa.UUID(), nullable=True))
    op.create_index(op.f("ix_claims_insurer_org_id"), "claims", ["insurer_org_id"], unique=False)
    op.create_foreign_key(
        "fk_claims_insurer_org_id", "claims", "organizations", ["insurer_org_id"], ["id"], ondelete="SET NULL"
    )
    # Best-effort backfill: link existing claims to an insurer organization with the same name
    op.execute(
        """
        UPDATE claims SET insurer_org_id = o.id
        FROM organizations o
        WHERE claims.insurer_org_id IS NULL
          AND o.org_type = 'INSURER'
          AND lower(o.name) = lower(claims.insurer_name)
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_claims_insurer_org_id", "claims", type_="foreignkey")
    op.drop_index(op.f("ix_claims_insurer_org_id"), table_name="claims")
    op.drop_column("claims", "insurer_org_id")
