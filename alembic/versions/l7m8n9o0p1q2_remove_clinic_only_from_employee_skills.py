"""remove_clinic_only_from_employee_skills

Revision ID: l7m8n9o0p1q2
Revises: k6l7m8n9o0p1
Create Date: 2026-01-17 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'l7m8n9o0p1q2'
down_revision = 'k6l7m8n9o0p1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Remove clinic_only column from employee_skills table
    # This field is now detected dynamically by checking if employee only has CL skill
    op.drop_column('employee_skills', 'clinic_only')


def downgrade() -> None:
    # Add clinic_only column back (with default False)
    op.add_column('employee_skills', sa.Column('clinic_only', sa.Boolean(), nullable=True, server_default='0'))
