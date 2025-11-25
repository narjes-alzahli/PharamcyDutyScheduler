"""Schedule viewing and management endpoints."""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer
from pathlib import Path
import pandas as pd
import json
from typing import List, Optional
import sys

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.routers.auth import get_current_user

router = APIRouter()
security = HTTPBearer()


def load_committed_schedules() -> List[dict]:
    """Load all committed schedules."""
    schedules_dir = Path("roster/app/data/committed_schedules")
    schedules = []
    
    if not schedules_dir.exists():
        return schedules
    
    # Find all schedule CSV files
    schedule_files = sorted(schedules_dir.glob("schedule_*_schedule.csv"))
    
    for schedule_file in schedule_files:
        # Extract date from filename (e.g., schedule_2025_03_schedule.csv)
        parts = schedule_file.stem.split('_')
        if len(parts) >= 3:
            year = int(parts[1])
            month = int(parts[2])
            
            schedule_df = pd.read_csv(schedule_file)
            schedule_df['date'] = pd.to_datetime(schedule_df['date'])
            
            # Load employee data if available
            employee_file = schedule_file.parent / f"schedule_{year}_{month:02d}_employee.csv"
            employee_df = None
            if employee_file.exists():
                employee_df = pd.read_csv(employee_file)
            
            # Load metrics if available
            metrics_file = schedule_file.parent / f"schedule_{year}_{month:02d}_metrics.json"
            metrics = None
            if metrics_file.exists():
                with open(metrics_file, 'r') as f:
                    metrics = json.load(f)
            
            schedules.append({
                'year': year,
                'month': month,
                'schedule_df': schedule_df,
                'employee_df': employee_df,
                'metrics': metrics
            })
    
    return schedules


@router.get("/committed")
async def get_committed_schedules(current_user: dict = Depends(get_current_user)):
    """Get all committed schedules."""
    schedules = load_committed_schedules()
    
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
    current_user: dict = Depends(get_current_user)
):
    """Get a specific committed schedule."""
    schedules = load_committed_schedules()
    
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
    current_user: dict = Depends(get_current_user)
):
    """Commit a generated schedule to persistent storage."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can commit schedules")
    
    try:
        from datetime import datetime
        import json
        
        year = schedule_data['year']
        month = schedule_data['month']
        schedule = schedule_data['schedule']  # List of {employee, date, shift}
        employees = schedule_data.get('employees', [])  # Optional employee data
        metrics = schedule_data.get('metrics', {})  # Optional metrics
        
        # Create committed schedules directory if it doesn't exist
        committed_dir = Path("roster/app/data/committed_schedules")
        committed_dir.mkdir(parents=True, exist_ok=True)
        
        # Create filename with year and month
        filename_prefix = f"schedule_{year}_{month:02d}"
        
        # Convert schedule to DataFrame
        schedule_df = pd.DataFrame(schedule)
        if 'date' in schedule_df.columns:
            # Handle both "YYYY-MM-DD" and "YYYY-MM-DDTHH:MM:SS" formats
            # Let pandas auto-detect the format - it handles both ISO8601 and simple date formats
            schedule_df['date'] = pd.to_datetime(schedule_df['date'], errors='coerce')
        
        # Save schedule data
        schedule_df.to_csv(committed_dir / f"{filename_prefix}_schedule.csv", index=False)
        
        # Save employee data if provided
        if employees:
            employee_df = pd.DataFrame(employees)
            employee_df.to_csv(committed_dir / f"{filename_prefix}_employee.csv", index=False)
        
        # Create a simple coverage DataFrame (can be enhanced later)
        if 'date' in schedule_df.columns and len(schedule_df) > 0:
            unique_dates = schedule_df['date'].unique()
            coverage_df = pd.DataFrame({
                'date': unique_dates,
                'coverage': [0] * len(unique_dates)
            })
            coverage_df.to_csv(committed_dir / f"{filename_prefix}_coverage.csv", index=False)
        
        # Save metrics
        def convert_dates(obj):
            from pandas import Timestamp
            if isinstance(obj, dict):
                return {str(k) if isinstance(k, (datetime, Timestamp)) else k: convert_dates(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_dates(item) for item in obj]
            elif isinstance(obj, (datetime, Timestamp)):
                return obj.isoformat()
            else:
                return obj
        
        serializable_metrics = convert_dates(metrics)
        with open(committed_dir / f"{filename_prefix}_metrics.json", 'w') as f:
            json.dump(serializable_metrics, f, indent=2)
        
        return {
            "message": f"Schedule committed successfully for {year}-{month:02d}",
            "year": year,
            "month": month
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to commit schedule: {str(e)}")


@router.put("/committed/{year}/{month}")
async def update_schedule(
    year: int,
    month: int,
    schedule_data: dict,
    current_user: dict = Depends(get_current_user)
):
    """Update a committed schedule. Only managers can update schedules."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update schedules")
    
    try:
        from datetime import datetime
        import json
        
        schedule = schedule_data['schedule']  # List of {employee, date, shift}
        employees = schedule_data.get('employees')  # Optional employee data update
        
        # Create committed schedules directory if it doesn't exist
        committed_dir = Path("roster/app/data/committed_schedules")
        committed_dir.mkdir(parents=True, exist_ok=True)
        
        # Create filename with year and month
        filename_prefix = f"schedule_{year}_{month:02d}"
        schedule_file = committed_dir / f"{filename_prefix}_schedule.csv"
        
        # Check if schedule exists
        if not schedule_file.exists():
            raise HTTPException(status_code=404, detail="Schedule not found")
        
        # Convert schedule to DataFrame
        schedule_df = pd.DataFrame(schedule)
        if 'date' in schedule_df.columns:
            # Handle both "YYYY-MM-DD" and "YYYY-MM-DDTHH:MM:SS" formats
            # Let pandas auto-detect the format - it handles both ISO8601 and simple date formats
            schedule_df['date'] = pd.to_datetime(schedule_df['date'], errors='coerce')
        
        # Save updated schedule data
        schedule_df.to_csv(schedule_file, index=False)
        
        # Update employee data if provided
        if employees is not None:
            employee_file = committed_dir / f"{filename_prefix}_employee.csv"
            employee_df = pd.DataFrame(employees)
            employee_df.to_csv(employee_file, index=False)
        
        return {
            "message": f"Schedule updated successfully for {year}-{month:02d}",
            "year": year,
            "month": month
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update schedule: {str(e)}")

