"""Schedule viewing and management endpoints."""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer
from pathlib import Path
import pandas as pd
import json
from typing import List, Optional, Dict, Tuple
from sqlalchemy.orm import Session, joinedload
from datetime import date as date_type, timedelta
from calendar import monthrange
import sys
import tempfile
import yaml

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.routers.auth import get_current_user
from backend.database import get_db
from backend.utils import sanitize_json_floats
from backend.models import User, CommittedSchedule, ScheduleMetrics, EmployeeSkills
from backend.user_employee_sync import committed_schedule_display_name
from backend.roster_data_loader import load_holidays_by_date_range
from backend.ramadan_periods import (
    get_ramadan_period_window,
    detect_periods_for_dates,
    get_ramadan_period_windows,
)
from roster.app.model.solver import RosterSolver
from roster.app.model.schema import RosterConfig

router = APIRouter()
security = HTTPBearer()

def _is_single_skill_employee(emp_skills: EmployeeSkills) -> bool:
    """True when exactly one skill flag is enabled."""
    skill_fields = [
        "skill_M", "skill_IP", "skill_A", "skill_N", "skill_M3", "skill_M4",
        "skill_H", "skill_CL", "skill_E", "skill_MS", "skill_IP_P", "skill_P", "skill_M_P"
    ]
    return sum(1 for field in skill_fields if bool(getattr(emp_skills, field, False))) == 1


def _resolve_schedule_user_id(db: Session, display_name: str) -> int:
    """Map roster display name to users.id via EmployeeSkills (required for committed rows)."""
    name = (display_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Schedule entry is missing a staff name")
    es = db.query(EmployeeSkills).filter(EmployeeSkills.name == name).first()
    if es is None:
        es = (
            db.query(EmployeeSkills)
            .join(User, EmployeeSkills.user_id == User.id)
            .filter(User.employee_name == name)
            .first()
        )
    if es is None or es.user_id is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Schedule references unknown staff {name!r}. "
                "They must exist as a Staff user with roster skills before committing."
            ),
        )
    return es.user_id


def _enrich_employee_rows_with_user_id(db: Session, rows: Optional[List[dict]]) -> None:
    """Attach stable ``user_id`` to each employee report row; display ``employee`` stays the label."""
    if not rows:
        return
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = (row.get("employee") or "").strip()
        if not name:
            continue
        try:
            row["user_id"] = _resolve_schedule_user_id(db, name)
        except HTTPException:
            continue


def _remap_employee_metrics_to_user_id_keys(db: Session, metrics: Dict) -> None:
    """Rewrite metrics['employee_metrics'] from name-keys to str(user_id) keys (JSON-safe). Keeps legacy unknown keys."""
    if not isinstance(metrics, dict):
        return
    em = metrics.get("employee_metrics")
    if not isinstance(em, dict) or not em:
        return
    new_em: Dict[str, object] = {}
    for key, val in em.items():
        sk = str(key)
        if sk.isdigit():
            new_em[sk] = val
            continue
        try:
            uid = _resolve_schedule_user_id(db, sk)
            new_em[str(uid)] = val
        except HTTPException:
            new_em[sk] = val
    metrics["employee_metrics"] = new_em


def _po_maps_from_employee_metrics_rows(
    prev_employees: List[dict],
) -> Tuple[Dict[str, float], Dict[int, float]]:
    po_by_uid: Dict[int, float] = {}
    po_by_name: Dict[str, float] = {}
    for emp_data in prev_employees:
        if not isinstance(emp_data, dict):
            continue
        pending_off = emp_data.get("pending_off")
        if pending_off is None:
            continue
        try:
            pof = float(pending_off)
        except (TypeError, ValueError):
            continue
        uid = emp_data.get("user_id")
        if uid is not None:
            try:
                po_by_uid[int(uid)] = pof
            except (TypeError, ValueError):
                pass
        employee_name = emp_data.get("employee")
        if employee_name:
            po_by_name[str(employee_name).strip()] = pof
    return po_by_name, po_by_uid


def _merge_initial_pending_off_maps(
    po_by_name: Dict[str, float],
    po_by_uid: Dict[int, float],
    db: Session,
) -> Dict[str, float]:
    initial_pending_off: Dict[str, float] = {}
    all_employees = db.query(EmployeeSkills).all()
    for emp in all_employees:
        uid = emp.user_id
        nkey = str(emp.name).strip()
        if uid is not None and uid in po_by_uid:
            initial_pending_off[emp.name] = po_by_uid[uid]
        elif nkey in po_by_name:
            initial_pending_off[emp.name] = po_by_name[nkey]

    for emp in all_employees:
        if emp.name not in initial_pending_off:
            initial_pending_off[emp.name] = float(emp.pending_off or 0.0)

    return initial_pending_off


