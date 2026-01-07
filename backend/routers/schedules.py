"""Schedule viewing and management endpoints."""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer
from pathlib import Path
import pandas as pd
import json
from typing import List, Optional
from sqlalchemy.orm import Session
from datetime import date as date_type
import sys

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.routers.auth import get_current_user
from backend.database import get_db
from backend.models import CommittedSchedule, ScheduleMetrics

router = APIRouter()
security = HTTPBearer()


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
        metrics = metrics_record.metrics if metrics_record else None
        
        schedules.append({
            'year': year,
            'month': month,
            'schedule_df': schedule_df,
            'employee_df': None,  # Employee data not stored separately in DB
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
        
        # Update metrics if provided
        if 'metrics' in schedule_data:
            existing_metrics = db.query(ScheduleMetrics).filter(
                ScheduleMetrics.year == year,
                ScheduleMetrics.month == month
            ).first()
            
            if existing_metrics:
                existing_metrics.metrics = schedule_data['metrics']
            else:
                metrics_entry = ScheduleMetrics(
                    year=year,
                    month=month,
                    metrics=schedule_data['metrics']
                )
                db.add(metrics_entry)
        
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

