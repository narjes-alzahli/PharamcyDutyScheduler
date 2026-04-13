"""committed_schedules.user_id for stable staff identity

Revision ID: p1q2r3s4t6
Revises: o0p1q2r3s4t5
Create Date: 2026-04-13

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker


revision = "p1q2r3s4t6"
down_revision = "o0p1q2r3s4t5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        with op.batch_alter_table("committed_schedules", schema=None) as batch_op:
            batch_op.add_column(sa.Column("user_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                "fk_committed_schedules_user_id_users",
                "users",
                ["user_id"],
                ["id"],
                ondelete="SET NULL",
            )
            batch_op.create_index(
                batch_op.f("ix_committed_schedules_user_id"),
                ["user_id"],
                unique=False,
            )
    else:
        op.add_column(
            "committed_schedules",
            sa.Column("user_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_committed_schedules_user_id_users",
            "committed_schedules",
            "users",
            ["user_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(
            op.f("ix_committed_schedules_user_id"),
            "committed_schedules",
            ["user_id"],
            unique=False,
        )

    Session = sessionmaker(bind=bind)
    session = Session()
    try:
        from backend.models import CommittedSchedule, User, EmployeeType

        for row in session.query(CommittedSchedule).filter(
            CommittedSchedule.user_id.is_(None)
        ).all():
            u = (
                session.query(User)
                .filter(
                    User.employee_name == row.employee_name,
                    User.employee_type == EmployeeType.STAFF,
                )
                .first()
            )
            if u:
                row.user_id = u.id
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    op.drop_constraint("uq_schedule_entry", "committed_schedules", type_="unique")

    if is_sqlite:
        op.execute(
            sa.text(
                "CREATE UNIQUE INDEX uq_committed_user_ymd ON committed_schedules "
                "(year, month, user_id, date) WHERE user_id IS NOT NULL"
            )
        )
        op.execute(
            sa.text(
                "CREATE UNIQUE INDEX uq_committed_legacy_ymd ON committed_schedules "
                "(year, month, employee_name, date) WHERE user_id IS NULL"
            )
        )
    else:
        op.execute(
            sa.text(
                "CREATE UNIQUE INDEX uq_committed_user_ymd ON committed_schedules "
                "(year, month, user_id, date) WHERE user_id IS NOT NULL"
            )
        )
        op.execute(
            sa.text(
                "CREATE UNIQUE INDEX uq_committed_legacy_ymd ON committed_schedules "
                "(year, month, employee_name, date) WHERE user_id IS NULL"
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    op.execute(sa.text("DROP INDEX IF EXISTS uq_committed_legacy_ymd"))
    op.execute(sa.text("DROP INDEX IF EXISTS uq_committed_user_ymd"))

    op.create_unique_constraint(
        "uq_schedule_entry",
        "committed_schedules",
        ["year", "month", "employee_name", "date"],
    )

    if is_sqlite:
        with op.batch_alter_table("committed_schedules", schema=None) as batch_op:
            batch_op.drop_index(batch_op.f("ix_committed_schedules_user_id"))
            batch_op.drop_constraint("fk_committed_schedules_user_id_users", type_="foreignkey")
            batch_op.drop_column("user_id")
    else:
        op.drop_index(op.f("ix_committed_schedules_user_id"), table_name="committed_schedules")
        op.drop_constraint(
            "fk_committed_schedules_user_id_users",
            "committed_schedules",
            type_="foreignkey",
        )
        op.drop_column("committed_schedules", "user_id")
