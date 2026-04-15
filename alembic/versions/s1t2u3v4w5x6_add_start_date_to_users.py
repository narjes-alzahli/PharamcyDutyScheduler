"""add start_date to users

Revision ID: s1t2u3v4w5x6
Revises: r8s9t0u1v2w3
Create Date: 2026-04-15 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "s1t2u3v4w5x6"
down_revision = "r8s9t0u1v2w3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("start_date", sa.Date(), nullable=True))
    op.create_index(op.f("ix_users_start_date"), "users", ["start_date"], unique=False)

    # Baseline all users to October 1st, 2025.
    op.execute("UPDATE users SET start_date = '2025-10-01' WHERE start_date IS NULL")

    # Specific exceptions requested by operations.
    op.execute("UPDATE users SET start_date = '2026-01-18' WHERE lower(username) = 'nasser'")
    op.execute("UPDATE users SET start_date = '2026-05-01' WHERE lower(username) = 'muzna'")

def downgrade() -> None:
    op.drop_index(op.f("ix_users_start_date"), table_name="users")
    op.drop_column("users", "start_date")
