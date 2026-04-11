"""add staff_no to users

Revision ID: n9o0p1q2r3s4
Revises: m8n9o0p1q2r3
Create Date: 2026-04-11

"""
from alembic import op
import sqlalchemy as sa


revision = 'n9o0p1q2r3s4'
down_revision = 'm8n9o0p1q2r3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c['name'] for c in insp.get_columns('users')]
    if 'staff_no' not in cols:
        op.add_column('users', sa.Column('staff_no', sa.String(length=32), nullable=True))
        op.create_index(op.f('ix_users_staff_no'), 'users', ['staff_no'], unique=True)


def downgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c['name'] for c in insp.get_columns('users')]
    if 'staff_no' in cols:
        try:
            op.drop_index(op.f('ix_users_staff_no'), table_name='users')
        except Exception:
            pass
        op.drop_column('users', 'staff_no')
