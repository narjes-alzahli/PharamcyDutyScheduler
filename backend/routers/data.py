"""Data management endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from pathlib import Path
import pandas as pd
import json
from typing import List, Dict, Optional, Any, Tuple, Set
import sys

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.routers.auth import get_current_user
from backend.database import get_db
from backend.utils import hash_password, normalize_staff_no, sanitize_json_floats
from backend.roster_data_loader import (
    load_roster_data_from_db, 
    load_month_demands, 
    save_month_demands as save_month_demands_to_file, 
    generate_month_demands,
    save_month_holidays,
    load_month_holidays
)
from backend.models import User, LeaveRequest, LeaveType, RequestStatus, EmployeeType, ShiftRequest, ShiftType, EmployeeSkills, CommittedSchedule, ScheduleMetrics
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import not_

from backend.user_employee_sync import (
    ensure_staff_employee_skills,
    slug_username,
    parse_payload_user_id,
    apply_display_name_change_cascade,
)
from datetime import date

from roster.app.model.schema import canonicalize_schedule_code

router = APIRouter()


def _coalesce_int(value: Any, default: int) -> int:
    """JSON may send null for optional numbers; dict.get(key, default) still returns None if key exists."""
    if value is None:
        return default
    return int(value)


def _coalesce_float(value: Any, default: float) -> float:
    if value is None:
        return default
    return float(value)


def _date_ranges_overlap(a_start: date, a_end: date, b_start: date, b_end: date) -> bool:
    return not (a_end < b_start or b_end < a_start)


def _parse_roster_calendar_date(s: str, *, employee: str, field_label: str) -> date:
    try:
        return date.fromisoformat(s)
    except ValueError:
        parts = s.split("-")
        if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
            try:
                return date(int(parts[2]), int(parts[1]), int(parts[0]))
            except ValueError:
                pass
    raise HTTPException(
        status_code=400,
        detail=(
            f"Invalid date format ({field_label}) for employee {employee}: {s!r}. "
            "Use YYYY-MM-DD or DD-MM-YYYY."
        ),
    )


def _maybe_leave_request_id(rid: Optional[str]) -> Optional[int]:
    if not rid:
        return None
    s = str(rid)
    if s.startswith("LR_"):
        try:
            return int(s.split("_", 1)[1])
        except (ValueError, IndexError):
            return None
    return None


def _maybe_shift_request_id(rid: Optional[str]) -> Optional[int]:
    if not rid:
        return None
    s = str(rid)
    if s.startswith("SR_"):
        try:
            return int(s.split("_", 1)[1])
        except (ValueError, IndexError):
            return None
    return None


def _validate_time_off_leave_batch(db: Session, leave_entries: List[TimeOffEntry], leave_codes: Set[str]) -> None:
    """Reject overlapping approved leave windows for the same person with different leave codes."""
    rows: List[Tuple[str, int, date, date, str, Optional[int]]] = []
    for entry in leave_entries:
        user = db.query(User).filter(User.employee_name == entry.employee).first()
        if not user:
            continue
        try:
            code = canonicalize_schedule_code(entry.code, leave_codes)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        leave_type = db.query(LeaveType).filter(LeaveType.code == code).first()
        if not leave_type:
            continue
        d0 = _parse_roster_calendar_date(
            entry.from_date, employee=entry.employee, field_label="from_date"
        )
        d1 = _parse_roster_calendar_date(
            entry.to_date, employee=entry.employee, field_label="to_date"
        )
        rows.append((entry.employee, user.id, d0, d1, code, _maybe_leave_request_id(entry.request_id)))

    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            emp_a, uid_a, a0, a1, code_a, _ = rows[i]
            _, uid_b, b0, b1, code_b, _ = rows[j]
            if uid_a != uid_b:
                continue
            if not _date_ranges_overlap(a0, a1, b0, b1):
                continue
            if code_a != code_b:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Overlapping leave for {emp_a} with different codes ({code_a!r} vs {code_b!r}) "
                        f"between {a0}–{a1} and {b0}–{b1}."
                    ),
                )

    for emp, uid, d0, d1, code, self_lr_id in rows:
        others = (
            db.query(LeaveRequest)
            .options(joinedload(LeaveRequest.leave_type))
            .filter(
                LeaveRequest.user_id == uid,
                LeaveRequest.status == RequestStatus.APPROVED,
            )
            .all()
        )
        for o in others:
            if self_lr_id is not None and o.id == self_lr_id:
                continue
            if not _date_ranges_overlap(d0, d1, o.from_date, o.to_date):
                continue
            o_code = o.leave_type.code
            if o_code != code:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Leave for {emp} ({d0}–{d1}, {code!r}) overlaps an existing approved leave "
                        f"({o.from_date}–{o.to_date}, {o_code!r})."
                    ),
                )


def _validate_time_off_shift_batch(
    db: Session, shift_entries: List[TimeOffEntry], shift_codes: Set[str]
) -> None:
    """Reject overlapping shift-as-time-off windows for the same person with different shift codes."""
    rows: List[Tuple[str, int, date, date, str, Optional[int]]] = []
    for entry in shift_entries:
        user = db.query(User).filter(User.employee_name == entry.employee).first()
        if not user:
            continue
        try:
            code = canonicalize_schedule_code(entry.code, shift_codes)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        st = db.query(ShiftType).filter(ShiftType.code == code).first()
        if not st:
            continue
        d0 = _parse_roster_calendar_date(
            entry.from_date, employee=entry.employee, field_label="from_date"
        )
        d1 = _parse_roster_calendar_date(
            entry.to_date, employee=entry.employee, field_label="to_date"
        )
        rows.append((entry.employee, user.id, d0, d1, code, _maybe_shift_request_id(entry.request_id)))

    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            emp_a, uid_a, a0, a1, code_a, _ = rows[i]
            _, uid_b, b0, b1, code_b, _ = rows[j]
            if uid_a != uid_b:
                continue
            if not _date_ranges_overlap(a0, a1, b0, b1):
                continue
            if code_a != code_b:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Overlapping shift time-off for {emp_a} with different codes "
                        f"({code_a!r} vs {code_b!r}) between {a0}–{a1} and {b0}–{b1}."
                    ),
                )

    for emp, uid, d0, d1, code, self_sr_id in rows:
        others = (
            db.query(ShiftRequest)
            .options(joinedload(ShiftRequest.shift_type))
            .filter(
                ShiftRequest.user_id == uid,
                ShiftRequest.status == RequestStatus.APPROVED,
            )
            .all()
        )
        for o in others:
            if self_sr_id is not None and o.id == self_sr_id:
                continue
            if not _date_ranges_overlap(d0, d1, o.from_date, o.to_date):
                continue
            o_code = o.shift_type.code
            if o_code != code:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Shift time-off for {emp} ({d0}–{d1}, {code!r}) overlaps an existing "
                        f"shift request ({o.from_date}–{o.to_date}, {o_code!r})."
                    ),
                )


def _validate_lock_entries_batch(db: Session, entries: List[LockEntry], active_shift_codes: Set[str]) -> None:
    rows: List[Tuple[str, int, date, date, str, bool, Optional[int]]] = []
    for entry in entries:
        user = db.query(User).filter(User.employee_name == entry.employee).first()
        if not user:
            continue
        try:
            shift = canonicalize_schedule_code(entry.shift, active_shift_codes)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        d0 = _parse_roster_calendar_date(
            entry.from_date, employee=entry.employee, field_label="from_date"
        )
        d1 = _parse_roster_calendar_date(
            entry.to_date, employee=entry.employee, field_label="to_date"
        )
        rows.append(
            (
                entry.employee,
                user.id,
                d0,
                d1,
                shift,
                bool(entry.force),
                _maybe_shift_request_id(entry.request_id),
            )
        )

    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            emp_a, uid_a, a0, a1, sh_a, f_a, _ = rows[i]
            _, uid_b, b0, b1, sh_b, f_b, _ = rows[j]
            if uid_a != uid_b:
                continue
            if not _date_ranges_overlap(a0, a1, b0, b1):
                continue
            if sh_a != sh_b:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Overlapping shift locks for {emp_a}: {sh_a!r} vs {sh_b!r} "
                        f"({a0}–{a1} vs {b0}–{b1})."
                    ),
                )
            if f_a != f_b:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Overlapping shift locks for {emp_a} on shift {sh_a!r} with conflicting "
                        f"force={f_a!r} vs force={f_b!r} ({a0}–{a1} vs {b0}–{b1})."
                    ),
                )

    for emp, uid, d0, d1, shift, force, self_sid in rows:
        others = (
            db.query(ShiftRequest)
            .options(joinedload(ShiftRequest.shift_type))
            .filter(
                ShiftRequest.user_id == uid,
                ShiftRequest.status == RequestStatus.APPROVED,
            )
            .all()
        )
        for o in others:
            if self_sid is not None and o.id == self_sid:
                continue
            if not _date_ranges_overlap(d0, d1, o.from_date, o.to_date):
                continue
            o_code = o.shift_type.code
            if o_code != shift:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Lock for {emp} ({d0}–{d1}, {shift!r}) overlaps an existing shift request "
                        f"({o.from_date}–{o.to_date}, {o_code!r})."
                    ),
                )
            if o.force != force:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Lock for {emp} ({d0}–{d1}, {shift!r}) overlaps an existing request with "
                        f"conflicting force={o.force!r} vs {force!r}."
                    ),
                )


security = HTTPBearer()


def get_pending_off_from_most_recent_committed_month(
    db: Session,
) -> Tuple[Dict[str, Optional[float]], Dict[int, Optional[float]]]:
    """
    For user accounts / global employee list: pending_off from the chronologically latest
    (year, month) that has committed rows AND schedule_metrics with an employees report.
    Walks backward from newest month if the newest has no metrics yet.

    Returns (by_display_name, by_user_id) so overlays work after renames when metrics carry user_id.
    """
    pairs = db.query(CommittedSchedule.year, CommittedSchedule.month).distinct().all()
    if not pairs:
        return {}, {}
    ordered = sorted(pairs, key=lambda p: (p[0], p[1]), reverse=True)
    for y, m in ordered:
        rec = db.query(ScheduleMetrics).filter(ScheduleMetrics.year == y, ScheduleMetrics.month == m).first()
        if not rec or not rec.metrics:
            continue
        emps = rec.metrics.get("employees")
        if not isinstance(emps, list) or len(emps) == 0:
            continue
        out: Dict[str, Optional[float]] = {}
        out_uid: Dict[int, Optional[float]] = {}
        for emp in emps:
            if not isinstance(emp, dict):
                continue
            name = emp.get("employee")
            po = emp.get("pending_off")
            val: Optional[float]
            if po is None or po == "null":
                val = None
            else:
                try:
                    val = float(po)
                except (TypeError, ValueError):
                    val = None
            uid = emp.get("user_id")
            if uid is not None:
                try:
                    out_uid[int(uid)] = val
                except (TypeError, ValueError):
                    pass
            if name:
                out[str(name)] = val
        if out or out_uid:
            return out, out_uid
    return {}, {}


class EmployeeData(BaseModel):
    employee: str
    skills: str
    min_days_off: int


class DemandData(BaseModel):
    date: str
    need_M: int = 0
    need_IP: int = 0
    need_A: int = 0
    need_N: int = 0
    need_M3: int = 0
    need_M4: int = 0
    need_H: int = 0
    need_CL: int = 0
    need_E: int = 0
    need_MS: int = 0
    need_IP_P: int = 0
    need_P: int = 0
    need_M_P: int = 0


class TimeOffEntry(BaseModel):
    employee: str
    from_date: str
    to_date: str
    code: str
    request_id: Optional[str] = None  # If provided, update this specific request; if None, always create new


class LockEntry(BaseModel):
    employee: str
    from_date: str
    to_date: str
    shift: str
    force: bool
    request_id: Optional[str] = None  # If provided, update this specific request; if None, always create new


@router.get("/employees")
async def get_employees(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all staff (roster skills rows); pending_off is overlaid from the most recent committed month when available."""
    roster_data = load_roster_data_from_db(db)
    employees_df = roster_data['employees']
    records = employees_df.to_dict("records")
    latest_po, latest_po_uid = get_pending_off_from_most_recent_committed_month(db)
    for row in records:
        po_set = False
        uid = row.get("user_id")
        if uid is not None:
            try:
                i = int(uid)
                if i in latest_po_uid:
                    row["pending_off"] = latest_po_uid[i]
                    po_set = True
            except (TypeError, ValueError):
                pass
        if not po_set:
            name = row.get("employee")
            if name and name in latest_po:
                row["pending_off"] = latest_po[name]
    return sanitize_json_floats(records)


