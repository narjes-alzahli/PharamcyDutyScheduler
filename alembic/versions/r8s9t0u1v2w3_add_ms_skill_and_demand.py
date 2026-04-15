"""add MS skill and demand columns

Revision ID: r8s9t0u1v2w3
Revises: q7r8s9t0u1v2
Create Date: 2026-04-15 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "r8s9t0u1v2w3"
down_revision = "q7r8s9t0u1v2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "employee_skills",
        sa.Column("skill_MS", sa.Boolean(), nullable=True, server_default="0"),
    )
    op.add_column(
        "demands",
        sa.Column("need_MS", sa.Integer(), nullable=True, server_default="0"),
    )

    op.execute(
        """
        INSERT INTO shift_types (code, description, color_hex, is_working_shift, is_active)
        SELECT 'MS', 'Medical Store', '#ffffff', TRUE, TRUE
        WHERE NOT EXISTS (
            SELECT 1 FROM shift_types WHERE code = 'MS'
        )
        """
    )

    # Enable MS skill for all existing staff rows.
    op.execute('UPDATE employee_skills SET "skill_MS" = TRUE')


def downgrade() -> None:
    op.drop_column("demands", "need_MS")
    op.drop_column("employee_skills", "skill_MS")
