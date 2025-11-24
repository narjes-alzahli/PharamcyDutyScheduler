"""Helper functions to load roster data from database and CSV files."""

import pandas as pd
from pathlib import Path
from typing import Dict, Any
from datetime import date, timedelta
from sqlalchemy.orm import Session

from backend.models import User, LeaveRequest, ShiftRequest, LeaveType, RequestStatus


def load_roster_data_from_db(db: Session) -> Dict[str, pd.DataFrame]:
    """
    Load roster data from database and CSV files.
    Returns dict with 'employees', 'time_off', 'locks' DataFrames.
    """
    project_root = Path(__file__).parent.parent
    
    # Load employees from CSV (skills data is still in CSV)
    employees_csv = project_root / "roster" / "app" / "data" / "employees.csv"
    if employees_csv.exists():
        employees_df = pd.read_csv(employees_csv)
    else:
        # Create empty DataFrame with required columns
        employees_df = pd.DataFrame(columns=[
            'employee', 'skill_M', 'skill_IP', 'skill_A', 'skill_N', 
            'skill_M3', 'skill_M4', 'skill_H', 'skill_CL', 'clinic_only',
            'ip_ok', 'harat_ok', 'maxN', 'maxA', 'min_days_off', 'weight', 'pending_off'
        ])
    
    # Load time_off from database (approved leave requests)
    time_off_records = []
    approved_leaves = db.query(LeaveRequest).filter(
        LeaveRequest.status == RequestStatus.APPROVED
    ).all()
    
    for leave in approved_leaves:
        current_date = leave.from_date
        while current_date <= leave.to_date:
            time_off_records.append({
                'employee': leave.user.employee_name,
                'from_date': current_date,
                'to_date': current_date,
                'code': leave.leave_type.code
            })
            current_date += timedelta(days=1)
    
    time_off_df = pd.DataFrame(time_off_records)
    if time_off_df.empty:
        time_off_df = pd.DataFrame(columns=['employee', 'from_date', 'to_date', 'code'])
    else:
        # Ensure date columns are date type
        time_off_df['from_date'] = pd.to_datetime(time_off_df['from_date']).dt.date
        time_off_df['to_date'] = pd.to_datetime(time_off_df['to_date']).dt.date
    
    # Standard working shifts that should be treated as locks (force/forbid)
    # Non-standard shifts (like MS, C, etc.) will be treated as direct assignments (like leave)
    STANDARD_WORKING_SHIFTS = {"M", "IP", "A", "N", "M3", "M4", "H", "CL"}
    
    # Load locks from database (approved shift requests for standard working shifts)
    locks_records = []
    # Also collect non-standard shift requests to add as time_off (direct assignments)
    non_standard_shift_records = []
    
    approved_shifts = db.query(ShiftRequest).filter(
        ShiftRequest.status == RequestStatus.APPROVED
    ).all()
    
    for shift in approved_shifts:
        shift_code = shift.shift_type.code if shift.shift_type else 'UNKNOWN'
        
        # Non-standard shifts with force=True need special handling:
        # - Go to locks (for UI display in "Locks" tab)
        # - Also go to time_off (for solver as direct assignments)
        if shift_code not in STANDARD_WORKING_SHIFTS and shift.force:
            # Add to locks for UI display (appears in "Locks" tab)
            locks_records.append({
                'employee': shift.user.employee_name,
                'from_date': shift.from_date,
                'to_date': shift.to_date,
                'shift': shift_code,
                'force': shift.force
            })
            
            # Also add to time_off for solver (treated as direct assignment)
            current_date = shift.from_date
            while current_date <= shift.to_date:
                non_standard_shift_records.append({
                    'employee': shift.user.employee_name,
                    'from_date': current_date,
                    'to_date': current_date,
                    'code': shift_code
                })
                current_date += timedelta(days=1)
        else:
            # Standard shifts go to locks only (force/forbid constraints)
            locks_records.append({
                'employee': shift.user.employee_name,
                'from_date': shift.from_date,
                'to_date': shift.to_date,
                'shift': shift_code,
                'force': shift.force
            })
    
    # Add non-standard shift requests to time_off as direct assignments (for solver)
    if non_standard_shift_records:
        non_standard_df = pd.DataFrame(non_standard_shift_records)
        non_standard_df['from_date'] = pd.to_datetime(non_standard_df['from_date']).dt.date
        non_standard_df['to_date'] = pd.to_datetime(non_standard_df['to_date']).dt.date
        # Merge with existing time_off
        time_off_df = pd.concat([time_off_df, non_standard_df], ignore_index=True)
    
    locks_df = pd.DataFrame(locks_records)
    if locks_df.empty:
        locks_df = pd.DataFrame(columns=['employee', 'from_date', 'to_date', 'shift', 'force'])
    else:
        # Ensure date columns are date type
        locks_df['from_date'] = pd.to_datetime(locks_df['from_date']).dt.date
        locks_df['to_date'] = pd.to_datetime(locks_df['to_date']).dt.date
    
    return {
        'employees': employees_df,
        'time_off': time_off_df,
        'locks': locks_df
    }


