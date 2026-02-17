"""drop maxN and maxA from employee_skills

Revision ID: m8n9o0p1q2r3
Revises: l7m8n9o0p1q2
Create Date: 2026-02-17 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'm8n9o0p1q2r3'
down_revision = 'l7m8n9o0p1q2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop maxN and maxA columns (shift caps removed)
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c['name'] for c in insp.get_columns('employee_skills')]
    if 'maxN' in cols:
        op.drop_column('employee_skills', 'maxN')
    if 'maxA' in cols:
        op.drop_column('employee_skills', 'maxA')


def downgrade() -> None:
    op.add_column('employee_skills', sa.Column('maxN', sa.Integer(), nullable=True, server_default='3'))
    op.add_column('employee_skills', sa.Column('maxA', sa.Integer(), nullable=True, server_default='3'))
