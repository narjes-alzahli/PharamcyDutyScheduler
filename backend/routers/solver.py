"""Solver endpoints for schedule generation."""

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from pathlib import Path
import tempfile
import yaml
import pandas as pd
from typing import Dict, Optional
from datetime import date
import sys
import uuid

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from roster.app.model.schema import RosterData, RosterConfig
from roster.app.model.solver import RosterSolver
from backend.routers.auth import get_current_user
from backend.database import SessionLocal, get_db
from backend.models import LeaveType
from backend.utils import deep_json_safe
from backend.roster_data_loader import (
    load_roster_data_from_db, 
    load_month_demands, 
    load_demands_by_date_range,
    save_month_demands,
    load_month_holidays,
    load_holidays_by_date_range,
    load_previous_month_last_days,
    load_previous_period_last_days
)
from backend.routers.data import get_pending_off_from_most_recent_committed_month

router = APIRouter()
security = HTTPBearer()

# Forbidden adjacency pairs: (prev_shift, next_shift) - used for previous-period boundary
FORBIDDEN_ADJACENCY_PAIRS = [
    ("N", "M"), ("N", "IP"), ("N", "M3"), ("N", "APP"),
    ("E", "M"), ("E", "IP"), ("E", "M3"),
]

# Store solver jobs (in production, use Redis or database)
solver_jobs: Dict[str, Dict] = {}


class SolveRequest(BaseModel):
    year: int
    month: int
    time_limit: int = 300
    unfilled_penalty: float = 1000.0
    fairness_weight: float = 5.0
    start_date: Optional[date] = None  # Optional: if provided, filter to this date range
    end_date: Optional[date] = None  # Optional: if provided, filter to this date range


class SolveResponse(BaseModel):
    job_id: str
    status: str
    message: str


class JobStatus(BaseModel):
    job_id: str
    status: str  # "pending", "running", "completed", "failed"
    progress: Optional[float] = None
    result: Optional[Dict] = None
    error: Optional[str] = None
    issues: Optional[list] = None  # List of sanity check issues