def load_month_demands(year: int, month: int) -> pd.DataFrame:
    """Load demands for a specific month from CSV."""
    project_root = Path(__file__).parent.parent
    demands_dir = project_root / "roster" / "app" / "data" / "demands"
    
    # Try month-specific file first
    month_file = demands_dir / f"demands_{year}_{month:02d}.csv"
    if month_file.exists():
        df = pd.read_csv(month_file)
        if 'date' in df.columns:
            df['date'] = pd.to_datetime(df['date'], errors='coerce')
        return df
    
    # Fallback to general demands file
    general_file = project_root / "roster" / "app" / "data" / "demands.csv"
    if general_file.exists():
        df = pd.read_csv(general_file)
        if 'date' in df.columns:
            df['date'] = pd.to_datetime(df['date'], errors='coerce')
            # Filter for the requested month
            df = df[df['date'].dt.year == year]
            df = df[df['date'].dt.month == month]
        return df
    
    # Return empty DataFrame with required columns
    return pd.DataFrame(columns=['date', 'need_M', 'need_IP', 'need_A', 'need_N', 
                                  'need_M3', 'need_M4', 'need_H', 'need_CL', 'holiday'])


def save_month_demands(year: int, month: int, demands_df: pd.DataFrame):
    """Save demands for a specific month to CSV."""
    project_root = Path(__file__).parent.parent
    demands_dir = project_root / "roster" / "app" / "data" / "demands"
    demands_dir.mkdir(parents=True, exist_ok=True)
    
    month_file = demands_dir / f"demands_{year}_{month:02d}.csv"
    demands_df.to_csv(month_file, index=False)


def generate_month_demands(year: int, month: int, base_demand: Dict[str, int], 
                           weekend_demand: Dict[str, int]) -> pd.DataFrame:
    """Generate default demands for a month."""
    import calendar
    
    # Get all dates in the month
    num_days = calendar.monthrange(year, month)[1]
    dates = [date(year, month, day) for day in range(1, num_days + 1)]
    
    records = []
    for d in dates:
        weekday = d.weekday()  # 0 = Monday, 6 = Sunday
        is_weekend = weekday >= 5  # Saturday (5) or Sunday (6)
        
        demand = weekend_demand if is_weekend else base_demand
        
        record = {
            'date': d,
            'need_M': demand.get('M', 0),
            'need_IP': demand.get('IP', 0),
            'need_A': demand.get('A', 0),
            'need_N': demand.get('N', 0),
            'need_M3': demand.get('M3', 0),
            'need_M4': demand.get('M4', 0),
            'need_H': demand.get('H', 0),
            'need_CL': demand.get('CL', 0),
            'holiday': ''
        }
        records.append(record)
    
    return pd.DataFrame(records)

