"""Solver endpoints for schedule generation."""

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
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
from backend.roster_data_loader import (
    load_roster_data_from_db, 
    load_month_demands, 
    save_month_demands,
    load_month_holidays
)

router = APIRouter()
security = HTTPBearer()

# Store solver jobs (in production, use Redis or database)
solver_jobs: Dict[str, Dict] = {}


class SolveRequest(BaseModel):
    year: int
    month: int
    time_limit: int = 300
    unfilled_penalty: float = 1000.0
    fairness_weight: float = 5.0
    switching_penalty: float = 0.0


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
            
            # Save employees
            roster_data['employees'].to_csv(temp_path / "employees.csv", index=False)
            
            # Load month-specific demands from database
            month_demands = load_month_demands(request.year, request.month, db)
            
            # Demands must exist in database - do not auto-generate
            if month_demands.empty:
                error_msg = f"No demands data found for {request.year}-{request.month:02d}. Please add demands in the Staffing Needs tab before solving."
                solver_jobs[job_id]["status"] = "failed"
                solver_jobs[job_id]["error"] = error_msg
                return
            
            # Load holidays separately (not from demands CSV)
            holidays_dict = load_month_holidays(request.year, request.month)
            # Convert date strings to date objects for the holidays CSV
            holidays_for_csv = {}
            for date_str, holiday_name in holidays_dict.items():
                try:
                    date_val = pd.to_datetime(date_str, errors='coerce').date()
                    if date_val:
                        holidays_for_csv[date_val] = holiday_name
                except:
                    continue
            
            # Remove holiday column from demands CSV if it exists (shouldn't be there anymore)
            demands_for_csv = month_demands.copy()
            if 'holiday' in demands_for_csv.columns:
                demands_for_csv = demands_for_csv.drop(columns=['holiday'])
            
            # Convert date to string format for CSV
            if 'date' in demands_for_csv.columns:
                demands_for_csv['date'] = pd.to_datetime(demands_for_csv['date'], errors='coerce').dt.strftime('%Y-%m-%d')
            demands_for_csv.to_csv(temp_path / "demands.csv", index=False)
            
            # Save holidays to a separate file for pending_off calculation
            if holidays_for_csv:
                holidays_df = pd.DataFrame([
                    {'date': date_val.isoformat(), 'holiday': holiday_name}
                    for date_val, holiday_name in holidays_for_csv.items()
                ])
                holidays_df.to_csv(temp_path / "holidays.csv", index=False)
            
            # Save time_off and locks - ensure dates are formatted as YYYY-MM-DD strings
            time_off_for_csv = roster_data['time_off'].copy()
            if not time_off_for_csv.empty:
                if 'from_date' in time_off_for_csv.columns:
                    time_off_for_csv['from_date'] = pd.to_datetime(time_off_for_csv['from_date'], errors='coerce').dt.strftime('%Y-%m-%d')
                if 'to_date' in time_off_for_csv.columns:
                    time_off_for_csv['to_date'] = pd.to_datetime(time_off_for_csv['to_date'], errors='coerce').dt.strftime('%Y-%m-%d')
            time_off_for_csv.to_csv(temp_path / "time_off.csv", index=False)
            
            # Filter locks to only include STANDARD shifts (exclude non-standard like MS, C)
            # Non-standard shifts are handled via time_off as direct assignments, not constraints
            # DO is now a leave code, only assigned when requested in time off
            STANDARD_WORKING_SHIFTS = {"M", "IP", "A", "N", "M3", "M4", "H", "CL", "O"}
            locks_df = roster_data['locks'].copy()
            if not locks_df.empty and 'shift' in locks_df.columns:
                # Only keep standard shifts in locks - non-standard shifts are in time_off
                locks_df = locks_df[locks_df['shift'].isin(STANDARD_WORKING_SHIFTS)]
            # Ensure dates are formatted as YYYY-MM-DD strings
            if not locks_df.empty:
                if 'from_date' in locks_df.columns:
                    locks_df['from_date'] = pd.to_datetime(locks_df['from_date'], errors='coerce').dt.strftime('%Y-%m-%d')
                if 'to_date' in locks_df.columns:
                    locks_df['to_date'] = pd.to_datetime(locks_df['to_date'], errors='coerce').dt.strftime('%Y-%m-%d')
            locks_df.to_csv(temp_path / "locks.csv", index=False)
            
            # Load leave types, shift types, and rest codes from database
            from backend.models import ShiftType
            db = SessionLocal()
            try:
                all_leave_types = db.query(LeaveType).filter(
                    LeaveType.is_active == True
                ).all()
                leave_codes = [lt.code for lt in all_leave_types]
                
                rest_leave_types = [lt for lt in all_leave_types if lt.counts_as_rest == True]
                rest_codes = [lt.code for lt in rest_leave_types]
                
                # Load all active shift types
                all_shift_types = db.query(ShiftType).filter(
                    ShiftType.is_active == True
                ).all()
                
                # Standard working shifts that the solver can optimize and assign
                # Non-standard shifts (like MS, C) should only be assigned when explicitly requested
                STANDARD_WORKING_SHIFTS = {"M", "IP", "A", "N", "M3", "M4", "H", "CL"}
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
            except Exception as e:
                # Fallback to default codes if database query fails
                # DO is a leave code, only assigned when requested in time off
                leave_codes = ["DO", "ML", "AL", "W", "UL", "APP", "STL", "L", "O"]
                rest_codes = ["DO", "ML", "AL", "W", "UL", "APP", "STL", "L", "O"]
                working_shift_codes = ["M", "IP", "A", "N", "M3", "M4", "H", "CL"]
                # DO is in leave_codes, so it will be available when requested, but not in all_shift_codes for automatic assignment
                all_shift_codes = ["M", "IP", "A", "N", "M3", "M4", "H", "CL", "O"]
                print(f"Warning: Failed to load shift/leave types from database: {e}. Using defaults.")
            finally:
                db.close()
            
            # Create config
            config_data = {
                "weights": {
                    "unfilled_coverage": request.unfilled_penalty,
                    "fairness": request.fairness_weight,
                    "area_switching": request.switching_penalty,
                    "do_after_n": 1.0
                },
                "rest_codes": rest_codes,
                "leave_codes": leave_codes,  # All active leave codes for the solver
                "working_shift_codes": working_shift_codes,  # All active working shift codes
                "all_shift_codes": all_shift_codes,  # All shifts (working + rest like DO, O)
                "forbidden_adjacencies": [["N", "M"], ["A", "N"], ["N", "N"]],
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
            
            # Load data with config reference
            data = RosterData(temp_path, config)
            data.load_data()
            
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


@router.get("/job/{job_id}", response_model=JobStatus)
async def get_job_status(job_id: str, current_user: dict = Depends(get_current_user)):
    """Get solver job status."""
    if job_id not in solver_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = solver_jobs[job_id]
    return JobStatus(
        job_id=job_id,
        status=job["status"],
        result=job.get("result"),
        error=job.get("error"),
        issues=job.get("issues")
    )

