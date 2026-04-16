"""add_employee_demand_schedule_models

Revision ID: de842b9ea58d
Revises: 
Create Date: 2026-01-07 10:21:53.061655

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'de842b9ea58d'
down_revision = None
branch_labels = None
depends_on = None


def _ensure_core_auth_tables() -> None:
    """Create users / leave / shift tables if missing (fresh DB).

    Historically these existed from SQLAlchemy create_all before Alembic; new
    PostgreSQL installs need them before the rest of this revision runs.
    """
    bind = op.get_bind()
    inspector = inspect(bind)
    if inspector.has_table("users"):
        return

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("username", sa.String(), nullable=False),
        sa.Column("password", sa.String(), nullable=False),
        sa.Column("employee_name", sa.String(), nullable=False),
        sa.Column(
            "employee_type",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'Staff'"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=True)

    op.create_table(
        "leave_types",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("color_hex", sa.String(), nullable=True, server_default=sa.text("'#F5F5F5'")),
        sa.Column("counts_as_rest", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_leave_types_id"), "leave_types", ["id"], unique=False)

    op.create_table(
        "shift_types",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("color_hex", sa.String(), nullable=True, server_default=sa.text("'#E5E7EB'")),
        sa.Column("is_working_shift", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_shift_types_id"), "shift_types", ["id"], unique=False)

    op.create_table(
        "leave_requests",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("leave_type_id", sa.Integer(), nullable=False),
        sa.Column("from_date", sa.Date(), nullable=False),
        sa.Column("to_date", sa.Date(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'Pending'"),
        ),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", sa.String(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["leave_type_id"], ["leave_types.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_leave_requests_id"), "leave_requests", ["id"], unique=False)

    op.create_table(
        "shift_requests",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("shift_type_id", sa.Integer(), nullable=False),
        sa.Column("from_date", sa.Date(), nullable=False),
        sa.Column("to_date", sa.Date(), nullable=False),
        sa.Column("force", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'Pending'"),
        ),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", sa.String(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["shift_type_id"], ["shift_types.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_shift_requests_id"), "shift_requests", ["id"], unique=False)


def upgrade() -> None:
    _ensure_core_auth_tables()

    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table('committed_schedules',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('month', sa.Integer(), nullable=False),
    sa.Column('employee_name', sa.String(), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('shift', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('year', 'month', 'employee_name', 'date', name='uq_schedule_entry')
    )
    op.create_index(op.f('ix_committed_schedules_date'), 'committed_schedules', ['date'], unique=False)
    op.create_index(op.f('ix_committed_schedules_employee_name'), 'committed_schedules', ['employee_name'], unique=False)
    op.create_index(op.f('ix_committed_schedules_id'), 'committed_schedules', ['id'], unique=False)
    op.create_index(op.f('ix_committed_schedules_month'), 'committed_schedules', ['month'], unique=False)
    op.create_index(op.f('ix_committed_schedules_year'), 'committed_schedules', ['year'], unique=False)
    op.create_table('demands',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('month', sa.Integer(), nullable=False),
    sa.Column('need_M', sa.Integer(), nullable=True),
    sa.Column('need_IP', sa.Integer(), nullable=True),
    sa.Column('need_A', sa.Integer(), nullable=True),
    sa.Column('need_N', sa.Integer(), nullable=True),
    sa.Column('need_M3', sa.Integer(), nullable=True),
    sa.Column('need_M4', sa.Integer(), nullable=True),
    sa.Column('need_H', sa.Integer(), nullable=True),
    sa.Column('need_CL', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('date', name='uq_demand_date')
    )
    op.create_index(op.f('ix_demands_date'), 'demands', ['date'], unique=False)
    op.create_index(op.f('ix_demands_id'), 'demands', ['id'], unique=False)
    op.create_index(op.f('ix_demands_month'), 'demands', ['month'], unique=False)
    op.create_index(op.f('ix_demands_year'), 'demands', ['year'], unique=False)
    op.create_table('employees',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('skill_M', sa.Boolean(), nullable=True),
    sa.Column('skill_IP', sa.Boolean(), nullable=True),
    sa.Column('skill_A', sa.Boolean(), nullable=True),
    sa.Column('skill_N', sa.Boolean(), nullable=True),
    sa.Column('skill_M3', sa.Boolean(), nullable=True),
    sa.Column('skill_M4', sa.Boolean(), nullable=True),
    sa.Column('skill_H', sa.Boolean(), nullable=True),
    sa.Column('skill_CL', sa.Boolean(), nullable=True),
    sa.Column('clinic_only', sa.Boolean(), nullable=True),
    sa.Column('maxN', sa.Integer(), nullable=True),
    sa.Column('maxA', sa.Integer(), nullable=True),
    sa.Column('min_days_off', sa.Integer(), nullable=True),
    sa.Column('weight', sa.Float(), nullable=True),
    sa.Column('pending_off', sa.Float(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_employees_id'), 'employees', ['id'], unique=False)
    op.create_index(op.f('ix_employees_name'), 'employees', ['name'], unique=True)
    op.create_table('schedule_metrics',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('month', sa.Integer(), nullable=False),
    sa.Column('metrics', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('year', 'month', name='uq_schedule_metrics')
    )
    op.create_index(op.f('ix_schedule_metrics_id'), 'schedule_metrics', ['id'], unique=False)
    op.create_index(op.f('ix_schedule_metrics_month'), 'schedule_metrics', ['month'], unique=False)
    op.create_index(op.f('ix_schedule_metrics_year'), 'schedule_metrics', ['year'], unique=False)
    
    # SQLite doesn't support ALTER COLUMN for changing nullable/autoincrement
    # These columns are already correct, so we skip the ALTER for SQLite
    bind = op.get_bind()
    inspector = inspect(bind)
    is_sqlite = bind.dialect.name == 'sqlite'
    
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
    # Check if indexes exist before dropping (for existing databases)
    indexes = inspector.get_indexes('leave_types')
    if any(idx['name'] == 'ix_leave_types_code' for idx in indexes):
        op.drop_index('ix_leave_types_code', table_name='leave_types')
    op.create_index(op.f('ix_leave_types_code'), 'leave_types', ['code'], unique=True)
    
    if 'shift_requests' in inspector.get_table_names():
        indexes = inspector.get_indexes('shift_requests')
        if any(idx['name'] == 'ix_shift_requests_shift_type_id' for idx in indexes):
            op.drop_index('ix_shift_requests_shift_type_id', table_name='shift_requests')
        if any(idx['name'] == 'ix_shift_requests_user_id' for idx in indexes):
            op.drop_index('ix_shift_requests_user_id', table_name='shift_requests')
    
    indexes = inspector.get_indexes('shift_types')
    if any(idx['name'] == 'ix_shift_types_code' for idx in indexes):
        op.drop_index('ix_shift_types_code', table_name='shift_types')
    op.create_index(op.f('ix_shift_types_code'), 'shift_types', ['code'], unique=True)
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_index(op.f('ix_shift_types_code'), table_name='shift_types')
    op.create_index('ix_shift_types_code', 'shift_types', ['code'], unique=False)
    op.alter_column('shift_types', 'id',
               existing_type=sa.INTEGER(),
               nullable=True,
               autoincrement=True)
    op.create_index('ix_shift_requests_user_id', 'shift_requests', ['user_id'], unique=False)
    op.create_index('ix_shift_requests_shift_type_id', 'shift_requests', ['shift_type_id'], unique=False)
    op.drop_index(op.f('ix_leave_types_code'), table_name='leave_types')
    op.create_index('ix_leave_types_code', 'leave_types', ['code'], unique=False)
    op.alter_column('leave_types', 'id',
               existing_type=sa.INTEGER(),
               nullable=True,
               autoincrement=True)
    op.drop_index(op.f('ix_schedule_metrics_year'), table_name='schedule_metrics')
    op.drop_index(op.f('ix_schedule_metrics_month'), table_name='schedule_metrics')
    op.drop_index(op.f('ix_schedule_metrics_id'), table_name='schedule_metrics')
    op.drop_table('schedule_metrics')
    op.drop_index(op.f('ix_employees_name'), table_name='employees')
    op.drop_index(op.f('ix_employees_id'), table_name='employees')
    op.drop_table('employees')
    op.drop_index(op.f('ix_demands_year'), table_name='demands')
    op.drop_index(op.f('ix_demands_month'), table_name='demands')
    op.drop_index(op.f('ix_demands_id'), table_name='demands')
    op.drop_index(op.f('ix_demands_date'), table_name='demands')
    op.drop_table('demands')
    op.drop_index(op.f('ix_committed_schedules_year'), table_name='committed_schedules')
    op.drop_index(op.f('ix_committed_schedules_month'), table_name='committed_schedules')
    op.drop_index(op.f('ix_committed_schedules_id'), table_name='committed_schedules')
    op.drop_index(op.f('ix_committed_schedules_employee_name'), table_name='committed_schedules')
    op.drop_index(op.f('ix_committed_schedules_date'), table_name='committed_schedules')
    op.drop_table('committed_schedules')
    # ### end Alembic commands ###

