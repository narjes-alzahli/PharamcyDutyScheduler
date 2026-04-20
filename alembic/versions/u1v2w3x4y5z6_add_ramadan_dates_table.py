"""add ramadan_dates table

Revision ID: u1v2w3x4y5z6
Revises: t7u8v9w0x1y2
Create Date: 2026-04-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision = "u1v2w3x4y5z6"
down_revision = "t7u8v9w0x1y2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ramadan_dates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("source", sa.String(), nullable=False, server_default=sa.text("'manual'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("year", name="uq_ramadan_dates_year"),
    )
    op.create_index(op.f("ix_ramadan_dates_id"), "ramadan_dates", ["id"], unique=False)
    op.create_index(op.f("ix_ramadan_dates_year"), "ramadan_dates", ["year"], unique=True)

    bind = op.get_bind()
    bind.execute(
        text(
            "INSERT INTO ramadan_dates (year, start_date, end_date, source) "
            "VALUES (:year, :start_date, :end_date, :source)"
        ),
        {"year": 2026, "start_date": "2026-02-19", "end_date": "2026-03-18", "source": "seed"},
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_ramadan_dates_year"), table_name="ramadan_dates")
    op.drop_index(op.f("ix_ramadan_dates_id"), table_name="ramadan_dates")
    op.drop_table("ramadan_dates")

