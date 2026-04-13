"""Keep User (staff) and EmployeeSkills rows paired and names in sync."""

from __future__ import annotations

import re
from typing import Optional

from sqlalchemy.orm import Session

from backend.models import User, EmployeeSkills, EmployeeType, CommittedSchedule, ScheduleMetrics


def slug_username(employee_name: str) -> str:
    s = re.sub(r"\s+", "_", (employee_name or "").strip().lower())
    return s or "user"


def ensure_staff_employee_skills(db: Session) -> None:
    """
    For every STAFF user, ensure exactly one EmployeeSkills row with user_id set and
    name matching user.employee_name. Does not commit.
    """
    staff_users = (
        db.query(User)
        .filter(User.employee_type == EmployeeType.STAFF)
        .order_by(User.id)
        .all()
    )
    for user in staff_users:
        skills = (
            db.query(EmployeeSkills)
            .filter(EmployeeSkills.user_id == user.id)
            .first()
        )
        if not skills:
            db.add(
                EmployeeSkills(
                    name=user.employee_name,
                    user_id=user.id,
                    skill_M=True,
                    skill_IP=True,
                    skill_A=True,
                    skill_N=True,
                    skill_M3=True,
                    skill_M4=True,
                    skill_H=False,
                    skill_CL=True,
                    skill_E=True,
                    skill_IP_P=True,
                    skill_P=True,
                    skill_M_P=True,
                    min_days_off=4,
                    weight=1.0,
                    pending_off=0.0,
                )
            )
        elif skills.name != user.employee_name:
            skills.name = user.employee_name


def committed_schedule_display_name(row: CommittedSchedule) -> str:
    """Current display name for a committed row: prefer linked User, else stored employee_name."""
    u = getattr(row, "user", None)
    if u is not None:
        return u.employee_name
    return row.employee_name


def roster_display_name(emp: EmployeeSkills) -> str:
    """Canonical roster/solver name: always the linked user's display name when present."""
    if getattr(emp, "user", None) is not None:
        return emp.user.employee_name
    return emp.name


def parse_payload_user_id(raw: object) -> Optional[int]:
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def apply_display_name_change_cascade(db: Session, old_name: str, new_name: str) -> None:
    """Update committed schedules and stored metrics when a staff display name changes."""
    if not old_name or old_name == new_name:
        return
    for schedule in db.query(CommittedSchedule).filter(
        CommittedSchedule.employee_name == old_name
    ).all():
        schedule.employee_name = new_name
    # Align denormalized name for all committed rows tied to this user (stable user_id)
    u = db.query(User).filter(User.employee_name == new_name).first()
    if u is not None:
        for s in db.query(CommittedSchedule).filter(CommittedSchedule.user_id == u.id).all():
            s.employee_name = new_name
    for metrics_record in db.query(ScheduleMetrics).all():
        if metrics_record.metrics and isinstance(metrics_record.metrics, dict):
            emps = metrics_record.metrics.get("employees")
            if isinstance(emps, list):
                for row in emps:
                    if isinstance(row, dict) and row.get("employee") == old_name:
                        row["employee"] = new_name
