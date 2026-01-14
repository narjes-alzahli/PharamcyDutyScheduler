"""add_skill_e_to_employee_skills

Revision ID: h3i4j5k6l7m8
Revises: g2h3i4j5k6l7
Create Date: 2026-01-15 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'h3i4j5k6l7m8'
down_revision = 'g2h3i4j5k6l7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add skill_E column to employee_skills table with default True (like other standard skills)
    op.add_column('employee_skills', sa.Column('skill_E', sa.Boolean(), nullable=True, server_default='1'))


def downgrade() -> None:
    # Remove skill_E column
    op.drop_column('employee_skills', 'skill_E')
