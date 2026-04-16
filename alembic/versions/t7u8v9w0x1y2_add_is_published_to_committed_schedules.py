"""add is_published to committed schedules

Revision ID: t7u8v9w0x1y2
Revises: p1q2r3s4t6
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa


revision = "t7u8v9w0x1y2"
down_revision = "p1q2r3s4t6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        with op.batch_alter_table("committed_schedules", schema=None) as batch_op:
            batch_op.add_column(
                sa.Column(
                    "is_published",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.text("1"),
                )
            )
            batch_op.create_index(
                batch_op.f("ix_committed_schedules_is_published"),
                ["is_published"],
                unique=False,
            )
    else:
        op.add_column(
            "committed_schedules",
            sa.Column(
                "is_published",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            ),
        )
        op.create_index(
            op.f("ix_committed_schedules_is_published"),
            "committed_schedules",
            ["is_published"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        with op.batch_alter_table("committed_schedules", schema=None) as batch_op:
            batch_op.drop_index(batch_op.f("ix_committed_schedules_is_published"))
            batch_op.drop_column("is_published")
    else:
        op.drop_index(op.f("ix_committed_schedules_is_published"), table_name="committed_schedules")
        op.drop_column("committed_schedules", "is_published")
