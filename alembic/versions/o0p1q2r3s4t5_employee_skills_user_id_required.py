"""employee_skills user_id backfill and NOT NULL

Revision ID: o0p1q2r3s4t5
Revises: n9o0p1q2r3s4
Create Date: 2026-04-13

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker


revision = "o0p1q2r3s4t5"
down_revision = "n9o0p1q2r3s4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Session = sessionmaker(bind=bind)
    session = Session()

    from backend.models import User, EmployeeSkills, EmployeeType
    from backend.utils import hash_password
    from backend.user_employee_sync import slug_username

    try:
        for es in (
            session.query(EmployeeSkills)
            .filter(EmployeeSkills.user_id.is_(None))
            .all()
        ):
            u = (
                session.query(User)
                .filter(
                    User.employee_name == es.name,
                    User.employee_type == EmployeeType.STAFF,
                )
                .first()
            )
            if u:
                es.user_id = u.id
                continue
            base = slug_username(es.name)
            uname = base
            n = 0
            while session.query(User).filter(User.username == uname).first():
                n += 1
                uname = f"{base}_{n}"
            pwd = (
                f"{es.name[0].lower()}{es.name[1:]}123"
                if es.name and len(es.name) > 1
                else "changeme123"
            )
            u = User(
                username=uname,
                password=hash_password(pwd),
                employee_name=es.name,
                employee_type=EmployeeType.STAFF,
            )
            session.add(u)
            session.flush()
            es.user_id = u.id

        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

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
