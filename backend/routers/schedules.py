"""Schedule viewing and management endpoints."""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer
from pathlib import Path
import pandas as pd
import json
from typing import List, Optional, Dict, Tuple
from sqlalchemy.orm import Session, joinedload
from datetime import date as date_type
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
from roster.app.model.solver import RosterSolver
from roster.app.model.schema import RosterConfig

router = APIRouter()
security = HTTPBearer()


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


def get_initial_pending_off_for_month(year: int, month: int, db: Session) -> Dict[str, float]:
    """Get initial pending_off values that should be used for this month.
    
    This is the previous month's final pending_off, or EmployeeSkills.pending_off if no previous month exists.
    """
    # Calculate previous month
    if month == 1:
        prev_year = year - 1
        prev_month = 12
    else:
        prev_year = year
        prev_month = month - 1
    
    # Try to get previous month's final pending_off from ScheduleMetrics
    prev_metrics = db.query(ScheduleMetrics).filter(
        ScheduleMetrics.year == prev_year,
        ScheduleMetrics.month == prev_month
    ).first()
    
    initial_pending_off: Dict[str, float] = {}
    po_by_uid: Dict[int, float] = {}
    po_by_name: Dict[str, float] = {}

    if prev_metrics and prev_metrics.metrics and "employees" in prev_metrics.metrics:
        prev_employees = prev_metrics.metrics["employees"]
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


def get_pending_off_window_inclusive(
    year: int, month: int, selected_period: Optional[str]
) -> Optional[Tuple[date_type, date_type]]:
    """Match frontend ``getPendingOffWindow`` (2026 Ramadan split). Inclusive date bounds."""
    if year != 2026 or not selected_period:
        return None
    if selected_period == "pre-ramadan" and month == 2:
        return date_type(2026, 2, 1), date_type(2026, 2, 18)
    if selected_period == "ramadan" and month in (2, 3):
        return date_type(2026, 2, 19), date_type(2026, 3, 18)
    if selected_period == "post-ramadan" and month == 3:
        return date_type(2026, 3, 19), date_type(2026, 3, 31)
    return None


def recalculate_employee_report(
    schedule: List[dict],
    year: int,
    month: int,
    db: Session,
    selected_period: Optional[str] = None,
) -> pd.DataFrame:
    """Recalculate employee report from schedule data."""
    from datetime import date, timedelta

    # Get initial pending_off for this month
    initial_pending_off = get_initial_pending_off_for_month(year, month, db)

    window = get_pending_off_window_inclusive(year, month, selected_period)
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
        leave_codes = ["DO", "ML", "AL", "W", "UL", "APP", "STL", "L", "O"]
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
        
        return employee_df
    finally:
        # Clean up temporary directory
        import shutil
        if temp_path.exists():
            shutil.rmtree(temp_path, ignore_errors=True)


def load_committed_schedules(db: Session) -> List[dict]:
    """Load all committed schedules from database."""
    # Get unique year-month combinations
    from sqlalchemy import distinct, func
    year_month_pairs = db.query(
        CommittedSchedule.year,
        CommittedSchedule.month
    ).distinct().all()
    
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
            .all()
        )
        
        if not schedule_entries:
            continue
        
        # Convert to DataFrame format (display name follows User when linked)
        schedule_data = [{
            'employee': committed_schedule_display_name(entry),
            'date': entry.date.isoformat(),
            'shift': entry.shift
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
            'metrics': metrics
        })
    
    return schedules


@router.get("/committed")
async def get_committed_schedules(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all committed schedules."""
    schedules = load_committed_schedules(db)
    
    return [
        sanitize_json_floats({
            "year": s['year'],
            "month": s['month'],
            "schedule": s['schedule_df'].to_dict('records'),
            "metrics": s['metrics']
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
    schedules = load_committed_schedules(db)
    
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
        "metrics": schedule['metrics']
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
        
        # Determine the date range of the schedule being committed
        # This allows us to delete only entries in this specific range (important for periods)
        schedule_dates = []
        for entry in schedule:
            date_val = pd.to_datetime(entry['date'], errors='coerce').date()
            if not pd.isna(date_val):
                schedule_dates.append(date_val)
        
        if schedule_dates:
            min_date = min(schedule_dates)
            max_date = max(schedule_dates)
            
            # Delete existing schedule entries only for dates in this range
            # This prevents deleting entries from other periods (e.g., Pre-Ramadan when committing Ramadan)
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
                shift=entry['shift']
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
        
        # Update EmployeeSkills.pending_off (prefer enriched metrics rows with user_id)
        report_rows = (
            metrics.get("employees")
            if isinstance(metrics, dict) and isinstance(metrics.get("employees"), list) and metrics["employees"]
            else employees
        )
        if report_rows:
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
                    employee_skills.pending_off = float(pending_off)
        
        db.commit()
        
        return {
            "message": f"Schedule committed successfully for {year}-{month:02d}",
            "year": year,
            "month": month
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to commit schedule: {str(e)}")


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
                shift=entry['shift']
            )
            db.add(schedule_entry)
        
        # Recalculate employee report from updated schedule (same date scope as frontend when selected_period set)
        employee_df = recalculate_employee_report(
            schedule, year, month, db, selected_period=selected_period
        )
        employees = employee_df.to_dict('records')

        # Update metrics
        metrics = schedule_data.get('metrics', {})
        if not isinstance(metrics, dict):
            metrics = {}

        # Store recalculated employees data in metrics JSON
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
        
        # Update EmployeeSkills.pending_off based on recalculated employee report
        report_rows = (
            metrics.get("employees")
            if isinstance(metrics, dict) and isinstance(metrics.get("employees"), list) and metrics["employees"]
            else employees
        )
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

