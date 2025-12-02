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
        # Skip if user or leave_type is None (shouldn't happen, but be defensive)
        if not leave.user or not leave.leave_type:
            continue
        if not leave.from_date or not leave.to_date:
            continue
            
        current_date = leave.from_date
        while current_date <= leave.to_date:
            time_off_records.append({
                'employee': leave.user.employee_name,
                'from_date': current_date,
                'to_date': current_date,
                'code': leave.leave_type.code,
                'request_id': f"LR_{leave.id}",  # Include request_id to identify employee-requested leaves
                'reason': leave.reason or ''  # Include reason to identify "Added via Roster Generator"
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
    
    # Track seen locks to prevent duplicates (use employee, dates, shift, force as key)
    seen_locks = set()
    
    approved_shifts = db.query(ShiftRequest).filter(
        ShiftRequest.status == RequestStatus.APPROVED
    ).all()
    
    for shift in approved_shifts:
        # Skip if user or shift_type is None, or dates are missing
        if not shift.user or not shift.shift_type:
            continue
        if not shift.from_date or not shift.to_date:
            continue
            
        shift_code = shift.shift_type.code
        
        # Create a unique key to detect duplicates
        lock_key = (shift.user.employee_name, shift.from_date, shift.to_date, shift_code, shift.force)
        
        # Skip if we've already seen this exact lock (deduplicate)
        if lock_key in seen_locks:
            continue
        seen_locks.add(lock_key)
        
        # Non-standard shifts with force=True need special handling:
        # - Go to locks (for UI display in "Locks" tab)
        # - Also go to time_off (for solver as direct assignments)
        if shift_code not in STANDARD_WORKING_SHIFTS and shift.force:
            # Add to locks for UI display (appears in "Locks" tab)
            # Use the first (lowest ID) request_id for this duplicate group
            locks_records.append({
                'employee': shift.user.employee_name,
                'from_date': shift.from_date,
                'to_date': shift.to_date,
                'shift': shift_code,
                'force': shift.force,
                'request_id': f"SR_{shift.id}",  # Include request_id to identify employee-requested shifts
                'reason': shift.reason  # Include reason to identify "Added via Roster Generator"
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
                'force': shift.force,
                'request_id': f"SR_{shift.id}",  # Include request_id to identify employee-requested shifts
                'reason': shift.reason  # Include reason to identify "Added via Roster Generator"
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
    """Load demands for a specific month from CSV.
    
    Note: Holiday column is optional. If it exists in the file, it will be preserved.
    If it doesn't exist, it won't be added (unlike before). This allows the solver
    to work without holiday column interference.
    """
    project_root = Path(__file__).parent.parent
    demands_dir = project_root / "roster" / "app" / "data" / "demands"
    
    # Try month-specific file first
    month_file = demands_dir / f"demands_{year}_{month:02d}.csv"
    if month_file.exists():
        # Read CSV with keep_default_na=False for holiday column to preserve empty strings
        df = pd.read_csv(month_file, keep_default_na=False, na_values=[])
        if 'date' in df.columns:
            df['date'] = pd.to_datetime(df['date'], errors='coerce')
        # Only process holiday column if it exists in the file (don't add it if missing)
        if 'holiday' in df.columns:
            df['holiday'] = df['holiday'].fillna('').astype(str).replace(['nan', 'None', 'NaN'], '')
        # If holiday column doesn't exist, that's fine - don't add it
        return df
    
    # Fallback to general demands file
    general_file = project_root / "roster" / "app" / "data" / "demands.csv"
    if general_file.exists():
        df = pd.read_csv(general_file, keep_default_na=False, na_values=[])
        if 'date' in df.columns:
            df['date'] = pd.to_datetime(df['date'], errors='coerce')
            # Filter for the requested month
            df = df[df['date'].dt.year == year]
            df = df[df['date'].dt.month == month]
        # Only process holiday column if it exists in the file (don't add it if missing)
        if 'holiday' in df.columns:
            df['holiday'] = df['holiday'].fillna('').astype(str).replace(['nan', 'None', 'NaN'], '')
        # If holiday column doesn't exist, that's fine - don't add it
        return df
    
    # Return empty DataFrame with required columns (no holiday column)
    return pd.DataFrame(columns=['date', 'need_M', 'need_IP', 'need_A', 'need_N', 
                                  'need_M3', 'need_M4', 'need_H', 'need_CL'])


def save_month_demands(year: int, month: int, demands_df: pd.DataFrame):
    """Save demands for a specific month to CSV (without holiday column).
    
    Holidays are stored separately - use save_month_holidays() for that.
    """
    project_root = Path(__file__).parent.parent
    demands_dir = project_root / "roster" / "app" / "data" / "demands"
    demands_dir.mkdir(parents=True, exist_ok=True)
    
    # Remove holiday column if it exists - holidays are stored separately
    demands_df = demands_df.copy()
    if 'holiday' in demands_df.columns:
        demands_df = demands_df.drop(columns=['holiday'])
    
    month_file = demands_dir / f"demands_{year}_{month:02d}.csv"
    
    # Ensure dates are formatted as YYYY-MM-DD strings before saving
    if 'date' in demands_df.columns:
        # Convert date objects to YYYY-MM-DD strings for consistent CSV format
        demands_df['date'] = pd.to_datetime(demands_df['date'], errors='coerce').dt.strftime('%Y-%m-%d')
    
    # Save without holiday column
    demands_df.to_csv(month_file, index=False, na_rep='')


def save_month_holidays(year: int, month: int, holidays: Dict[str, str]):
    """Save holidays for a specific month to a separate CSV file.
    
    Args:
        year: Year
        month: Month (1-12)
        holidays: Dict mapping date strings (YYYY-MM-DD) to holiday names
    """
    project_root = Path(__file__).parent.parent
    holidays_dir = project_root / "roster" / "app" / "data" / "holidays"
    holidays_dir.mkdir(parents=True, exist_ok=True)
    
    # Filter holidays for the specified month
    month_holidays = {}
    for date_str, holiday_name in holidays.items():
        try:
            date_obj = pd.to_datetime(date_str).date()
            if date_obj.year == year and date_obj.month == month:
                month_holidays[date_str] = holiday_name.strip()
        except:
            continue
    
    # Create DataFrame
    if month_holidays:
        holidays_df = pd.DataFrame([
            {'date': date_str, 'holiday': holiday_name}
            for date_str, holiday_name in month_holidays.items()
            if holiday_name  # Only save non-empty holidays
        ])
        if not holidays_df.empty:
            holidays_df.to_csv(holidays_dir / f"holidays_{year}_{month:02d}.csv", index=False)
        else:
            # Remove file if no holidays
            holiday_file = holidays_dir / f"holidays_{year}_{month:02d}.csv"
            if holiday_file.exists():
                holiday_file.unlink()
    else:
        # Remove file if no holidays
        holiday_file = holidays_dir / f"holidays_{year}_{month:02d}.csv"
        if holiday_file.exists():
            holiday_file.unlink()


def load_month_holidays(year: int, month: int) -> Dict[str, str]:
    """Load holidays for a specific month from CSV.
    
    Returns:
        Dict mapping date strings (YYYY-MM-DD) to holiday names
    """
    project_root = Path(__file__).parent.parent
    holidays_dir = project_root / "roster" / "app" / "data" / "holidays"
    
    holiday_file = holidays_dir / f"holidays_{year}_{month:02d}.csv"
    if holiday_file.exists():
        df = pd.read_csv(holiday_file, keep_default_na=False, na_values=[])
        holidays = {}
        for _, row in df.iterrows():
            date_str = str(row['date']).strip()
            holiday_name = str(row['holiday']).strip()
            if date_str and holiday_name:
                holidays[date_str] = holiday_name
        return holidays
    
    return {}


def generate_month_demands(year: int, month: int, base_demand: Dict[str, int], 
                           weekend_demand: Dict[str, int]) -> pd.DataFrame:
    """Generate default demands for a month.
    
    Special handling for H shifts: They are distributed randomly across weekdays only,
    not applied to every weekday. The base_demand['H'] value represents the number
    of H shifts per week to distribute randomly.
    """
    import calendar
    import random
    
    # Get all dates in the month
    num_days = calendar.monthrange(year, month)[1]
    dates = [date(year, month, day) for day in range(1, num_days + 1)]
    
    # Extract H shifts per week from base_demand (default to 3)
    # IMPORTANT: H shifts are distributed randomly across weekdays, NOT applied to every weekday
    h_shifts_per_week = base_demand.get('H', 3)
    
    # Create a copy of base_demand WITHOUT H (we'll handle H separately via random distribution)
    base_demand_no_h = {k: v for k, v in base_demand.items() if k != 'H'}
    # Explicitly ensure H is not in base_demand_no_h
    if 'H' in base_demand_no_h:
        del base_demand_no_h['H']
    
    # Get all weekdays for Oman (Sunday=6, Monday=0, Tuesday=1, Wednesday=2, Thursday=3)
    # Weekends are Friday=4, Saturday=5
    oman_weekdays = [d for d in dates if d.weekday() in [6, 0, 1, 2, 3]]
    
    # Group weekdays by week (using year-week as key to handle month boundaries)
    weeks = {}
    for d in oman_weekdays:
        iso_year, iso_week, _ = d.isocalendar()
        week_key = (iso_year, iso_week)
        if week_key not in weeks:
            weeks[week_key] = []
        weeks[week_key].append(d)
    
    # Randomly distribute H shifts across weekdays, h_shifts_per_week per week
    # Each selected weekday gets exactly 1 H shift (not h_shifts_per_week)
    h_assignments = {}  # date -> count (should be 0 or 1)
    for week_key, week_days in weeks.items():
        # Only assign if there are enough weekdays in the week
        num_to_assign = min(h_shifts_per_week, len(week_days))
        if num_to_assign > 0:
            # Randomly select num_to_assign days from this week's weekdays
            # Each selected day gets 1 H shift
            selected_days = random.sample(week_days, num_to_assign)
            for day in selected_days:
                h_assignments[day] = 1  # Each day gets exactly 1 H shift
    
    records = []
    for d in dates:
        weekday = d.weekday()  # 0 = Monday, 6 = Sunday
        # In Oman: Weekdays = Sunday(6), Monday(0), Tuesday(1), Wednesday(2), Thursday(3)
        # Weekends = Friday(4), Saturday(5)
        is_weekend = weekday in [4, 5]  # Friday (4) or Saturday (5)
        
        demand = weekend_demand if is_weekend else base_demand_no_h
        
        # For H shifts, use the random assignment if it's a weekday, otherwise 0
        h_count = h_assignments.get(d, 0) if not is_weekend else 0
        
        record = {
            'date': d,
            'need_M': demand.get('M', 0),
            'need_IP': demand.get('IP', 0),
            'need_A': demand.get('A', 0),
            'need_N': demand.get('N', 0),
            'need_M3': demand.get('M3', 0),
            'need_M4': demand.get('M4', 0),
            'need_H': h_count,
            'need_CL': demand.get('CL', 0)
            # Note: holiday column removed - not needed for solver, handled separately for pending_off
        }
        records.append(record)
    
    return pd.DataFrame(records)

