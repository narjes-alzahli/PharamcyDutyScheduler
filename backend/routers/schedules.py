"""Schedule viewing and management endpoints."""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer
from pathlib import Path
import pandas as pd
import json
from typing import List, Optional, Dict
from sqlalchemy.orm import Session
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
from backend.models import CommittedSchedule, ScheduleMetrics, EmployeeSkills
from backend.roster_data_loader import load_month_holidays
from roster.app.model.solver import RosterSolver
from roster.app.model.schema import RosterConfig

router = APIRouter()
security = HTTPBearer()


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
    
    initial_pending_off = {}
    
    if prev_metrics and prev_metrics.metrics and 'employees' in prev_metrics.metrics:
        # Use previous month's final pending_off values
        prev_employees = prev_metrics.metrics['employees']
        for emp_data in prev_employees:
            employee_name = emp_data.get('employee')
            pending_off = emp_data.get('pending_off', 0.0)
            if employee_name:
                initial_pending_off[employee_name] = float(pending_off)
    
    # For any employees not in previous month, use current EmployeeSkills.pending_off
    all_employees = db.query(EmployeeSkills).all()
    for emp in all_employees:
        if emp.name not in initial_pending_off:
            initial_pending_off[emp.name] = float(emp.pending_off or 0.0)
    
    return initial_pending_off


def recalculate_employee_report(
    schedule: List[dict], 
    year: int, 
    month: int, 
    db: Session
) -> pd.DataFrame:
    """Recalculate employee report from schedule data."""
    from datetime import date
    
    # Get initial pending_off for this month
    initial_pending_off = get_initial_pending_off_for_month(year, month, db)
    
    # Get all dates in the month
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
    
    # Load holidays for this month
    holidays = load_month_holidays(year, month, db)
    
    # Create a minimal RosterData-like object for holidays
    class SimpleRosterData:
        def get_holiday(self, day: date):
            date_str = day.isoformat()
            return holidays.get(date_str)
    
    roster_data = SimpleRosterData()
    
    # Create a temporary config (we only need it for create_employee_report)
    temp_path = Path(tempfile.mkdtemp())
    try:
        config_data = {
            "weights": {},
            "rest_codes": ["O"],  # DO is a leave type (from leave_types table), not a rest code
            "leave_codes": ["DO", "ML", "AL", "W", "UL", "APP", "STL", "L", "O"],
            "working_shift_codes": ["M", "IP", "A", "N", "M3", "M4", "H", "CL"],
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
        schedule_entries = db.query(CommittedSchedule).filter(
            CommittedSchedule.year == year,
            CommittedSchedule.month == month
        ).all()
        
        if not schedule_entries:
            continue
        
        # Convert to DataFrame format
        schedule_data = [{
            'employee': entry.employee_name,
            'date': entry.date.isoformat(),
            'shift': entry.shift
        } for entry in schedule_entries]
        schedule_df = pd.DataFrame(schedule_data)
        schedule_df['date'] = pd.to_datetime(schedule_df['date'])
        
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
        {
            "year": s['year'],
            "month": s['month'],
            "schedule": s['schedule_df'].to_dict('records'),
            "metrics": s['metrics']
        }
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
    
    return {
        "year": schedule['year'],
        "month": schedule['month'],
        "schedule": schedule['schedule_df'].to_dict('records'),
        "employees": schedule['employee_df'].to_dict('records') if schedule['employee_df'] is not None else None,
        "metrics": schedule['metrics']
    }


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
        
        # Delete existing schedule for this month
        db.query(CommittedSchedule).filter(
            CommittedSchedule.year == year,
            CommittedSchedule.month == month
        ).delete()
        
        # Insert new schedule entries
        for entry in schedule:
            date_val = pd.to_datetime(entry['date'], errors='coerce').date()
            if pd.isna(date_val):
                continue
            
            schedule_entry = CommittedSchedule(
                year=year,
                month=month,
                employee_name=entry['employee'],
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
        
        # Update EmployeeSkills.pending_off based on employee report data
        if employees:
            for emp_data in employees:
                employee_name = emp_data.get('employee')
                pending_off = emp_data.get('pending_off')
                if employee_name and pending_off is not None:
                    # Find employee_skills by name
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
        employees = schedule_data.get('employees', [])  # Optional employee report data
        
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
            
            schedule_entry = CommittedSchedule(
                year=year,
                month=month,
                employee_name=entry['employee'],
                date=date_val,
                shift=entry['shift']
            )
            db.add(schedule_entry)
        
        # Recalculate employee report from updated schedule
        # This ensures pending_off values are updated based on the new schedule
        employee_df = recalculate_employee_report(schedule, year, month, db)
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
        for emp_data in employees:
            employee_name = emp_data.get('employee')
            pending_off = emp_data.get('pending_off')
            if employee_name and pending_off is not None:
                # Find employee_skills by name
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

