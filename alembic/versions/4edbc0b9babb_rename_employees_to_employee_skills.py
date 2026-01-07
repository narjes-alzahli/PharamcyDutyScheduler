"""rename_employees_to_employee_skills

Revision ID: 4edbc0b9babb
Revises: 65d4ded2d76d
Create Date: 2026-01-07 10:45:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = '4edbc0b9babb'
down_revision = '65d4ded2d76d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == 'sqlite'
    
    # Rename table
    if is_sqlite:
        # SQLite doesn't support RENAME TABLE directly in migrations
        # Use batch mode to recreate table
        op.rename_table('employees', 'employee_skills')
    else:
        op.rename_table('employees', 'employee_skills')
    
    # Rename indexes
    op.drop_index('ix_employees_name', table_name='employee_skills')
    op.create_index('ix_employee_skills_name', 'employee_skills', ['name'], unique=True)
    
    op.drop_index('ix_employees_id', table_name='employee_skills')
    op.create_index('ix_employee_skills_id', 'employee_skills', ['id'], unique=False)
    
    op.drop_index('ix_employees_user_id', table_name='employee_skills')
    op.create_index('ix_employee_skills_user_id', 'employee_skills', ['user_id'], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == 'sqlite'
    
    # Rename indexes back
    op.drop_index('ix_employee_skills_user_id', table_name='employee_skills')
    op.create_index('ix_employees_user_id', 'employee_skills', ['user_id'], unique=True)
    
    op.drop_index('ix_employee_skills_id', table_name='employee_skills')
    op.create_index('ix_employees_id', 'employee_skills', ['id'], unique=False)
    
    op.drop_index('ix_employee_skills_name', table_name='employee_skills')
    op.create_index('ix_employees_name', 'employee_skills', ['name'], unique=True)
    
    # Rename table back
    if is_sqlite:
        op.rename_table('employee_skills', 'employees')
    else:
        op.rename_table('employee_skills', 'employees')
