"""Solver endpoints for schedule generation."""

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from pathlib import Path
import tempfile
import yaml
import pandas as pd
from typing import Dict, Optional
import sys
import uuid

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from roster.app.model.schema import RosterData, RosterConfig
from roster.app.model.solver import RosterSolver
from backend.routers.auth import get_current_user

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
    switching_penalty: float = 1.0


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


def run_solver(job_id: str, request: SolveRequest, roster_data: Dict):
    """Run solver in background."""
    try:
        solver_jobs[job_id]["status"] = "running"
        
        # Create temporary directory for solver
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # Save employees
            roster_data['employees'].to_csv(temp_path / "employees.csv", index=False)
            
            # Save demands - use DataManager to load month-specific demands
            from roster.app.ui.data_manager import DataManager
            data_manager = DataManager()
            month_demands = data_manager.load_month_demands(request.year, request.month)
            
            # Auto-generate demands if empty (same as original Streamlit behavior)
            if month_demands.empty:
                base_demand = {
                    'M': 6, 'IP': 3, 'A': 1, 'N': 1, 'M3': 1, 'M4': 1, 'H': 3, 'CL': 2
                }
                weekend_demand = {
                    'M': 0, 'IP': 0, 'A': 1, 'N': 1, 'M3': 1, 'M4': 0, 'H': 0, 'CL': 0
                }
                month_demands = data_manager.generate_month_demands(
                    request.year, request.month, base_demand, weekend_demand
                )
                # Save the generated demands for future use
                data_manager.save_month_demands(request.year, request.month, month_demands)
            
            # Ensure holiday column exists if needed
            if 'holiday' not in month_demands.columns:
                month_demands['holiday'] = ''
            
            # Convert date to string format for CSV
            demands_for_csv = month_demands.copy()
            if 'date' in demands_for_csv.columns:
                demands_for_csv['date'] = pd.to_datetime(demands_for_csv['date'], errors='coerce').dt.strftime('%Y-%m-%d')
            demands_for_csv.to_csv(temp_path / "demands.csv", index=False)
            
            # Save time_off and locks
            roster_data['time_off'].to_csv(temp_path / "time_off.csv", index=False)
            roster_data['locks'].to_csv(temp_path / "locks.csv", index=False)
            
            # Create config
            config_data = {
                "weights": {
                    "unfilled_coverage": request.unfilled_penalty,
                    "fairness": request.fairness_weight,
                    "area_switching": request.switching_penalty,
                    "do_after_n": 1.0
                },
                "rest_codes": ["DO", "ML", "W", "UL", "APP", "STL", "L", "O"],
                "forbidden_adjacencies": [["N", "M"], ["A", "N"]],
                "weekly_rest_minimum": 1
            }
            
            config_path = temp_path / "config.yaml"
            with open(config_path, 'w') as f:
                yaml.dump(config_data, f)
            
            # Load data and solve
            data = RosterData(temp_path)
            data.load_data()
            
            config = RosterConfig(config_path)
            solver = RosterSolver(config)
            
            success, assignments, metrics = solver.solve(
                data,
                time_limit_seconds=request.time_limit
            )
            
            if success:
                # Create schedule dataframe
                schedule_df = solver.create_schedule_dataframe(
                    assignments,
                    data.get_employee_names(),
                    data.get_all_dates()
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
                    initial_pending_off
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


@router.post("/solve", response_model=SolveResponse)
async def solve_schedule(
    request: SolveRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """Start a solver job."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can generate schedules")
    
    # Load roster data
    from roster.app.ui.data_manager import DataManager
    data_manager = DataManager()
    roster_data = data_manager.load_initial_data()
    
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
        error=job.get("error")
    )

