"""add_skill_ip_p_p_m_p_to_employee_skills

Revision ID: k6l7m8n9o0p1
Revises: j5k6l7m8n9o0
Create Date: 2026-01-16 11:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'k6l7m8n9o0p1'
down_revision = 'j5k6l7m8n9o0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add skill_IP_P, skill_P, skill_M_P columns to employee_skills table with default True (like other standard skills)
    op.add_column('employee_skills', sa.Column('skill_IP_P', sa.Boolean(), nullable=True, server_default='1'))
    op.add_column('employee_skills', sa.Column('skill_P', sa.Boolean(), nullable=True, server_default='1'))
    op.add_column('employee_skills', sa.Column('skill_M_P', sa.Boolean(), nullable=True, server_default='1'))


def downgrade() -> None:
    # Remove skill_IP_P, skill_P, skill_M_P columns
    op.drop_column('employee_skills', 'skill_M_P')
    op.drop_column('employee_skills', 'skill_P')
    op.drop_column('employee_skills', 'skill_IP_P')