def _initial_pending_off_from_metrics_dict(metrics: dict, db: Session) -> Optional[Dict[str, float]]:
    if not metrics or not isinstance(metrics, dict):
        return None
    prev_employees = metrics.get("employees")
    if not isinstance(prev_employees, list) or not prev_employees:
        return None
    po_by_name, po_by_uid = _po_maps_from_employee_metrics_rows(prev_employees)
    if not po_by_name and not po_by_uid:
        return None
    return _merge_initial_pending_off_maps(po_by_name, po_by_uid, db)


def _find_schedule_metrics_for_ramadan_period(
    period_id: str,
    year_hint: int,
    db: Session,
) -> Optional[dict]:
    """Latest (year, month) metrics row tagged with ``pending_off_period`` for this slice."""
    best: Optional[Tuple[int, int, dict]] = None
    y_lo = min(year_hint, year_hint - 1)
    y_hi = max(year_hint, year_hint + 1)
    for rec in db.query(ScheduleMetrics).filter(
        ScheduleMetrics.year >= y_lo,
        ScheduleMetrics.year <= y_hi,
    ).all():
        m = rec.metrics if isinstance(rec.metrics, dict) else None
        if not m or m.get("pending_off_period") != period_id:
            continue
        key = (int(rec.year), int(rec.month))
        if best is None or key[0] * 12 + key[1] > best[0] * 12 + best[1]:
            best = (key[0], key[1], m)
    return best[2] if best else None


def _metrics_row_for_calendar_month(year: int, month: int, db: Session) -> Optional[dict]:
    rec = db.query(ScheduleMetrics).filter(
        ScheduleMetrics.year == int(year),
        ScheduleMetrics.month == int(month),
    ).first()
    if not rec or not rec.metrics or not isinstance(rec.metrics, dict):
        return None
    return rec.metrics


def _metrics_employees_have_pending_off_values(emps: object) -> bool:
    if not isinstance(emps, list):
        return False
    for emp in emps:
        if not isinstance(emp, dict):
            continue
        po = emp.get("pending_off")
        if po is None or po == "null":
            continue
        return True
    return False


def _latest_schedule_metrics_before_calendar_month(
    cutoff_year: int,
    cutoff_month: int,
    db: Session,
) -> Optional[dict]:
    """Newest (year, month) strictly before ``(cutoff_year, cutoff_month)`` with usable PO in metrics."""
    try:
        cutoff = int(cutoff_year) * 12 + int(cutoff_month)
    except (TypeError, ValueError):
        return None
    best_key = -1
    best_metrics: Optional[dict] = None
    for rec in db.query(ScheduleMetrics).all():
        try:
            key = int(rec.year) * 12 + int(rec.month)
        except (TypeError, ValueError):
            continue
        if key >= cutoff:
            continue
        m = rec.metrics if isinstance(rec.metrics, dict) else None
        if not m:
            continue
        if not _metrics_employees_have_pending_off_values(m.get("employees")):
            continue
        if key > best_key:
            best_key = key
            best_metrics = m
    return best_metrics


def _initial_pending_off_from_latest_saved_before_month(
    cutoff_year: int,
    cutoff_month: int,
    db: Session,
) -> Dict[str, float]:
    """Prefer latest saved month with PO data before cutoff; else EmployeeSkills (user roster)."""
    m = _latest_schedule_metrics_before_calendar_month(cutoff_year, cutoff_month, db)
    if m:
        got = _initial_pending_off_from_metrics_dict(m, db)
        if got is not None:
            return got
    return _merge_initial_pending_off_maps({}, {}, db)


def get_initial_pending_off_for_month(year: int, month: int, db: Session) -> Dict[str, float]:
    """Initial pending_off for calendar ``(year, month)``.

    Uses the **latest** saved ``schedule_metrics`` row strictly before this month that has
    ``employees`` with at least one ``pending_off`` set (so gaps like Apr 2027 vs May 2026 work).
    If none exist, uses ``EmployeeSkills.pending_off`` (same source as user accounts).
    """
    return _initial_pending_off_from_latest_saved_before_month(year, month, db)


def _initial_pending_off_ramadan_period_walk(
    period_chain: List[str],
    year_hint: int,
    solve_start: date_type,
    anchor: date_type,
    db: Session,
    *,
    try_anchor_month_metrics: bool = True,
    before_pre_calendar_month: Optional[Tuple[int, int]] = None,
) -> Dict[str, float]:
    """Try tagged Ramadan slices in order, optional anchor-month row, optional “before pre” month scan, then April-style walk-back."""
    for pid in period_chain:
        m = _find_schedule_metrics_for_ramadan_period(pid, year_hint, db)
        if m:
            got = _initial_pending_off_from_metrics_dict(m, db)
            if got is not None:
                return got
    if try_anchor_month_metrics:
        cal = _metrics_row_for_calendar_month(anchor.year, anchor.month, db)
        if cal:
            got = _initial_pending_off_from_metrics_dict(cal, db)
            if got is not None:
                return got
    if before_pre_calendar_month is not None:
        py, pm = before_pre_calendar_month
        # "Month before pre" means: walk back from pre's month cutoff until PO is found,
        # then fall back to EmployeeSkills when nothing exists.
        return _initial_pending_off_from_latest_saved_before_month(py, pm, db)
    return _initial_pending_off_from_latest_saved_before_month(
        solve_start.year,
        solve_start.month,
        db,
    )


