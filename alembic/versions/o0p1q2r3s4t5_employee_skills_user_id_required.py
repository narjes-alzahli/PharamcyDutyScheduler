"""employee_skills user_id backfill and NOT NULL

Revision ID: o0p1q2r3s4t5
Revises: n9o0p1q2r3s4
Create Date: 2026-04-13

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision = "o0p1q2r3s4t5"
down_revision = "n9o0p1q2r3s4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    from backend.utils import hash_password
    from backend.user_employee_sync import slug_username

    # Use Core/SQL only — current ORM maps columns (e.g. skill_MS) added in later revisions.
    rows = bind.execute(
        text("SELECT id, name FROM employee_skills WHERE user_id IS NULL")
    ).fetchall()

    for es_id, es_name in rows:
        existing = bind.execute(
            text(
                "SELECT id FROM users WHERE employee_name = :en "
                "AND employee_type IN ('Staff', 'STAFF') LIMIT 1"
            ),
            {"en": es_name},
        ).fetchone()
        if existing:
            bind.execute(
                text("UPDATE employee_skills SET user_id = :uid WHERE id = :eid"),
                {"uid": existing[0], "eid": es_id},
            )
            continue

        base = slug_username(es_name)
        uname = base
        n = 0
        while bind.execute(
            text("SELECT 1 FROM users WHERE username = :u LIMIT 1"), {"u": uname}
        ).fetchone():
            n += 1
            uname = f"{base}_{n}"

        pwd = (
            f"{es_name[0].lower()}{es_name[1:]}123"
            if es_name and len(es_name) > 1
            else "changeme123"
        )
        hp = hash_password(pwd)

        if bind.dialect.name == "postgresql":
            uid = bind.execute(
                text(
                    "INSERT INTO users (username, password, employee_name, employee_type, created_at) "
                    "VALUES (:username, :password, :en, 'Staff', CURRENT_TIMESTAMP) RETURNING id"
                ),
                {"username": uname, "password": hp, "en": es_name},
            ).scalar()
        else:
            bind.execute(
                text(
                    "INSERT INTO users (username, password, employee_name, employee_type, created_at) "
                    "VALUES (:username, :password, :en, 'Staff', CURRENT_TIMESTAMP)"
                ),
                {"username": uname, "password": hp, "en": es_name},
            )
            uid = bind.execute(text("SELECT last_insert_rowid()")).scalar()

        bind.execute(
            text("UPDATE employee_skills SET user_id = :uid WHERE id = :eid"),
            {"uid": uid, "eid": es_id},
        )

    is_sqlite = bind.dialect.name == "sqlite"
    if is_sqlite:
        with op.batch_alter_table("employee_skills", schema=None) as batch_op:
            batch_op.alter_column(
                "user_id",
                existing_type=sa.Integer(),
                nullable=False,
            )
    else:
        op.alter_column(
            "employee_skills",
            "user_id",
            existing_type=sa.Integer(),
            nullable=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"
    if is_sqlite:
        with op.batch_alter_table("employee_skills", schema=None) as batch_op:
            batch_op.alter_column(
                "user_id",
                existing_type=sa.Integer(),
                nullable=True,
            )
    else:
        op.alter_column(
            "employee_skills",
            "user_id",
            existing_type=sa.Integer(),
            nullable=True,
        )