# POST /employees removed - employees are now created automatically when creating Staff users in User Management

@router.put("/employees")
async def update_employees(
    employees: List[dict],
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update all employees (save changes permanently).

    Rows may include ``user_id`` (from GET /employees or roster data) so renames and
    reordering stay tied to the same account; display names always sync to ``User.employee_name``.
    """
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update staff roster settings")

    ensure_staff_employee_skills(db)

    employee_names = [str(emp.get('employee', '')).strip() for emp in employees]
    duplicates = [name for name in employee_names if name and employee_names.count(name) > 1]
    if duplicates:
        raise HTTPException(
            status_code=400,
            detail=f"Duplicate staff names found: {', '.join(set(duplicates))}. Each person must have a unique name.",
        )
    if any(not name for name in employee_names):
        raise HTTPException(
            status_code=400,
            detail="Staff names cannot be empty.",
        )

    all_skills = (
        db.query(EmployeeSkills)
        .options(joinedload(EmployeeSkills.user))
        .order_by(EmployeeSkills.id)
        .all()
    )
    by_user_id = {e.user_id: e for e in all_skills}
    by_name = {e.name: e for e in all_skills}

    seen_payload_user_ids = set()
    processed_skill_ids = set()

    def _apply_skill_fields(emp: EmployeeSkills, emp_data: dict) -> None:
        emp.skill_M = bool(emp_data.get('skill_M', True))
        emp.skill_IP = bool(emp_data.get('skill_IP', True))
        emp.skill_A = bool(emp_data.get('skill_A', True))
        emp.skill_N = bool(emp_data.get('skill_N', True))
        emp.skill_M3 = bool(emp_data.get('skill_M3', True))
        emp.skill_M4 = bool(emp_data.get('skill_M4', True))
        emp.skill_H = bool(emp_data.get('skill_H', False))
        emp.skill_CL = bool(emp_data.get('skill_CL', True))
        emp.skill_E = bool(emp_data.get('skill_E', True))
        emp.skill_MS = bool(emp_data.get('skill_MS', True))
        emp.skill_IP_P = bool(emp_data.get('skill_IP_P', True))
        emp.skill_P = bool(emp_data.get('skill_P', True))
        emp.skill_M_P = bool(emp_data.get('skill_M_P', True))
        emp.min_days_off = _coalesce_int(emp_data.get('min_days_off', 4), 4)
        emp.weight = _coalesce_float(emp_data.get('weight', 1.0), 1.0)
        emp.pending_off = _coalesce_float(emp_data.get('pending_off', 0.0), 0.0)

    for emp_data in employees:
        name = str(emp_data.get('employee', '')).strip()
        if not name:
            continue

        uid = parse_payload_user_id(emp_data.get('user_id'))
        emp: Optional[EmployeeSkills] = None

        if uid is not None:
            if uid in seen_payload_user_ids:
                raise HTTPException(
                    status_code=400,
                    detail="Duplicate user_id in the same save request.",
                )
            seen_payload_user_ids.add(uid)
            emp = by_user_id.get(uid)
            if emp is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"No staff row found for user_id={uid}. Reload the page and try again.",
                )

        if emp is None:
            emp = by_name.get(name)

        if emp is not None:
            if uid is not None and emp.user_id != uid:
                raise HTTPException(
                    status_code=400,
                    detail="Staff name does not match the given user_id.",
                )
            processed_skill_ids.add(emp.id)
            user = emp.user
            if user is None:
                raise HTTPException(
                    status_code=500,
                    detail="Staff row is not linked to a user account; run database migrations.",
                )
            old_display = user.employee_name
            if old_display != name:
                apply_display_name_change_cascade(db, old_display, name)
                user.employee_name = name
            emp.name = name
            _apply_skill_fields(emp, emp_data)
            if 'staff_no' in emp_data:
                sn = normalize_staff_no(emp_data.get('staff_no'))
                if sn:
                    conflict = db.query(User).filter(User.staff_no == sn, User.id != user.id).first()
                    if conflict:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Staff number {sn} is already assigned to another user.",
                        )
                user.staff_no = sn
        else:
            username_base = slug_username(name)
            username = username_base
            suffix = 0
            while db.query(User).filter(User.username == username).first():
                suffix += 1
                username = f"{username_base}_{suffix}"
            emp_row = next(
                (e for e in employees if str(e.get('employee', '')).strip() == name),
                None,
            )
            sn_new = normalize_staff_no(emp_row.get('staff_no')) if emp_row else None
            if sn_new:
                taken = db.query(User).filter(User.staff_no == sn_new).first()
                if taken:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Staff number {sn_new} is already assigned to another user.",
                    )
            pwd = f"{name[0].lower()}{name[1:]}123" if len(name) > 1 else "changeme123"
            new_user = User(
                username=username,
                password=hash_password(pwd),
                employee_type=EmployeeType.STAFF,
                employee_name=name,
                staff_no=sn_new,
                start_date=date(2025, 10, 1),
            )
            db.add(new_user)
            db.flush()
            new_emp = EmployeeSkills(
                name=name,
                user_id=new_user.id,
                skill_M=bool(emp_data.get('skill_M', True)),
                skill_IP=bool(emp_data.get('skill_IP', True)),
                skill_A=bool(emp_data.get('skill_A', True)),
                skill_N=bool(emp_data.get('skill_N', True)),
                skill_M3=bool(emp_data.get('skill_M3', True)),
                skill_M4=bool(emp_data.get('skill_M4', True)),
                skill_H=bool(emp_data.get('skill_H', False)),
                skill_CL=bool(emp_data.get('skill_CL', True)),
                skill_E=bool(emp_data.get('skill_E', True)),
                skill_MS=bool(emp_data.get('skill_MS', True)),
                skill_IP_P=bool(emp_data.get('skill_IP_P', True)),
                skill_P=bool(emp_data.get('skill_P', True)),
                skill_M_P=bool(emp_data.get('skill_M_P', True)),
                min_days_off=_coalesce_int(emp_data.get('min_days_off', 4), 4),
                weight=_coalesce_float(emp_data.get('weight', 1.0), 1.0),
                pending_off=_coalesce_float(emp_data.get('pending_off', 0.0), 0.0),
            )
            db.add(new_emp)
            db.flush()
            processed_skill_ids.add(new_emp.id)
            by_user_id[new_user.id] = new_emp
            by_name[name] = new_emp

    for es in all_skills:
        if es.id in processed_skill_ids:
            continue
        uid = es.user_id
        db.delete(es)
        if uid is not None:
            u = db.query(User).filter(User.id == uid).first()
            if u is not None and u.employee_type == EmployeeType.STAFF:
                db.delete(u)

    db.commit()

    return {"message": "Staff roster settings updated successfully"}


@router.delete("/employees/{employee_name}")
async def delete_employee(
    employee_name: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete an employee."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can remove staff from the roster")
    
    employee = db.query(EmployeeSkills).filter(EmployeeSkills.name == employee_name).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Staff member not found")

    uid = employee.user_id
    db.delete(employee)
    if uid is not None:
        user = db.query(User).filter(User.id == uid).first()
        if user is not None and user.employee_type == EmployeeType.STAFF:
            db.delete(user)
    db.commit()

    return {"message": "Staff member removed successfully"}


@router.get("/demands")
async def get_demands(
    year: Optional[int] = None,
    month: Optional[int] = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get demands data for a specific month. Year and month are required."""
    if not year or not month:
        raise HTTPException(
            status_code=400, 
            detail="Year and month parameters are required"
        )
    
    demands_df = load_month_demands(year, month, db)
    return demands_df.to_dict('records')


# POST /demands removed - use POST /demands/month/{year}/{month} instead
# Demands must be created for specific months


@router.get("/roster-data")
async def get_roster_data(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all roster data (employees, demands, time_off, locks)."""
    try:
        # Don't expand ranges for frontend - keep as ranges
        roster_data = load_roster_data_from_db(db, expand_ranges=False)
        
        # Demands are loaded per-month from month-specific files
        # No general demands file needed
        demands_df = pd.DataFrame()
        
        # Convert date objects to ISO strings for JSON serialization
        # Replace NaN values with None to make JSON serializable
        import numpy as np
        time_off_records = roster_data['time_off'].replace({np.nan: None}).to_dict('records')
        for record in time_off_records:
            if isinstance(record.get('from_date'), date):
                record['from_date'] = record['from_date'].isoformat()
            if isinstance(record.get('to_date'), date):
                record['to_date'] = record['to_date'].isoformat()
        
        locks_records = roster_data['locks'].replace({np.nan: None}).to_dict('records')
        for record in locks_records:
            if isinstance(record.get('from_date'), date):
                record['from_date'] = record['from_date'].isoformat()
            if isinstance(record.get('to_date'), date):
                record['to_date'] = record['to_date'].isoformat()
        
        # Replace NaN in employees and demands DataFrames
        employees_records = roster_data['employees'].replace({np.nan: None}).to_dict('records')
        # Keep pending_off source consistent with GET /api/data/employees
        latest_po, latest_po_uid = get_pending_off_from_most_recent_committed_month(db)
        for row in employees_records:
            po_set = False
            uid = row.get("user_id")
            if uid is not None:
                try:
                    i = int(uid)
                    if i in latest_po_uid:
                        row["pending_off"] = latest_po_uid[i]
                        po_set = True
                except (TypeError, ValueError):
                    pass
            if not po_set:
                name = row.get("employee")
                if name and name in latest_po:
                    row["pending_off"] = latest_po[name]
        demands_records = demands_df.replace({np.nan: None}).to_dict('records') if not demands_df.empty else []
        
        return {
            "employees": employees_records,
            "demands": demands_records,
            "time_off": time_off_records,
            "locks": locks_records
        }
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"Error in get_roster_data: {error_details}")
        raise HTTPException(status_code=500, detail=f"Failed to load roster data: {str(e)}")


@router.put("/time-off")
async def update_time_off(
    entries: List[TimeOffEntry],
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save time off entries as leave requests OR shift requests in the database.
    
    Note: Non-standard shifts (like MS, C) appear in time_off but are actually shift requests
    with force=True. This endpoint handles both cases.
    """
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update time off data")

    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Received {len(entries)} time-off entries to save")
    
    # Use upsert pattern: update existing requests or create new ones
    # This is more efficient than deleting all and recreating
    
    # Separate entries into leave types and shift types
    # (STANDARD_WORKING_SHIFTS already defined above)
    
    shift_codes = {
        st.code
        for st in db.query(ShiftType).filter(ShiftType.is_active == True).all()
    }
    leave_codes_set = {
        lt.code
        for lt in db.query(LeaveType).filter(LeaveType.is_active == True).all()
    }
    combined_codes = shift_codes | leave_codes_set

    leave_entries = []
    shift_entries = []

    for entry in entries:
        try:
            canon = canonicalize_schedule_code(entry.code, combined_codes)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        shift_type = db.query(ShiftType).filter(ShiftType.code == canon).first()
        leave_type = db.query(LeaveType).filter(LeaveType.code == canon).first()

        if shift_type:
            shift_entries.append(entry)
        elif leave_type:
            leave_entries.append(entry)
        else:
            logger.warning(
                f"Code {entry.code!r} (canonical {canon!r}) not found as shift or leave type, skipping"
            )

    _validate_time_off_leave_batch(db, leave_entries, leave_codes_set)
    _validate_time_off_shift_batch(db, shift_entries, shift_codes)

    # Process leave entries - use upsert pattern (update if exists, create if not)
    created_leave_count = 0
    updated_leave_count = 0
    
    for entry in leave_entries:
        user = db.query(User).filter(User.employee_name == entry.employee).first()
        if not user:
            continue

        canon_code = canonicalize_schedule_code(entry.code, leave_codes_set)
        leave_type = db.query(LeaveType).filter(LeaveType.code == canon_code).first()
        if not leave_type:
            continue

        # Parse dates - handle both YYYY-MM-DD and DD-MM-YYYY formats
        try:
            from_date = date.fromisoformat(entry.from_date)
        except ValueError:
            # Try parsing DD-MM-YYYY format
            try:
                parts = entry.from_date.split('-')
                if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                    from_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid date format for time-off request (employee: {entry.employee}): '{entry.from_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                    )
            except (ValueError, IndexError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to parse from_date '{entry.from_date}' for employee {entry.employee}: {str(e)}"
                )
        
        try:
            to_date = date.fromisoformat(entry.to_date)
        except ValueError:
            # Try parsing DD-MM-YYYY format
            try:
                parts = entry.to_date.split('-')
                if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                    to_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid date format for time-off request (employee: {entry.employee}): '{entry.to_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                    )
            except (ValueError, IndexError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to parse to_date '{entry.to_date}' for employee {entry.employee}: {str(e)}"
                )
        
        # IMPORTANT: Only update if entry has a request_id (indicating it's an edit)
        # If no request_id, always create a new request (even if one exists with same dates)
        existing_request = None
        if entry.request_id:
            # Try to parse request_id to get the database ID
            request_id_str = str(entry.request_id)
            if request_id_str.startswith('LR_'):
                try:
                    request_db_id = int(request_id_str.split('_')[1])
                    existing_request = db.query(LeaveRequest).filter(
                        LeaveRequest.id == request_db_id,
                        LeaveRequest.user_id == user.id,
                        LeaveRequest.leave_type_id == leave_type.id,
                        LeaveRequest.reason == 'Added via Roster Generator'
                    ).first()
                except (ValueError, IndexError):
                    pass  # Invalid request_id format, treat as new
        
        if existing_request:
            # Update existing request (explicit edit via request_id)
            existing_request.from_date = from_date
            existing_request.to_date = to_date
            updated_leave_count += 1
            logger.info(f"Updated leave request: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.code}")
        else:
            # Always create new request if no request_id (new entry)
            new_request = LeaveRequest(
                user_id=user.id,
                leave_type_id=leave_type.id,
                from_date=from_date,
                to_date=to_date,
                reason='Added via Roster Generator',
                status=RequestStatus.APPROVED
            )
            db.add(new_request)
            created_leave_count += 1
            logger.info(f"Created leave request: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.code}")
    
    # Process shift entries (non-standard shifts with force=True)
    # Allow multiple requests - don't deduplicate, just create/update each one
    created_shift_count = 0
    updated_shift_count = 0
    
    for entry in shift_entries:
        user = db.query(User).filter(User.employee_name == entry.employee).first()
        if not user:
            continue

        canon_code = canonicalize_schedule_code(entry.code, shift_codes)
        shift_type = db.query(ShiftType).filter(ShiftType.code == canon_code).first()
        if not shift_type:
            continue

        # Parse dates - handle both YYYY-MM-DD and DD-MM-YYYY formats
        try:
            from_date = date.fromisoformat(entry.from_date)
        except ValueError:
            # Try parsing DD-MM-YYYY format
            try:
                parts = entry.from_date.split('-')
                if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                    from_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid date format for time-off request (employee: {entry.employee}): '{entry.from_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                    )
            except (ValueError, IndexError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to parse from_date '{entry.from_date}' for employee {entry.employee}: {str(e)}"
                )
        
        try:
            to_date = date.fromisoformat(entry.to_date)
        except ValueError:
            # Try parsing DD-MM-YYYY format
            try:
                parts = entry.to_date.split('-')
                if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                    to_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid date format for time-off request (employee: {entry.employee}): '{entry.to_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                    )
            except (ValueError, IndexError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to parse to_date '{entry.to_date}' for employee {entry.employee}: {str(e)}"
                )
        
        # IMPORTANT: Only update if entry has a request_id (indicating it's an edit)
        # If no request_id, always create a new request (even if one exists with same dates)
        existing_request = None
        if entry.request_id:
            # Try to parse request_id to get the database ID
            request_id_str = str(entry.request_id)
            if request_id_str.startswith('SR_'):
                try:
                    request_db_id = int(request_id_str.split('_')[1])
                    existing_request = db.query(ShiftRequest).filter(
                        ShiftRequest.id == request_db_id,
                        ShiftRequest.user_id == user.id,
                        ShiftRequest.shift_type_id == shift_type.id,
                        ShiftRequest.reason == 'Added via Roster Generator'
                    ).first()
                except (ValueError, IndexError):
                    pass  # Invalid request_id format, treat as new
        
        if existing_request:
            # Update existing request (explicit edit via request_id)
            existing_request.from_date = from_date
            existing_request.to_date = to_date
            updated_shift_count += 1
            logger.info(f"Updated shift request: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.code} (force=True)")
        else:
            # Check if identical request already exists to prevent duplicates
            existing_identical = db.query(ShiftRequest).filter(
                ShiftRequest.user_id == user.id,
                ShiftRequest.shift_type_id == shift_type.id,
                ShiftRequest.from_date == from_date,
                ShiftRequest.to_date == to_date,
                ShiftRequest.force == True,
                ShiftRequest.reason == 'Added via Roster Generator',
                ShiftRequest.status == RequestStatus.APPROVED
            ).first()
            
            if existing_identical:
                # Identical request already exists - skip creating duplicate
                logger.info(f"Skipping duplicate shift request: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.code} (already exists as ID {existing_identical.id})")
            else:
                # Create new request only if no identical one exists
                new_request = ShiftRequest(
                    user_id=user.id,
                    shift_type_id=shift_type.id,
                    from_date=from_date,
                    to_date=to_date,
                    force=True,  # force=True means "must have this shift"
                    reason='Added via Roster Generator',
                    status=RequestStatus.APPROVED
                )
                db.add(new_request)
                created_shift_count += 1
                logger.info(f"Created shift request: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.code} (force=True)")
    
    db.commit()
    total_created = created_leave_count + created_shift_count
    total_updated = updated_leave_count + updated_shift_count
    logger.info(f"Committed {created_leave_count} leave requests created, {updated_leave_count} updated; {created_shift_count} shift requests created, {updated_shift_count} updated (total: {total_created} created, {total_updated} updated)")
    
    # Reload created requests to get their IDs and return them
    created_leave_requests = []
    created_shift_requests = []
    
    if created_leave_count > 0:
        # Get the most recently created leave requests (last N created)
        recent_leaves = db.query(LeaveRequest).filter(
            LeaveRequest.reason == 'Added via Roster Generator',
            LeaveRequest.status == RequestStatus.APPROVED
        ).order_by(LeaveRequest.id.desc()).limit(created_leave_count).all()
        
        for leave in recent_leaves:
            # Check if this leave matches any of the entries we just created
            for entry in leave_entries:
                if (leave.user.employee_name == entry.employee and
                    leave.leave_type.code == entry.code and
                    leave.from_date.isoformat() == entry.from_date and
                    leave.to_date.isoformat() == entry.to_date):
                    created_leave_requests.append({
                        'request_id': f"LR_{leave.id}",
                        'employee': leave.user.employee_name,
                        'from_date': leave.from_date.isoformat(),
                        'to_date': leave.to_date.isoformat(),
                        'code': leave.leave_type.code,
                        'reason': leave.reason or '',
                    })
                    break
    
    if created_shift_count > 0:
        # Get the most recently created shift requests (last N created)
        recent_shifts = db.query(ShiftRequest).filter(
            ShiftRequest.reason == 'Added via Roster Generator',
            ShiftRequest.status == RequestStatus.APPROVED
        ).order_by(ShiftRequest.id.desc()).limit(created_shift_count).all()
        
        for shift in recent_shifts:
            # Check if this shift matches any of the entries we just created
            for entry in shift_entries:
                if (shift.user.employee_name == entry.employee and
                    shift.shift_type.code == entry.code and
                    shift.from_date.isoformat() == entry.from_date and
                    shift.to_date.isoformat() == entry.to_date):
                    created_shift_requests.append({
                        'request_id': f"SR_{shift.id}",
                        'employee': shift.user.employee_name,
                        'from_date': shift.from_date.isoformat(),
                        'to_date': shift.to_date.isoformat(),
                        'shift': shift.shift_type.code,
                        'force': shift.force,
                        'reason': shift.reason or '',
                    })
                    break
    
    return {
        "message": f"Time off saved ({created_leave_count} leave, {created_shift_count} shift requests)",
        "created": total_created,
        "created_leave_requests": created_leave_requests,
        "created_shift_requests": created_shift_requests
    }


@router.put("/locks")
async def update_locks(
    entries: List[LockEntry],
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save shift lock entries as shift requests in the database."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update shift requests")

    import logging
    logger = logging.getLogger(__name__)
    
    logger.info(f"Received {len(entries)} shift lock entries to save")

    active_shift_codes = {
        st.code
        for st in db.query(ShiftType).filter(ShiftType.is_active == True).all()
    }
    _validate_lock_entries_batch(db, entries, active_shift_codes)

    # Use upsert pattern: update existing requests or create new ones
    # This is more efficient than deleting all and recreating
    # Allow multiple shift requests - don't prevent duplicates
    created_count = 0
    updated_count = 0

    for entry in entries:
        # Find user by employee_name
        user = db.query(User).filter(User.employee_name == entry.employee).first()
        if not user:
            # Skip if employee doesn't have a user account
            continue
        
        # Parse dates
        # Parse dates - handle both YYYY-MM-DD and DD-MM-YYYY formats
        try:
            from_date = date.fromisoformat(entry.from_date)
        except ValueError:
            # Try parsing DD-MM-YYYY format
            try:
                parts = entry.from_date.split('-')
                if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                    from_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid date format for shift request (employee: {entry.employee}): '{entry.from_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                    )
            except (ValueError, IndexError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to parse from_date '{entry.from_date}' for employee {entry.employee}: {str(e)}"
                )
        
        try:
            to_date = date.fromisoformat(entry.to_date)
        except ValueError:
            # Try parsing DD-MM-YYYY format
            try:
                parts = entry.to_date.split('-')
                if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                    to_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid date format for shift request (employee: {entry.employee}): '{entry.to_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                    )
            except (ValueError, IndexError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to parse to_date '{entry.to_date}' for employee {entry.employee}: {str(e)}"
                )
        
        try:
            canon_shift = canonicalize_schedule_code(entry.shift, active_shift_codes)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        shift_type = db.query(ShiftType).filter(ShiftType.code == canon_shift).first()
        if not shift_type:
            raise HTTPException(
                status_code=400,
                detail=f"Shift type {entry.shift!r} not found for employee {entry.employee}",
            )

        # If request_id is provided, update that specific request
        if entry.request_id:
            # Parse request_id (format: "SR_123")
            try:
                if entry.request_id.startswith('SR_'):
                    db_id = int(entry.request_id.split('_')[1])
                else:
                    raise ValueError(f"Invalid request_id format: {entry.request_id}")
            except (IndexError, ValueError) as e:
                logger.warning(f"Invalid request_id '{entry.request_id}', creating new request instead: {e}")
                entry.request_id = None  # Fall through to create new request
        
        if entry.request_id:
            # Update specific existing request
            existing_request = db.query(ShiftRequest).filter(
                ShiftRequest.id == db_id,
                ShiftRequest.user_id == user.id  # Verify ownership
            ).first()
            
            if existing_request:
                existing_request.from_date = from_date
                existing_request.to_date = to_date
                existing_request.force = entry.force
                existing_request.shift_type_id = shift_type.id  # Allow shift type changes
                updated_count += 1
                logger.info(f"Updated shift request {entry.request_id}: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.shift}, force={entry.force}")
            else:
                # Request ID provided but not found - create new instead
                logger.warning(f"Request ID {entry.request_id} not found for employee {entry.employee}, creating new request")
                new_request = ShiftRequest(
                    user_id=user.id,
                    shift_type_id=shift_type.id,
                    from_date=from_date,
                    to_date=to_date,
                    force=entry.force,
                    reason='Added via Roster Generator',
                    status=RequestStatus.APPROVED
                )
                db.add(new_request)
                created_count += 1
                logger.info(f"Created shift request: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.shift}, force={entry.force}")
        else:
            # No request_id provided - check if identical request already exists to prevent duplicates
            # An identical request has same user, shift, dates, force, reason, and status
            existing_identical = db.query(ShiftRequest).filter(
                ShiftRequest.user_id == user.id,
                ShiftRequest.shift_type_id == shift_type.id,
                ShiftRequest.from_date == from_date,
                ShiftRequest.to_date == to_date,
                ShiftRequest.force == entry.force,
                ShiftRequest.reason == 'Added via Roster Generator',
                ShiftRequest.status == RequestStatus.APPROVED
            ).first()
            
            if existing_identical:
                # Identical request already exists - skip creating duplicate
                logger.info(f"Skipping duplicate shift request: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.shift}, force={entry.force} (already exists as ID {existing_identical.id})")
            else:
                # Create new request only if no identical one exists
                new_request = ShiftRequest(
                    user_id=user.id,
                    shift_type_id=shift_type.id,
                    from_date=from_date,
                    to_date=to_date,
                    force=entry.force,
                    reason='Added via Roster Generator',
                    status=RequestStatus.APPROVED  # Auto-approve when manager adds via Roster Generator
                )
                db.add(new_request)
                created_count += 1
                logger.info(f"Created shift request: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.shift}, force={entry.force}")
    
    db.commit()
    logger.info(f"Committed {created_count} new shift requests, {updated_count} updated")
    
    # Reload created requests to get their IDs and return them
    created_requests = []
    
    if created_count > 0:
        # Get the most recently created shift requests (last N created)
        recent_shifts = db.query(ShiftRequest).filter(
            ShiftRequest.reason == 'Added via Roster Generator',
            ShiftRequest.status == RequestStatus.APPROVED
        ).order_by(ShiftRequest.id.desc()).limit(created_count).all()
        
        for shift in recent_shifts:
            # Check if this shift matches any of the entries we just created
            for entry in entries:
                if (shift.user.employee_name == entry.employee and
                    shift.shift_type.code == entry.shift and
                    shift.from_date.isoformat() == entry.from_date and
                    shift.to_date.isoformat() == entry.to_date and
                    shift.force == entry.force):
                    created_requests.append({
                        'request_id': f"SR_{shift.id}",
                        'employee': shift.user.employee_name,
                        'from_date': shift.from_date.isoformat(),
                        'to_date': shift.to_date.isoformat(),
                        'shift': shift.shift_type.code,
                        'force': shift.force,
                        'reason': shift.reason or '',
                    })
                    break
    
    return {
        "message": f"Shift locks saved as shift requests ({created_count} created)",
        "created": created_count,
        "created_requests": created_requests
    }


class FixedShiftConfig(BaseModel):
    shift: str
    day: int  # 0 = Monday, 1 = Tuesday, 2 = Wednesday, 3 = Thursday, 4 = Friday, 5 = Saturday, 6 = Sunday
    count: int

class GenerateDemandsRequest(BaseModel):
    year: int
    month: int
    base_demand: dict
    weekend_demand: dict
    fixed_shifts: List[FixedShiftConfig] = []  # Optional list of fixed shifts


@router.post("/demands/generate")
async def generate_demands(
    request: GenerateDemandsRequest,
    current_user: dict = Depends(get_current_user)
):
    """Generate demands for a month."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can generate demands")
    
    # Load existing holidays separately (not from demands)
    # Note: generate_demands doesn't have db session, so it will create its own
    existing_holidays = load_month_holidays(request.year, request.month)
    # Convert date strings to date objects for matching
    existing_holidays_dates = {}
    for date_str, holiday_name in existing_holidays.items():
        try:
            date_val = pd.to_datetime(date_str, errors='coerce').date()
            if date_val:
                existing_holidays_dates[date_val] = holiday_name
        except:
            continue
    
    # Convert fixed_shifts to list of dicts if provided
    fixed_shifts_list = []
    if request.fixed_shifts:
        fixed_shifts_list = [{"shift": fs.shift, "day": fs.day, "count": fs.count} for fs in request.fixed_shifts]
    
    new_demands = generate_month_demands(
        request.year,
        request.month,
        request.base_demand,
        request.weekend_demand,
        holidays=existing_holidays_dates,  # Pass holidays to set holiday-specific demands
        fixed_shifts=fixed_shifts_list  # Pass fixed shifts configuration
    )
    
    # Save holidays separately (not in demands)
    if existing_holidays_dates:
        # Convert date objects to strings for saving
        holidays_dict = {d.isoformat(): name for d, name in existing_holidays_dates.items()}
        save_month_holidays(request.year, request.month, holidays_dict)
    
    # Save demands without holiday column
    save_month_demands_to_file(request.year, request.month, new_demands)
    
    # Add holiday column to response for UI (but not saved in demands CSV)
    if existing_holidays_dates:
        new_demands['holiday'] = new_demands['date'].apply(
            lambda d: existing_holidays_dates.get(d, '')
        )
    else:
        new_demands['holiday'] = ''
    
    # Convert dates to strings for response
    new_demands = new_demands.copy()
    if 'date' in new_demands.columns:
        new_demands['date'] = pd.to_datetime(new_demands['date'], errors='coerce').dt.strftime('%Y-%m-%d')
    
    return {
        "message": "Demands generated successfully",
        "demands": new_demands.to_dict('records')
    }


@router.get("/demands/month/{year}/{month}")
async def get_month_demands(
    year: int,
    month: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get demands for a specific month (with holidays merged for UI display)."""
    month_demands = load_month_demands(year, month, db)
    
    if month_demands.empty:
        return []
    
    # Load holidays separately
    # Note: get_month_demands doesn't have db session, so it will create its own
    holidays = load_month_holidays(year, month)
    
    # Convert dates to strings
    month_demands = month_demands.copy()
    if 'date' in month_demands.columns:
        month_demands['date'] = pd.to_datetime(month_demands['date'], errors='coerce').dt.strftime('%Y-%m-%d')
        # Merge holidays into demands for UI display
        month_demands['holiday'] = month_demands['date'].map(lambda d: holidays.get(str(d), ''))
    else:
        # If no date column, add empty holiday column
        month_demands['holiday'] = ''
    
    return month_demands.to_dict('records')


@router.post("/demands/month/{year}/{month}")
async def save_month_demands(
    year: int,
    month: int,
    demands: List[dict],
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save demands for a specific month (without holidays - holidays are saved separately)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can save demands")
    
    demands_df = pd.DataFrame(demands)
    
    # Extract holidays if present (for backward compatibility during transition)
    holidays = {}
    if 'holiday' in demands_df.columns:
        for _, row in demands_df.iterrows():
            date_str = str(row.get('date', ''))
            holiday_name = str(row.get('holiday', '')).strip()
            if date_str and holiday_name:
                holidays[date_str] = holiday_name
        # Remove holiday column from demands
        demands_df = demands_df.drop(columns=['holiday'])
    
    # Ensure date column is properly formatted
    if 'date' in demands_df.columns:
        # Convert date strings to datetime, then back to date for consistent storage
        demands_df['date'] = pd.to_datetime(demands_df['date'], errors='coerce')
        # Filter out any invalid dates
        demands_df = demands_df[demands_df['date'].notna()]
        # Convert to date type (not datetime)
        demands_df['date'] = demands_df['date'].dt.date
    
    # Ensure all required columns exist
    required_columns = ['date', 'need_M', 'need_IP', 'need_A', 'need_N', 'need_M3', 'need_M4', 'need_H', 'need_CL', 'need_E', 'need_MS', 'need_IP_P', 'need_P', 'need_M_P']
    for col in required_columns:
        if col not in demands_df.columns:
            if col == 'date':
                raise HTTPException(status_code=400, detail="Missing required 'date' column")
            else:
                demands_df[col] = 0
    
    # Save demands to database (without holiday column)
    save_month_demands_to_file(year, month, demands_df, db)
    
    # Save holidays separately if any were provided
    if holidays:
        save_month_holidays(year, month, holidays, db=db)
    
    return {"message": "Demands saved successfully"}


@router.get("/holidays/month/{year}/{month}")
async def get_month_holidays(
    year: int,
    month: int,
    current_user: dict = Depends(get_current_user)
):
    """Get holidays for a specific month."""
    # Note: get_month_holidays doesn't have db session, so it will create its own
    holidays = load_month_holidays(year, month)
    return holidays


@router.post("/holidays/month/{year}/{month}")
async def save_month_holidays_endpoint(
    year: int,
    month: int,
    holidays: Dict[str, str],
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save holidays for a specific month."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can save holidays")
    
    save_month_holidays(year, month, holidays, db=db)
    return {"message": "Holidays saved successfully"}

