"""add_need_e_to_demands

Revision ID: g2h3i4j5k6l7
Revises: f1a2b3c4d5e6
Create Date: 2026-01-15 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'g2h3i4j5k6l7'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add need_E column to demands table
    op.add_column('demands', sa.Column('need_E', sa.Integer(), nullable=True, server_default='0'))


def downgrade() -> None:
    # Remove need_E column
    op.drop_column('demands', 'need_E')
