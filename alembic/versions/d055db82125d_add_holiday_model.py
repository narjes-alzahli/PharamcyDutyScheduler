"""add_holiday_model

Revision ID: d055db82125d
Revises: 4edbc0b9babb
Create Date: 2026-01-07 11:01:22.657268

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd055db82125d'
down_revision = '4edbc0b9babb'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Check if table already exists (for SQLite compatibility)
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()
    
    if 'holidays' not in tables:
    op.create_table('holidays',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('month', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('date', name='uq_holiday_date')
    )
    op.create_index(op.f('ix_holidays_date'), 'holidays', ['date'], unique=True)
    op.create_index(op.f('ix_holidays_id'), 'holidays', ['id'], unique=False)
    op.create_index(op.f('ix_holidays_month'), 'holidays', ['month'], unique=False)
    op.create_index(op.f('ix_holidays_year'), 'holidays', ['year'], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()
    
    if 'holidays' in tables:
    op.drop_index(op.f('ix_holidays_year'), table_name='holidays')
    op.drop_index(op.f('ix_holidays_month'), table_name='holidays')
    op.drop_index(op.f('ix_holidays_id'), table_name='holidays')
    op.drop_index(op.f('ix_holidays_date'), table_name='holidays')
    op.drop_table('holidays')

