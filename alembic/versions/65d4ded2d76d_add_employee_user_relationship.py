"""add_employee_user_relationship

Revision ID: 65d4ded2d76d
Revises: de842b9ea58d
Create Date: 2026-01-07 10:35:54.719761

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = '65d4ded2d76d'
down_revision = 'de842b9ea58d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Check database type and current state
    bind = op.get_bind()
    inspector = inspect(bind)
    is_sqlite = bind.dialect.name == 'sqlite'
    
    # Check if user_id column already exists
    employees_columns = [col['name'] for col in inspector.get_columns('employees')]
    employees_indexes = [idx['name'] for idx in inspector.get_indexes('employees')]
    
    # Add user_id column if it doesn't exist
    if 'user_id' not in employees_columns:
        if is_sqlite:
            # SQLite requires batch mode for ALTER operations
            with op.batch_alter_table('employees', schema=None) as batch_op:
                batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=True))
        else:
            op.add_column('employees', sa.Column('user_id', sa.Integer(), nullable=True))
    
    # Create index if it doesn't exist
    if 'ix_employees_user_id' not in employees_indexes:
        op.create_index('ix_employees_user_id', 'employees', ['user_id'], unique=True)
    
    # SQLite doesn't support ALTER COLUMN for changing nullable/autoincrement
    # These columns are already correct, so we skip the ALTER for SQLite
    if not is_sqlite:
        # PostgreSQL and other databases support ALTER COLUMN
        op.alter_column('leave_types', 'id',
                   existing_type=sa.INTEGER(),
                   nullable=False,
                   autoincrement=True)
        op.alter_column('shift_types', 'id',
                   existing_type=sa.INTEGER(),
                   nullable=False,
                   autoincrement=True)
    
    # Update indexes (works on all databases)
    op.drop_index('ix_leave_types_code', table_name='leave_types')
    op.create_index(op.f('ix_leave_types_code'), 'leave_types', ['code'], unique=True)
    op.drop_index('ix_shift_requests_shift_type_id', table_name='shift_requests')
    op.drop_index('ix_shift_requests_user_id', table_name='shift_requests')
    op.drop_index('ix_shift_types_code', table_name='shift_types')
    op.create_index(op.f('ix_shift_types_code'), 'shift_types', ['code'], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == 'sqlite'
    
    # Restore indexes
    op.drop_index(op.f('ix_shift_types_code'), table_name='shift_types')
    op.create_index('ix_shift_types_code', 'shift_types', ['code'], unique=False)
    op.create_index('ix_shift_requests_user_id', 'shift_requests', ['user_id'], unique=False)
    op.create_index('ix_shift_requests_shift_type_id', 'shift_requests', ['shift_type_id'], unique=False)
    op.drop_index(op.f('ix_leave_types_code'), table_name='leave_types')
    op.create_index('ix_leave_types_code', 'leave_types', ['code'], unique=False)
    
    if not is_sqlite:
        op.alter_column('shift_types', 'id',
                   existing_type=sa.INTEGER(),
                   nullable=True,
                   autoincrement=True)
        op.alter_column('leave_types', 'id',
                   existing_type=sa.INTEGER(),
                   nullable=True,
                   autoincrement=True)
    
    # Drop user_id column
    op.drop_index('ix_employees_user_id', table_name='employees')
    if is_sqlite:
        with op.batch_alter_table('employees', schema=None) as batch_op:
            batch_op.drop_column('user_id')
    else:
        op.drop_column('employees', 'user_id')
