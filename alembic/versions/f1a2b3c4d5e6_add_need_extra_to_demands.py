"""add_need_extra_to_demands

Revision ID: f1a2b3c4d5e6
Revises: d055db82125d
Create Date: 2026-01-15 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import sqlite


# revision identifiers, used by Alembic.
revision = 'f1a2b3c4d5e6'
down_revision = 'd055db82125d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add need_extra JSON column to demands table
    # For SQLite, JSON is stored as TEXT; for PostgreSQL, use native JSON type
    # Use with_variant to handle both cases
    op.add_column('demands', sa.Column('need_extra', sa.JSON().with_variant(sa.Text(), 'sqlite'), nullable=True, server_default=sa.text("'{}'")))


def downgrade() -> None:
    # Remove need_extra column
    op.drop_column('demands', 'need_extra')
