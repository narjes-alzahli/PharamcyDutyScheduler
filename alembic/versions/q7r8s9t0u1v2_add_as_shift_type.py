"""add AS shift type

Revision ID: q7r8s9t0u1v2
Revises: p1q2r3s4t6
Create Date: 2026-04-13 00:00:00.000000
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "q7r8s9t0u1v2"
down_revision = "p1q2r3s4t6"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        INSERT INTO shift_types (code, description, color_hex, is_working_shift, is_active)
        SELECT 'AS', 'All Shifts', '#c4b5fd', TRUE, TRUE
        WHERE NOT EXISTS (
            SELECT 1 FROM shift_types WHERE code = 'AS'
        )
        """
    )


def downgrade():
    op.execute("DELETE FROM shift_types WHERE code = 'AS'")