def run_solver(job_id: str, request: SolveRequest, roster_data: Dict):
    """Run solver in background."""
    from backend.database import SessionLocal
    
    db = SessionLocal()
    try:
        solver_jobs[job_id]["status"] = "running"

        # Create temporary directory for solver
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # Employees for RosterData (strip internal keys not in roster schema)
            emp_df = roster_data["employees"].copy()
            if "user_id" in emp_df.columns:
                emp_df = emp_df.drop(columns=["user_id"])
            
            # Determine date range for filtering
            if request.start_date and request.end_date:
                # Use custom date range (treat as one continuous period, even if it spans multiple months)
                start_date = request.start_date
                end_date = request.end_date
                month_demands = load_demands_by_date_range(start_date, end_date, db)
                holidays_dict = load_holidays_by_date_range(start_date, end_date)
                period_name = f"{start_date} to {end_date}"
            else:
                # Use full month (backward compatible)
                import calendar
                start_date = date(request.year, request.month, 1)
                end_date = date(request.year, request.month, calendar.monthrange(request.year, request.month)[1])
                month_demands = load_month_demands(request.year, request.month, db)
                holidays_dict = load_month_holidays(request.year, request.month)
                period_name = f"{request.year}-{request.month:02d}"
            
            # Demands must exist in database - do not auto-generate
            if month_demands.empty:
                error_msg = f"No demands data found for {period_name}. Please add demands in the Staffing Needs tab before solving."
                solver_jobs[job_id]["status"] = "failed"
                solver_jobs[job_id]["error"] = error_msg
                return
            
            # Always clamp demands to the selected solve period.
            month_demands = month_demands[
                (pd.to_datetime(month_demands['date']) >= pd.Timestamp(start_date)) &
                (pd.to_datetime(month_demands['date']) <= pd.Timestamp(end_date))
            ]
            if month_demands.empty:
                error_msg = f"No demands data found for {period_name}. Please add demands in the Staffing Needs tab before solving."
                solver_jobs[job_id]["status"] = "failed"
                solver_jobs[job_id]["error"] = error_msg
                return
            # Convert date strings to date objects for the holidays CSV
            holidays_for_csv = {}
            for date_str, holiday_name in holidays_dict.items():
                try:
                    date_val = pd.to_datetime(date_str, errors='coerce').date()
                    if date_val:
                        holidays_for_csv[date_val] = holiday_name
                except:
                    continue
            
            # Demands for RosterData (holiday lives in holidays_dict, not in demands frame)
            demands_for_solver = month_demands.copy()
            if 'holiday' in demands_for_solver.columns:
                demands_for_solver = demands_for_solver.drop(columns=['holiday'])
            
            # Filter time_off to the selected solve period (month or custom range).
            time_off_for_solver = roster_data['time_off'].copy()
            if not time_off_for_solver.empty:
                def overlaps_range(row):
                    from_date = pd.to_datetime(row.get('from_date', ''), errors='coerce')
                    to_date = pd.to_datetime(row.get('to_date', ''), errors='coerce')
                    if pd.isna(from_date) or pd.isna(to_date):
                        return False
                    return not (to_date.date() < start_date or from_date.date() > end_date)

                time_off_for_solver = time_off_for_solver[time_off_for_solver.apply(overlaps_range, axis=1)]
            
            # Filter locks to only include STANDARD shifts (exclude non-standard like MS, C)
            # Non-standard shifts are handled via time_off as direct assignments, not constraints
            # DO is now a leave code, only assigned when requested in time off
            from backend.roster_data_loader import get_standard_working_shifts
            STANDARD_WORKING_SHIFTS = get_standard_working_shifts(db) | {"O"}  # Include O (Off Duty)
            locks_df = roster_data['locks'].copy()
            if not locks_df.empty and 'shift' in locks_df.columns:
                # Only keep standard shifts in locks - non-standard shifts are in time_off
                locks_df = locks_df[locks_df['shift'].isin(STANDARD_WORKING_SHIFTS)]
            
            # Filter locks to the selected solve period (month or custom range).
            if not locks_df.empty:
                def lock_in_range(row):
                    from_date = pd.to_datetime(row.get('from_date', ''), errors='coerce')
                    to_date = pd.to_datetime(row.get('to_date', ''), errors='coerce')
                    if pd.isna(from_date) or pd.isna(to_date):
                        return False
                    # Check if the lock range overlaps with [start_date, end_date]
                    return not (to_date.date() < start_date or from_date.date() > end_date)
                
                locks_df = locks_df[locks_df.apply(lock_in_range, axis=1)]
            
            # Load previous period's last 2 days and apply adjacency constraints
            # This works for normal months and special periods (pre-Ramadan, Ramadan, post-Ramadan)
            # Determine the start date of the period being generated
            if request.start_date:
                period_start = request.start_date
            else:
                # Standard month - use first day of month
                period_start = date(request.year, request.month, 1)
            
            # Load trailing days of the previous committed period
            # This finds the actual previous committed period, not just calendar month boundaries
            prev_period_shifts = load_previous_period_last_days(period_start, db, lookback_days=8)
            
            if prev_period_shifts:
                # Get first 2 days of the period being generated
                first_day = period_start
                
                # Get the actual last 2 dates from the previous period
                prev_dates = sorted(set(date for _, date in prev_period_shifts.keys()))
                if len(prev_dates) >= 2:
                    second_last_date = prev_dates[-2]  # Second to last
                    last_date = prev_dates[-1]  # Last
                elif len(prev_dates) == 1:
                    second_last_date = None
                    last_date = prev_dates[0]
                else:
                    last_date = None
                    second_last_date = None
                
                # Track forbidden shifts (forbidden adjacencies)
                forbidden_shifts = {}  # (employee, day, shift) -> True if shift is forbidden
                
                # Apply adjacency rules based on previous period's shifts
                for (emp, prev_date), shift in prev_period_shifts.items():
                    if shift == "N":
                        if prev_date == last_date:
                            for s1, s2 in FORBIDDEN_ADJACENCY_PAIRS:
                                if s1 == "N":
                                    forbidden_shifts[(emp, first_day, s2)] = True
                    elif prev_date == last_date:
                        for s1, s2 in FORBIDDEN_ADJACENCY_PAIRS:
                            if s1 == shift:
                                forbidden_shifts[(emp, first_day, s2)] = True

                # Weekend carry-over across period boundary:
                # if an employee worked Fri/Sat in the previous weekend, force O on next Fri/Sat
                # unless there is an explicit in-range forced working lock on those days.
                from datetime import timedelta
                boundary_weekend_locks = []

                # Identify the nearest previous Saturday (within one week before period start).
                prev_saturday = None
                for delta in range(1, 8):
                    candidate = period_start - timedelta(days=delta)
                    if candidate.weekday() == 5:  # Saturday
                        prev_saturday = candidate
                        break

                if prev_saturday is not None:
                    prev_friday = prev_saturday - timedelta(days=1)
                    next_friday = prev_friday + timedelta(days=7)
                    next_saturday = prev_saturday + timedelta(days=7)

                    # Build quick lookup for existing forced working locks on boundary weekend days.
                    forced_work_days = set()
                    if not locks_df.empty:
                        for _, row in locks_df.iterrows():
                            if row.get('force') is True:
                                day_val = pd.to_datetime(row.get('from_date', ''), errors='coerce')
                                shift_val = row.get('shift')
                                emp_val = row.get('employee')
                                if pd.notna(day_val) and emp_val and shift_val in STANDARD_WORKING_SHIFTS and shift_val != "O":
                                    forced_work_days.add((emp_val, day_val.date()))

                    prev_shift_map = {(e, d): s for (e, d), s in prev_period_shifts.items()}
                    employees_in_prev = set(emp for (emp, _), _shift in prev_period_shifts.items())
                    for emp in employees_in_prev:
                        worked_prev_weekend = (
                            prev_shift_map.get((emp, prev_friday)) in STANDARD_WORKING_SHIFTS - {"O"} or
                            prev_shift_map.get((emp, prev_saturday)) in STANDARD_WORKING_SHIFTS - {"O"}
                        )
                        if not worked_prev_weekend:
                            continue

                        for target_day in (next_friday, next_saturday):
                            if not (start_date <= target_day <= end_date):
                                continue
                            if (emp, target_day) in forced_work_days:
                                continue
                            boundary_weekend_locks.append({
                                'employee': emp,
                                'from_date': target_day,
                                'to_date': target_day,
                                'shift': 'O',
                                'force': True,
                                'reason': 'Weekend carry-over from previous period'
                            })
                
                # Add locks to forbid specific shifts (forbidden adjacencies)
                forbidden_locks = []
                for (emp, forbid_day, forbid_shift), _ in forbidden_shifts.items():
                    forbidden_locks.append({
                        'employee': emp,
                        'from_date': forbid_day,
                        'to_date': forbid_day,
                        'shift': forbid_shift,
                        'force': False,  # False = forbid this shift
                        'reason': 'Forbidden adjacency from previous period'
                    })
                
                # Merge all locks
                all_new_locks = boundary_weekend_locks + forbidden_locks
                if all_new_locks:
                    new_locks_df = pd.DataFrame(all_new_locks)
                    # Merge with existing locks (avoid duplicates)
                    if locks_df.empty:
                        locks_df = new_locks_df
                    else:
                        # Check for existing locks to avoid duplicates
                        existing_keys = set()
                        if not locks_df.empty:
                            for _, row in locks_df.iterrows():
                                emp_name = row.get('employee')
                                from_date = pd.to_datetime(row.get('from_date', '')).date() if pd.notna(row.get('from_date')) else None
                                shift = row.get('shift')
                                if emp_name and from_date and shift:
                                    existing_keys.add((emp_name, from_date, shift))
                        
                        # Only add new locks that don't already exist
                        filtered_locks = []
                        for _, row in new_locks_df.iterrows():
                            emp_name = row.get('employee')
                            from_date = pd.to_datetime(row.get('from_date', '')).date() if pd.notna(row.get('from_date')) else None
                            shift = row.get('shift')
                            if emp_name and from_date and shift:
                                if (emp_name, from_date, shift) not in existing_keys:
                                    filtered_locks.append(row.to_dict())
                        
                        if filtered_locks:
                            filtered_locks_df = pd.DataFrame(filtered_locks)
                            locks_df = pd.concat([locks_df, filtered_locks_df], ignore_index=True)
            
            # Load leave types, shift types, and rest codes from database
            from backend.models import ShiftType
            db_cfg = SessionLocal()
            try:
                all_leave_types = db_cfg.query(LeaveType).filter(
                    LeaveType.is_active == True
                ).all()
                leave_codes = [lt.code for lt in all_leave_types]
                
                rest_leave_types = [lt for lt in all_leave_types if lt.counts_as_rest == True]
                rest_codes = [lt.code for lt in rest_leave_types]
                
                # Load all active shift types
                all_shift_types = db_cfg.query(ShiftType).filter(
                    ShiftType.is_active == True
                ).all()
                
                # Standard working shifts that the solver can optimize and assign
                # Non-standard shifts (like MS, C) should only be assigned when explicitly requested
                from backend.roster_data_loader import get_standard_working_shifts
                STANDARD_WORKING_SHIFTS = get_standard_working_shifts(db_cfg)
                working_shift_codes = [st.code for st in all_shift_types 
                                      if st.is_working_shift == True and st.code in STANDARD_WORKING_SHIFTS]
                # Only include standard shifts + O in all_shift_codes
                # DO is now a leave code, only assigned when requested in time off
                # Exclude non-standard shifts like MS - they'll be added via time_off when requested
                all_shift_codes = [st.code for st in all_shift_types 
                                   if st.code in STANDARD_WORKING_SHIFTS or st.code == "O"]
                
                # Add non-standard shift types (like MS, C) to leave_codes so they're treated as leave-only
                # These shifts should only be assigned when explicitly requested, never randomly
                # DO is already in leave_codes (from LeaveType table), so we don't need to exclude it here
                non_standard_shift_codes = [st.code for st in all_shift_types 
                                           if st.code not in STANDARD_WORKING_SHIFTS and st.code != "O"]
                # Add non-standard shifts to leave_codes (they behave like leave types in the solver)
                # Use set to avoid duplicates, then convert back to list
                leave_codes_set = set(leave_codes)
                leave_codes_set.update(non_standard_shift_codes)
                leave_codes = list(leave_codes_set)

                if not all_shift_codes:
                    raise RuntimeError(
                        "No active shift types matched the standard working set and 'O'. "
                        "Check shift_types in the database."
                    )
                if not leave_codes:
                    raise RuntimeError(
                        "No active leave types in the database. Add leave types before solving."
                    )
            finally:
                db_cfg.close()
            
            # Create config
            config_data = {
                "weights": {
                    "unfilled_coverage": getattr(request, "unfilled_penalty", None) or 1000.0,
                    "fairness": request.fairness_weight,
                    "rest_after_shift": 4000.0,
                    "do_after_n": 1.0,
                    "as_preference": 1000.0,
                },
                "rest_codes": rest_codes,
                "leave_codes": leave_codes,  # All active leave codes for the solver
                "working_shift_codes": working_shift_codes,  # All active working shift codes
                "all_shift_codes": all_shift_codes,  # All shifts (working + rest like O, plus leave types like DO from database)
                "forbidden_adjacencies": [
                    ["N", "M"], ["N", "IP"], ["N", "M3"],
                    ["E", "M"], ["E", "IP"], ["E", "M3"],
                    ["N", "APP"],
                ],
                "weekly_rest_minimum": 1,
                "required_rest_after_shifts": [
                    {"shift": "N", "rest_days": 2, "rest_code": "O"},
                    {"shift": "M4", "rest_days": 1, "rest_code": "O"},
                    {"shift": "A", "rest_days": 1, "rest_code": "O"}
                ]
            }
            
            config_path = temp_path / "config.yaml"
            with open(config_path, 'w') as f:
                yaml.dump(config_data, f)
            
            # Load config first to get leave codes
            config = RosterConfig(config_path)
            
            # Build RosterData in memory (same parsing as CSV load_data; avoids DB→CSV→read hop)
            data = RosterData.from_dataframes(
                config,
                employees=emp_df,
                demands=demands_for_solver,
                time_off=time_off_for_solver if not time_off_for_solver.empty else None,
                locks=locks_df if not locks_df.empty else None,
                holidays_dict=holidays_for_csv if holidays_for_csv else None,
                as_preferences=roster_data.get("as_preferences", []),
                data_dir=temp_path,
            )
            data.previous_period_shifts = prev_period_shifts or {}
            # Keep pending_off source consistent with GET /api/data/employees.
            latest_po_by_name, latest_po_by_uid = get_pending_off_from_most_recent_committed_month(db)
            for emp_data in data.employees:
                effective_po = None
                uid = getattr(emp_data, "user_id", None)
                if uid is not None and uid in latest_po_by_uid:
                    effective_po = latest_po_by_uid[uid]
                else:
                    emp_name = getattr(emp_data, "employee", None)
                    if emp_name in latest_po_by_name:
                        effective_po = latest_po_by_name[emp_name]
                if effective_po is not None:
                    emp_data.pending_off = float(effective_po)
            
            # [HISTORY_AWARE_FAIRNESS] Extract assignment history for fairness calculations
            # Build skills dict from employees data
            skills_dict = {}
            for emp_data in data.employees:
                skills_dict[emp_data.employee] = data.get_employee_skills(emp_data.employee)
            
            # Extract history using rolling window method (default: 3 months)
            # Use the start date for history calculation (or first day of month if no custom range)
            from backend.roster_data_loader import load_assignment_history
            history_year = start_date.year
            history_month = start_date.month
            history_counts = load_assignment_history(
                history_year,
                history_month,
                data.get_employee_names(),
                skills_dict,
                db=db,
                method="rolling_window",
                window_months=3,
                period_start_date=start_date,
            )
            data.history_counts = history_counts

            solver = RosterSolver(config)

            success, assignments, metrics = solver.solve(
                data,
                time_limit_seconds=request.time_limit
            )
            
            if success:
                # Create schedule dataframe (pass data so dynamic leave types like CS are included)
                schedule_df = solver.create_schedule_dataframe(
                    assignments,
                    data.get_employee_names(),
                    data.get_all_dates(),
                    data  # Pass data so CS and other dynamic leave types are included
                )
                
                # Create employee report with updated pending_off values
                demands = {day: data.get_daily_requirement(day) for day in data.get_all_dates()}
                initial_pending_off = {}
                for emp_data in data.employees:
                    # Preserve None when source says None (single-skill freeze should keep it).
                    uid = getattr(emp_data, "user_id", None)
                    if uid is not None and uid in latest_po_by_uid:
                        initial_pending_off[emp_data.employee] = latest_po_by_uid[uid]
                    elif emp_data.employee in latest_po_by_name:
                        initial_pending_off[emp_data.employee] = latest_po_by_name[emp_data.employee]
                    else:
                        initial_pending_off[emp_data.employee] = emp_data.pending_off
                
                employee_df = solver.create_employee_report(
                    assignments,
                    data.get_employee_names(),
                    data.get_all_dates(),
                    demands,
                    initial_pending_off,
                    roster_data=data
                )
                
                solver_jobs[job_id]["status"] = "completed"
                solver_jobs[job_id]["result"] = {
                    "schedule": schedule_df.to_dict('records'),
                    "employees": employee_df.to_dict('records'),
                    "metrics": metrics
                }
            else:
                solver_jobs[job_id]["status"] = "failed"
                # Provide more detailed error message
                error_msg = "Solver failed to find a solution. "
                if metrics and metrics.get("status") == "INFEASIBLE":
                    # Check if sanity check found specific issues
                    if metrics.get("sanity_check_failed"):
                        error_msg = metrics.get("error_message", error_msg)
                        # Store issues separately for frontend display
                        solver_jobs[job_id]["issues"] = metrics.get("issues", [])
                    else:
                        error_msg += "The constraints may be too restrictive. Check: "
                        error_msg += "1) Employee skills match shift requirements, "
                        error_msg += "2) Time off requests don't conflict with coverage needs, "
                        error_msg += "3) Lock constraints are feasible."
                else:
                    error_msg += "Try increasing the time limit or relaxing constraints."
                solver_jobs[job_id]["error"] = error_msg
                
    except ValueError as e:
        solver_jobs[job_id]["status"] = "failed"
        solver_jobs[job_id]["error"] = f"Roster data error: {e}"
    except Exception as e:
        solver_jobs[job_id]["status"] = "failed"
        solver_jobs[job_id]["error"] = str(e)
    finally:
        db.close()


