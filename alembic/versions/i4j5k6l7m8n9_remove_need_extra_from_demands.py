"""remove_need_extra_from_demands

Revision ID: i4j5k6l7m8n9
Revises: h3i4j5k6l7m8
Create Date: 2026-01-15 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'i4j5k6l7m8n9'
down_revision = 'h3i4j5k6l7m8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Remove need_extra column from demands table
    # This will automatically remove all existing data in the column
    op.drop_column('demands', 'need_extra')


def downgrade() -> None:
    # Re-add need_extra column (for rollback if needed)
    # For SQLite, JSON is stored as TEXT; for PostgreSQL, use native JSON type
    op.add_column('demands', sa.Column('need_extra', sa.JSON().with_variant(sa.Text(), 'sqlite'), nullable=True, server_default=sa.text("'{}'")))
