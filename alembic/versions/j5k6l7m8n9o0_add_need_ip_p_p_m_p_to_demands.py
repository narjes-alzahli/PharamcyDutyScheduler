"""add_need_ip_p_p_m_p_to_demands

Revision ID: j5k6l7m8n9o0
Revises: h3i4j5k6l7m8
Create Date: 2026-01-16 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'j5k6l7m8n9o0'
down_revision = 'i4j5k6l7m8n9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add need_IP_P, need_P, need_M_P columns to demands table
    op.add_column('demands', sa.Column('need_IP_P', sa.Integer(), nullable=True, server_default='0'))
    op.add_column('demands', sa.Column('need_P', sa.Integer(), nullable=True, server_default='0'))
    op.add_column('demands', sa.Column('need_M_P', sa.Integer(), nullable=True, server_default='0'))


def downgrade() -> None:
    # Remove need_IP_P, need_P, need_M_P columns
    op.drop_column('demands', 'need_M_P')
    op.drop_column('demands', 'need_P')
    op.drop_column('demands', 'need_IP_P')