@router.post("/solve", response_model=SolveResponse)
async def solve_schedule(
    request: SolveRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """Start a solver job."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can generate schedules")
    
    # Load roster data from database
    db = next(get_db())
    try:
            # Expand ranges into individual days for solver
            roster_data = load_roster_data_from_db(db, expand_ranges=True)
    finally:
        db.close()
    
    # Create job
    job_id = str(uuid.uuid4())
    solver_jobs[job_id] = {
        "status": "pending",
        "request": request.dict()
    }
    
    # Start solver in background
    background_tasks.add_task(run_solver, job_id, request, roster_data)
    
    return SolveResponse(
        job_id=job_id,
        status="pending",
        message="Solver job started"
    )


@router.get("/job/{job_id}")
async def get_job_status(job_id: str, current_user: dict = Depends(get_current_user)):
    """Get solver job status.

    ``result`` is deep-sanitized (numpy scalars, date keys in metrics, NaN) so responses
    never fail JSON encoding with 500.
    """
    if job_id not in solver_jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = solver_jobs[job_id]
    payload = {
        "job_id": job_id,
        "status": job["status"],
        "progress": job.get("progress"),
        "result": job.get("result"),
        "error": job.get("error"),
        "issues": job.get("issues"),
    }
    return JSONResponse(content=deep_json_safe(payload))