def get_initial_pending_off_from_previous_segment(
    solve_start: date_type,
    solve_end: date_type,
    db: Session,
) -> Dict[str, float]:
    """Initial pending_off for solver generation from EmployeeSkills only.

    This intentionally ignores historical metrics walk-back and always seeds from
    the current EmployeeSkills.pending_off values (same source as User Accounts /
    Staff Skills).
    """
    _ = solve_start
    _ = solve_end
    return _merge_initial_pending_off_maps({}, {}, db)


def get_pending_off_window_inclusive(
    year: int, month: int, selected_period: Optional[str], db: Optional[Session] = None
) -> Optional[Tuple[date_type, date_type]]:
    """Match frontend ``getPendingOffWindow`` for dynamic Ramadan windows."""
    return get_ramadan_period_window(year, month, selected_period, db=db)


def _should_sync_employee_skills_pending_off(
    year: int,
    month: int,
    selected_period: Optional[str],
    db: Session,
) -> bool:
    """Only sync EmployeeSkills PO for periods ending on or before today."""
    today = date_type.today()
    window = get_pending_off_window_inclusive(year, month, selected_period, db=db)
    if window:
        _, end_d = window
        return end_d <= today
    try:
        last_day = monthrange(int(year), int(month))[1]
        return date_type(int(year), int(month), int(last_day)) <= today
    except Exception:
        # Safe fallback: do not sync when date parsing fails.
        return False


def recalculate_employee_report(
    schedule: List[dict],
    year: int,
    month: int,
    db: Session,
    selected_period: Optional[str] = None,
) -> pd.DataFrame:
    """Recalculate employee report from schedule data."""
    from datetime import date, timedelta

    if selected_period:
        wsel = get_ramadan_period_window(year, month, selected_period, db=db)
        if wsel:
            solve_start, solve_end = wsel
        else:
            solve_start = date(year, month, 1)
            solve_end = date(year, month, monthrange(year, month)[1])
    else:
        solve_start = date(year, month, 1)
        solve_end = date(year, month, monthrange(year, month)[1])

    initial_pending_off = get_initial_pending_off_from_previous_segment(
        solve_start, solve_end, db
    )

    window = get_pending_off_window_inclusive(year, month, selected_period, db=db)
    if window:
        start_d, end_d = window
        dates: List[date] = []
        cur = start_d
        while cur <= end_d:
            dates.append(cur)
            cur += timedelta(days=1)
    else:
        days_in_month = monthrange(year, month)[1]
        dates = [date(year, month, day) for day in range(1, days_in_month + 1)]
    
    # Convert schedule to assignments format: {(employee, date, shift): 1}
    assignments = {}
    for entry in schedule:
        date_val = pd.to_datetime(entry['date'], errors='coerce').date()
        if pd.isna(date_val):
            continue
        employee = entry['employee']
        shift = entry['shift']
        assignments[(employee, date_val, shift)] = 1
    
    # Get employee names from schedule
    employees = list(set([entry['employee'] for entry in schedule if 'employee' in entry]))
    
    holidays: Dict[str, str] = {}
    if dates:
        holidays = load_holidays_by_date_range(dates[0], dates[-1], db)
    
    # Create a minimal RosterData-like object for holidays
    class SimpleRosterData:
        def get_holiday(self, day: date):
            date_str = day.isoformat()
            return holidays.get(date_str)
    
    roster_data = SimpleRosterData()
    
    # Create a temporary config (we only need it for create_employee_report)
    temp_path = Path(tempfile.mkdtemp())
    try:
        leave_codes = ["DO", "ML", "AL", "W", "UL", "APP", "STL", "L", "PH", "O"]
        working_shift_codes = ["M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "IP+P", "P", "M+P"]
        all_shift_codes = sorted(set(leave_codes) | set(working_shift_codes))
        config_data = {
            "weights": {},
            "rest_codes": ["O"],
            "leave_codes": leave_codes,
            "working_shift_codes": working_shift_codes,
            "all_shift_codes": all_shift_codes,
        }
        config_path = temp_path / "config.yaml"
        with open(config_path, 'w') as f:
            yaml.dump(config_data, f)
        config = RosterConfig(config_path)
        
        # Create solver instance (we only need it for create_employee_report method)
        solver = RosterSolver(config)
        
        # Calculate employee report
        employee_df = solver.create_employee_report(
            assignments,
            employees,
            dates,
            demands=None,  # Not needed for pending_off calculation
            initial_pending_off=initial_pending_off,
            roster_data=roster_data
        )

        # For single-skill employees, keep previous month's pending_off unchanged.
        if not employee_df.empty:
            all_employee_skills = db.query(EmployeeSkills).all()
            skills_by_name = {str(es.name).strip(): es for es in all_employee_skills}
            for idx, row in employee_df.iterrows():
                name = str(row.get("employee", "")).strip()
                es = skills_by_name.get(name)
                if not es:
                    continue
                if _is_single_skill_employee(es):
                    employee_df.at[idx, "pending_off"] = float(initial_pending_off.get(name, 0.0))
        
        return employee_df
    finally:
        # Clean up temporary directory
        import shutil
        if temp_path.exists():
            shutil.rmtree(temp_path, ignore_errors=True)


def load_committed_schedules(db: Session, include_unpublished: bool = False) -> List[dict]:
    """Load all committed schedules from database."""
    # Get unique year-month combinations (respect visibility).
    year_month_query = db.query(
        CommittedSchedule.year,
        CommittedSchedule.month
    )
    if not include_unpublished:
        year_month_query = year_month_query.filter(CommittedSchedule.is_published.is_(True))
    year_month_pairs = year_month_query.distinct().all()
    
    schedules = []
    for year, month in year_month_pairs:
        # Load schedule entries
        schedule_entries = (
            db.query(CommittedSchedule)
            .options(joinedload(CommittedSchedule.user))
            .filter(
                CommittedSchedule.year == year,
                CommittedSchedule.month == month,
            )
            .order_by(CommittedSchedule.date.asc(), CommittedSchedule.employee_name.asc())
            .all()
        )
        if not include_unpublished:
            schedule_entries = [e for e in schedule_entries if bool(e.is_published)]
        
        if not schedule_entries:
            continue
        
        # Convert to DataFrame format (display name follows User when linked)
        schedule_data = [{
            'employee': committed_schedule_display_name(entry),
            'date': entry.date.isoformat(),
            'shift': entry.shift,
            'is_published': bool(entry.is_published),
        } for entry in schedule_entries]
        schedule_df = pd.DataFrame(schedule_data)
        schedule_df['date'] = pd.to_datetime(schedule_df['date'])
        # ISO strings for JSON (Timestamp is not json-serializable in stdlib json)
        schedule_df['date'] = schedule_df['date'].dt.strftime('%Y-%m-%d')
        
        # Load metrics if available
        metrics_record = db.query(ScheduleMetrics).filter(
            ScheduleMetrics.year == year,
            ScheduleMetrics.month == month
        ).first()
        metrics = metrics_record.metrics if metrics_record else {}
        
        # Extract employees data from metrics if available
        employee_df = None
        if metrics and 'employees' in metrics:
            employee_data = metrics['employees']
            if employee_data:
                employee_df = pd.DataFrame(employee_data)
        
        schedules.append({
            'year': year,
            'month': month,
            'schedule_df': schedule_df,
            'employee_df': employee_df,
            'metrics': metrics,
            'is_published': all(bool(e.is_published) for e in schedule_entries),
            'has_unpublished': any(not bool(e.is_published) for e in schedule_entries),
        })
    
    return schedules


@router.get("/committed")
async def get_committed_schedules(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all committed schedules."""
    is_manager = current_user.get("employee_type") == "Manager"
    schedules = load_committed_schedules(db, include_unpublished=is_manager)
    
    return [
        sanitize_json_floats({
            "year": s['year'],
            "month": s['month'],
            "schedule": s['schedule_df'].to_dict('records'),
            "metrics": s['metrics'],
            "is_published": s['is_published'],
            "has_unpublished": s['has_unpublished'],
        })
        for s in schedules
    ]


@router.get("/committed/{year}/{month}")
async def get_schedule(
    year: int,
    month: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific committed schedule."""
    is_manager = current_user.get("employee_type") == "Manager"
    schedules = load_committed_schedules(db, include_unpublished=is_manager)
    
    schedule = next(
        (s for s in schedules if s['year'] == year and s['month'] == month),
        None
    )
    
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    return sanitize_json_floats({
        "year": schedule['year'],
        "month": schedule['month'],
        "schedule": schedule['schedule_df'].to_dict('records'),
        "employees": schedule['employee_df'].to_dict('records') if schedule['employee_df'] is not None else None,
        "metrics": schedule['metrics'],
        "is_published": schedule['is_published'],
        "has_unpublished": schedule['has_unpublished'],
    })


@router.post("/commit")
async def commit_schedule(
    schedule_data: dict,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Commit a generated schedule to persistent storage."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can commit schedules")
    
    try:
        year = schedule_data['year']
        month = schedule_data['month']
        schedule = schedule_data['schedule']  # List of {employee, date, shift}
        employees = schedule_data.get('employees', [])  # Optional employee report data
        metrics = schedule_data.get('metrics', {})  # Optional metrics
        selected_period = schedule_data.get("selected_period")
        if selected_period is not None and not isinstance(selected_period, str):
            selected_period = None

        # Determine the date range of rows to replace before inserting.
        # When selected_period is set (Ramadan splits), delete the full logical period window so
        # stale days outside the new payload (e.g. rest of February after saving Pre-Ramadan only)
        # are not left behind.
        schedule_dates = []
        for entry in schedule:
            date_val = pd.to_datetime(entry['date'], errors='coerce').date()
            if not pd.isna(date_val):
                schedule_dates.append(date_val)

        window = (
            get_pending_off_window_inclusive(int(year), int(month), selected_period, db=db)
            if selected_period
            else None
        )
        if window:
            start_d, end_d = window
            db.query(CommittedSchedule).filter(
                CommittedSchedule.date >= start_d,
                CommittedSchedule.date <= end_d,
            ).delete()
        elif schedule_dates:
            min_date = min(schedule_dates)
            max_date = max(schedule_dates)
            db.query(CommittedSchedule).filter(
                CommittedSchedule.date >= min_date,
                CommittedSchedule.date <= max_date
            ).delete()
        else:
            # Fallback: if no valid dates, delete by year/month (backward compatibility)
            db.query(CommittedSchedule).filter(
                CommittedSchedule.year == year,
                CommittedSchedule.month == month
            ).delete()
        
        # Insert new schedule entries
        # Use each date's actual year/month (important for periods that span months like Ramadan)
        for entry in schedule:
            date_val = pd.to_datetime(entry['date'], errors='coerce').date()
            if pd.isna(date_val):
                continue
            
            # Use the date's actual year and month (not the requested year/month)
            # This allows periods spanning months (like Ramadan) to be committed correctly
            entry_year = date_val.year
            entry_month = date_val.month
            
            uid = _resolve_schedule_user_id(db, entry.get("employee", ""))
            schedule_entry = CommittedSchedule(
                year=entry_year,
                month=entry_month,
                employee_name=entry['employee'],
                user_id=uid,
                date=date_val,
                shift=entry['shift'],
                is_published=False,
            )
            db.add(schedule_entry)
        
        # Store employees data in metrics JSON
        # Reorder employees to match EmployeeSkills table order (by ID)
        if employees:
            if not isinstance(metrics, dict):
                metrics = {}
            # Get employee order from EmployeeSkills table (ordered by ID)
            employee_skills_order = db.query(EmployeeSkills).order_by(EmployeeSkills.id).all()
            employee_order_map = {emp.name: idx for idx, emp in enumerate(employee_skills_order)}
            # Create a list of employees in the correct order
            ordered_employees = []
            # First, add employees in EmployeeSkills order
            for emp_skill in employee_skills_order:
                emp_data = next((e for e in employees if e.get('employee') == emp_skill.name), None)
                if emp_data:
                    ordered_employees.append(emp_data)
            # Then add any employees not in EmployeeSkills (shouldn't happen, but be safe)
            for emp_data in employees:
                if emp_data.get('employee') not in employee_order_map:
                    ordered_employees.append(emp_data)
            metrics['employees'] = ordered_employees
            _enrich_employee_rows_with_user_id(db, ordered_employees)
            _remap_employee_metrics_to_user_id_keys(db, metrics)
        
        # Save/update metrics
        existing_metrics = db.query(ScheduleMetrics).filter(
            ScheduleMetrics.year == year,
            ScheduleMetrics.month == month
        ).first()
        
        if existing_metrics:
            existing_metrics.metrics = metrics
        else:
            metrics_entry = ScheduleMetrics(
                year=year,
                month=month,
                metrics=metrics
            )
            db.add(metrics_entry)
        
        # Update EmployeeSkills.pending_off only when this period is not in the future.
        can_sync_employee_skills_po = _should_sync_employee_skills_pending_off(
            int(year),
            int(month),
            selected_period,
            db,
        )
        report_rows = (
            metrics.get("employees")
            if isinstance(metrics, dict) and isinstance(metrics.get("employees"), list) and metrics["employees"]
            else employees
        )
        if can_sync_employee_skills_po and report_rows:
            for emp_data in report_rows:
                pending_off = emp_data.get('pending_off')
                if pending_off is None:
                    continue
                employee_skills = None
                uid = emp_data.get("user_id")
                if uid is not None:
                    try:
                        employee_skills = (
                            db.query(EmployeeSkills)
                            .filter(EmployeeSkills.user_id == int(uid))
                            .first()
                        )
                    except (TypeError, ValueError):
                        employee_skills = None
                if employee_skills is None:
                    employee_name = emp_data.get("employee")
                    if employee_name:
                        employee_skills = db.query(EmployeeSkills).filter(
                            EmployeeSkills.name == employee_name
                        ).first()
                if employee_skills:
                    # Single-skill staff pending_off must remain unchanged (not recalculated).
                    if _is_single_skill_employee(employee_skills):
                        continue
                    employee_skills.pending_off = float(pending_off)
        
        db.commit()
        
        return {
            "message": f"Schedule draft saved successfully for {year}-{month:02d}",
            "year": year,
            "month": month
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to commit schedule: {str(e)}")


@router.post("/publish")
async def publish_schedule(
    payload: dict,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Publish committed schedule rows for a month or selected period."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can publish schedules")
    try:
        year = int(payload.get("year"))
        month = int(payload.get("month"))
        selected_period = payload.get("selected_period")
        if selected_period is not None and not isinstance(selected_period, str):
            selected_period = None
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid publish request payload")

    q = db.query(CommittedSchedule)
    window = get_pending_off_window_inclusive(year, month, selected_period, db=db)
    if window:
        start_d, end_d = window
        q = q.filter(CommittedSchedule.date >= start_d, CommittedSchedule.date <= end_d)
    else:
        q = q.filter(CommittedSchedule.year == year, CommittedSchedule.month == month)

    rows = q.all()
    if not rows:
        raise HTTPException(status_code=404, detail="No draft schedule found to publish")

    changed = 0
    for row in rows:
        if not bool(row.is_published):
            row.is_published = True
            changed += 1
    db.commit()

    return {
        "message": "Schedule published successfully",
        "year": year,
        "month": month,
        "selected_period": selected_period,
        "published_rows": changed,
    }


@router.post("/unpublish")
async def unpublish_schedule(
    payload: dict,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Unpublish committed schedule rows for a month or selected period."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can unpublish schedules")
    try:
        year = int(payload.get("year"))
        month = int(payload.get("month"))
        selected_period = payload.get("selected_period")
        if selected_period is not None and not isinstance(selected_period, str):
            selected_period = None
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid unpublish request payload")

    q = db.query(CommittedSchedule)
    window = get_pending_off_window_inclusive(year, month, selected_period, db=db)
    if window:
        start_d, end_d = window
        q = q.filter(CommittedSchedule.date >= start_d, CommittedSchedule.date <= end_d)
    else:
        q = q.filter(CommittedSchedule.year == year, CommittedSchedule.month == month)

    rows = q.all()
    if not rows:
        raise HTTPException(status_code=404, detail="No published schedule found to unpublish")

    changed = 0
    for row in rows:
        if bool(row.is_published):
            row.is_published = False
            changed += 1
    db.commit()

    return {
        "message": "Schedule unpublished successfully",
        "year": year,
        "month": month,
        "selected_period": selected_period,
        "unpublished_rows": changed,
    }


@router.get("/unpublished-summary")
async def get_unpublished_summary(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Manager-only summary for unpublished schedule indicators."""
    if current_user['employee_type'] != 'Manager':
        return {"has_unpublished": False, "items": []}

    rows = (
        db.query(CommittedSchedule.year, CommittedSchedule.month, CommittedSchedule.date)
        .filter(CommittedSchedule.is_published.is_(False))
        .order_by(CommittedSchedule.year.asc(), CommittedSchedule.month.asc(), CommittedSchedule.date.asc())
        .all()
    )

    grouped: Dict[Tuple[int, int], List[date_type]] = {}
    for year, month, day in rows:
        grouped.setdefault((int(year), int(month)), []).append(day)

    items: List[dict] = []
    for (year, month), dates in grouped.items():
        periods: List[str] = detect_periods_for_dates(year, month, dates, db=db)
        items.append({
            "year": year,
            "month": month,
            "periods": periods,
            "has_unpublished": True,
        })

    return {"has_unpublished": bool(items), "items": items}


@router.put("/committed/{year}/{month}")
async def update_schedule(
    year: int,
    month: int,
    schedule_data: dict,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a committed schedule. Only managers can update schedules."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update schedules")
    
    try:
        # Check if schedule exists
        existing_count = db.query(CommittedSchedule).filter(
            CommittedSchedule.year == year,
            CommittedSchedule.month == month
        ).count()
        
        if existing_count == 0:
            raise HTTPException(status_code=404, detail="Schedule not found")
        
        schedule = schedule_data['schedule']  # List of {employee, date, shift}
        selected_period = schedule_data.get("selected_period")  # optional: pre-ramadan | ramadan | post-ramadan (2026)
        if selected_period is not None and not isinstance(selected_period, str):
            selected_period = None

        # Preserve publication state when editing existing schedules.
        publish_scope = db.query(CommittedSchedule)
        window = get_pending_off_window_inclusive(year, month, selected_period, db=db)
        if window:
            start_d, end_d = window
            publish_scope = publish_scope.filter(
                CommittedSchedule.date >= start_d,
                CommittedSchedule.date <= end_d,
            )
        else:
            publish_scope = publish_scope.filter(
                CommittedSchedule.year == year,
                CommittedSchedule.month == month,
            )
        scope_rows = publish_scope.all()
        is_published_for_updated_rows = all(bool(r.is_published) for r in scope_rows) if scope_rows else True

        # If schedule rows are unchanged, do not recalculate employee report.
        # Use stable identity by user_id only.
        incoming_rows: List[Tuple[str, date_type, str]] = []
        for entry in schedule:
            date_val = pd.to_datetime(entry.get('date'), errors='coerce').date()
            if pd.isna(date_val):
                continue
            emp_name = str(entry.get('employee', '')).strip()
            try:
                resolved_uid = _resolve_schedule_user_id(db, emp_name)
            except HTTPException:
                continue
            identity = f"uid:{int(resolved_uid)}"
            incoming_rows.append((
                identity,
                date_val,
                str(entry.get('shift', '')).strip(),
            ))
        incoming_rows_sorted = sorted(incoming_rows)
        existing_rows_sorted = sorted(
            (
                (f"uid:{int(r.user_id)}" if r.user_id is not None else ""),
                r.date,
                str(r.shift or '').strip(),
            )
            for r in scope_rows
            if r.user_id is not None
        )
        schedule_changed = incoming_rows_sorted != existing_rows_sorted
        incoming_by_emp_day: Dict[Tuple[str, date_type], str] = {
            (emp, day): shift for emp, day, shift in incoming_rows
        }
        existing_by_emp_day: Dict[Tuple[str, date_type], str] = {
            (
                (f"uid:{int(r.user_id)}" if r.user_id is not None else ""),
                r.date,
            ): str(r.shift or '').strip()
            for r in scope_rows
            if r.user_id is not None
        }
        changed_uidents: set[str] = set()
        for k in set(incoming_by_emp_day.keys()) | set(existing_by_emp_day.keys()):
            if incoming_by_emp_day.get(k) != existing_by_emp_day.get(k):
                changed_uidents.add(k[0])

        existing_metrics_for_month = db.query(ScheduleMetrics).filter(
            ScheduleMetrics.year == year,
            ScheduleMetrics.month == month
        ).first()
        existing_metrics_obj = (
            existing_metrics_for_month.metrics
            if existing_metrics_for_month and isinstance(existing_metrics_for_month.metrics, dict)
            else {}
        )
        existing_employees = existing_metrics_obj.get("employees")
        existing_employees_list = existing_employees if isinstance(existing_employees, list) else []
        incoming_employees = schedule_data.get("employees")
        incoming_employees_list = incoming_employees if isinstance(incoming_employees, list) else []

        if schedule_changed:
            # Delete existing schedule entries
            db.query(CommittedSchedule).filter(
                CommittedSchedule.year == year,
                CommittedSchedule.month == month
            ).delete()
            
            # Insert updated schedule entries
            for entry in schedule:
                date_val = pd.to_datetime(entry['date'], errors='coerce').date()
                if pd.isna(date_val):
                    continue
                
                uid = _resolve_schedule_user_id(db, entry.get("employee", ""))
                schedule_entry = CommittedSchedule(
                    year=year,
                    month=month,
                    employee_name=entry['employee'],
                    user_id=uid,
                    date=date_val,
                    shift=entry['shift'],
                    is_published=is_published_for_updated_rows,
                )
                db.add(schedule_entry)
            
            # Recalculate only when shifts/assignments changed.
            employee_df = recalculate_employee_report(
                schedule, year, month, db, selected_period=selected_period
            )
            employees = employee_df.to_dict('records')
        else:
            # No shift changes: persist direct employee-row edits from payload.
            employees = incoming_employees_list if incoming_employees_list else existing_employees_list

        # Row-level behavior for schedule edits:
        # keep previously saved pending_off for employees whose shifts did not change.
        if schedule_changed and isinstance(employees, list) and existing_employees_list:
            saved_po_by_uid: Dict[int, object] = {}
            for row in existing_employees_list:
                if not isinstance(row, dict):
                    continue
                uid = row.get("user_id")
                if uid is None or uid == "":
                    continue
                try:
                    saved_po_by_uid[int(uid)] = row.get("pending_off")
                except (TypeError, ValueError):
                    continue
            for row in employees:
                if not isinstance(row, dict):
                    continue
                uid_raw = row.get("user_id")
                if uid_raw is None or uid_raw == "":
                    continue
                try:
                    uid = int(uid_raw)
                except (TypeError, ValueError):
                    continue
                if f"uid:{uid}" in changed_uidents:
                    continue
                if uid in saved_po_by_uid:
                    row["pending_off"] = saved_po_by_uid[uid]

        # Apply direct incoming employee-row edits (e.g. manual PO in history) by user_id only.
        if isinstance(employees, list) and incoming_employees_list:
            incoming_po_by_uid: Dict[int, object] = {}
            for row in incoming_employees_list:
                if not isinstance(row, dict):
                    continue
                uid = row.get("user_id")
                if uid is None or uid == "":
                    continue
                try:
                    incoming_po_by_uid[int(uid)] = row.get("pending_off")
                except (TypeError, ValueError):
                    continue
            for row in employees:
                if not isinstance(row, dict):
                    continue
                uid = row.get("user_id")
                if uid is None or uid == "":
                    continue
                try:
                    uid_int = int(uid)
                except (TypeError, ValueError):
                    continue
                if schedule_changed and f"uid:{uid_int}" in changed_uidents:
                    # Shift-changed employees stay formula-recalculated.
                    continue
                if uid_int not in incoming_po_by_uid:
                    continue
                raw = incoming_po_by_uid[uid_int]
                if raw is None:
                    continue
                try:
                    row["pending_off"] = float(raw)
                except (TypeError, ValueError):
                    pass

        # Update metrics
        metrics = schedule_data.get('metrics', {})
        if not isinstance(metrics, dict):
            metrics = {}

        # Store employees data in metrics JSON.
        # Reorder employees to match EmployeeSkills table order (by ID)
        if employees:
            # Get employee order from EmployeeSkills table (ordered by ID)
            employee_skills_order = db.query(EmployeeSkills).order_by(EmployeeSkills.id).all()
            employee_order_map = {emp.name: idx for idx, emp in enumerate(employee_skills_order)}
            # Create a list of employees in the correct order
            ordered_employees = []
            # First, add employees in EmployeeSkills order
            for emp_skill in employee_skills_order:
                emp_data = next((e for e in employees if e.get('employee') == emp_skill.name), None)
                if emp_data:
                    ordered_employees.append(emp_data)
            # Then add any employees not in EmployeeSkills (shouldn't happen, but be safe)
            for emp_data in employees:
                if emp_data.get('employee') not in employee_order_map:
                    ordered_employees.append(emp_data)
            metrics['employees'] = ordered_employees
        else:
            metrics['employees'] = employees
        em_list = metrics.get("employees")
        if isinstance(em_list, list) and em_list:
            _enrich_employee_rows_with_user_id(db, em_list)
            _remap_employee_metrics_to_user_id_keys(db, metrics)

        if selected_period:
            metrics["pending_off_period"] = selected_period
        else:
            metrics.pop("pending_off_period", None)

        existing_metrics = db.query(ScheduleMetrics).filter(
            ScheduleMetrics.year == year,
            ScheduleMetrics.month == month
        ).first()
        
        if existing_metrics:
            existing_metrics.metrics = metrics
        else:
            metrics_entry = ScheduleMetrics(
                year=year,
                month=month,
                metrics=metrics
            )
            db.add(metrics_entry)
        
        # Update EmployeeSkills.pending_off only when this period is not in the future.
        can_sync_employee_skills_po = _should_sync_employee_skills_pending_off(
            int(year),
            int(month),
            selected_period,
            db,
        )
        report_rows = (
            metrics.get("employees")
            if isinstance(metrics, dict) and isinstance(metrics.get("employees"), list) and metrics["employees"]
            else employees
        )
        if can_sync_employee_skills_po:
            for emp_data in report_rows:
                pending_off = emp_data.get('pending_off')
                if pending_off is None:
                    continue
                employee_skills = None
                uid = emp_data.get("user_id")
                if uid is not None:
                    try:
                        employee_skills = (
                            db.query(EmployeeSkills)
                            .filter(EmployeeSkills.user_id == int(uid))
                            .first()
                        )
                    except (TypeError, ValueError):
                        employee_skills = None
                if employee_skills is None:
                    employee_name = emp_data.get('employee')
                    if employee_name:
                        employee_skills = db.query(EmployeeSkills).filter(
                            EmployeeSkills.name == employee_name
                        ).first()
                if employee_skills:
                    # Single-skill staff pending_off must remain unchanged (not recalculated).
                    if _is_single_skill_employee(employee_skills):
                        continue
                    employee_skills.pending_off = float(pending_off)
        
        db.commit()
        
        return {
            "message": f"Schedule updated successfully for {year}-{month:02d}",
            "year": year,
            "month": month
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update schedule: {str(e)}")

