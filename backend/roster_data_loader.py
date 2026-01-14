"""Helper functions to load roster data from database and CSV files."""

import pandas as pd
from pathlib import Path
from typing import Dict, Any, Tuple, Set
from datetime import date, timedelta
from sqlalchemy.orm import Session, joinedload

from backend.models import User, LeaveRequest, ShiftRequest, LeaveType, RequestStatus, EmployeeSkills, ShiftType
from backend.database import SessionLocal


def get_standard_working_shifts(db: Session = None) -> Set[str]:
    """
    Get standard working shift codes from database.
    
    Standard shifts are those that have dedicated columns in the Demand model.
    These are the shifts that are optimized by the solver and can be used in shift requests/locks.
    
    Args:
        db: Database session (optional, will create one if not provided)
    
    Returns:
        Set of standard shift codes (e.g., {"M", "IP", "A", "N", "M3", "M4", "H", "CL", "E"})
    """
    # Standard shifts are determined by having dedicated columns in Demand model
    # This is the source of truth - shifts that have need_* columns
    STANDARD_SHIFT_CODES = {"M", "IP", "A", "N", "M3", "M4", "H", "CL", "E"}
    
    # Use provided session or create a new one
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        # Get all active shift types from database
        all_shift_types = db.query(ShiftType).filter(ShiftType.is_active == True).all()
        
        # Filter to only include those that are in our standard list
        # This ensures we only return shifts that actually exist in the database
        standard_shifts = {st.code for st in all_shift_types if st.code in STANDARD_SHIFT_CODES}
        
        return standard_shifts
    finally:
        if close_db:
            db.close()


def load_roster_data_from_db(db: Session, expand_ranges: bool = False) -> Dict[str, pd.DataFrame]:
    """
    Load roster data from database and CSV files.
    Returns dict with 'employees', 'time_off', 'locks' DataFrames.
    
    Args:
        db: Database session
        expand_ranges: If True, expand date ranges into individual days (for solver).
                      If False, keep ranges as-is (for frontend UI).
    """
    # Load employees from database, ordered by ID to maintain consistent order
    employees = db.query(EmployeeSkills).order_by(EmployeeSkills.id).all()
    if employees:
        employees_data = [{
            'employee': emp.name,
            'skill_M': emp.skill_M,
            'skill_IP': emp.skill_IP,
            'skill_A': emp.skill_A,
            'skill_N': emp.skill_N,
            'skill_M3': emp.skill_M3,
            'skill_M4': emp.skill_M4,
            'skill_H': emp.skill_H,
            'skill_CL': emp.skill_CL,
            'skill_E': emp.skill_E,
            'clinic_only': emp.clinic_only,
            'maxN': emp.maxN,
            'maxA': emp.maxA,
            'min_days_off': emp.min_days_off,
            'weight': emp.weight,
            'pending_off': emp.pending_off
        } for emp in employees]
        employees_df = pd.DataFrame(employees_data)
    else:
        # Create empty DataFrame with required columns
        employees_df = pd.DataFrame(columns=[
            'employee', 'skill_M', 'skill_IP', 'skill_A', 'skill_N', 
            'skill_M3', 'skill_M4', 'skill_H', 'skill_CL', 'skill_E', 'clinic_only',
            'maxN', 'maxA', 'min_days_off', 'weight', 'pending_off'
        ])
    
    # Load time_off from database (approved leave requests)
    # Use joinedload to ensure relationships are loaded (prevents N+1 queries and missing data)
    time_off_records = []
    approved_leaves = db.query(LeaveRequest).filter(
        LeaveRequest.status == RequestStatus.APPROVED
    ).options(
        joinedload(LeaveRequest.user),
        joinedload(LeaveRequest.leave_type)
    ).all()
    
    for leave in approved_leaves:
        # Skip if user or leave_type is None (shouldn't happen, but be defensive)
        if not leave.user or not leave.leave_type:
            print(f"WARNING: LeaveRequest {leave.id} has missing user or leave_type, skipping")
            continue
        if not leave.from_date or not leave.to_date:
            print(f"WARNING: LeaveRequest {leave.id} has missing dates, skipping")
            continue
        
        if expand_ranges:
            # Expand range into individual days (for solver)
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
        else:
            # Keep as range (for frontend UI)
            time_off_records.append({
                'employee': leave.user.employee_name,
                'from_date': leave.from_date,
                'to_date': leave.to_date,
                'code': leave.leave_type.code,
                'request_id': f"LR_{leave.id}",  # Include request_id to identify employee-requested leaves
                'reason': leave.reason or ''  # Include reason to identify "Added via Roster Generator"
            })
    
    time_off_df = pd.DataFrame(time_off_records)
    if time_off_df.empty:
        time_off_df = pd.DataFrame(columns=['employee', 'from_date', 'to_date', 'code'])
    else:
        # Ensure date columns are date type
        time_off_df['from_date'] = pd.to_datetime(time_off_df['from_date']).dt.date
        time_off_df['to_date'] = pd.to_datetime(time_off_df['to_date']).dt.date
    
    # Standard working shifts that should be treated as locks (force/forbid)
    # Non-standard shifts (like MS, C, etc.) will be treated as direct assignments (like leave)
    STANDARD_WORKING_SHIFTS = get_standard_working_shifts(db)
    
    # Load locks from database (approved shift requests for standard working shifts)
    locks_records = []
    # Also collect non-standard shift requests to add as time_off (direct assignments)
    non_standard_shift_records = []
    
    # Track seen locks to prevent duplicates (use employee, dates, shift, force as key)
    seen_locks = set()
    
    approved_shifts = db.query(ShiftRequest).filter(
        ShiftRequest.status == RequestStatus.APPROVED
    ).options(
        joinedload(ShiftRequest.user),
        joinedload(ShiftRequest.shift_type)
    ).all()
    
    for shift in approved_shifts:
        # Skip if user or shift_type is None, or dates are missing
        if not shift.user or not shift.shift_type:
            print(f"WARNING: ShiftRequest {shift.id} has missing user or shift_type, skipping")
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
            # IMPORTANT: Include request_id so these can be edited/updated
            if expand_ranges:
                # Expand range into individual days (for solver)
                current_date = shift.from_date
                while current_date <= shift.to_date:
                    non_standard_shift_records.append({
                        'employee': shift.user.employee_name,
                        'from_date': current_date,
                        'to_date': current_date,
                        'code': shift_code,
                        'request_id': f"SR_{shift.id}",  # Include request_id to identify employee-requested shifts
                        'reason': shift.reason or ''  # Include reason to identify "Added via Roster Generator"
                    })
                    current_date += timedelta(days=1)
            else:
                # Keep as range (for frontend UI)
                non_standard_shift_records.append({
                    'employee': shift.user.employee_name,
                    'from_date': shift.from_date,
                    'to_date': shift.to_date,
                    'code': shift_code,
                    'request_id': f"SR_{shift.id}",  # Include request_id to identify employee-requested shifts
                    'reason': shift.reason or ''  # Include reason to identify "Added via Roster Generator"
                })
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


def load_month_demands(year: int, month: int, db: Session = None) -> pd.DataFrame:
    """Load demands for a specific month from database.
    
    Args:
        year: Year
        month: Month (1-12)
        db: Database session (optional, will create one if not provided)
    
    Returns:
        DataFrame with demands data
    """
    from backend.models import Demand
    from backend.database import SessionLocal
    
    # Use provided session or create a new one
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        # Load from database
        demands = db.query(Demand).filter(
            Demand.year == year,
            Demand.month == month
        ).all()
        
        if demands:
            demands_data = []
            for demand in demands:
                demand_dict = {
                    'date': demand.date,
                    'need_M': demand.need_M,
                    'need_IP': demand.need_IP,
                    'need_A': demand.need_A,
                    'need_N': demand.need_N,
                    'need_M3': demand.need_M3,
                    'need_M4': demand.need_M4,
                    'need_H': demand.need_H,
                    'need_CL': demand.need_CL,
                    'need_E': demand.need_E
                }
                demands_data.append(demand_dict)
            
            df = pd.DataFrame(demands_data)
            if 'date' in df.columns:
                df['date'] = pd.to_datetime(df['date'], errors='coerce')
            return df

        # Return empty DataFrame if no demands found
        # Demands must exist in database - solver will fail if empty
        return pd.DataFrame(columns=['date', 'need_M', 'need_IP', 'need_A', 'need_N',
                                      'need_M3', 'need_M4', 'need_H', 'need_CL', 'need_E'])
    finally:
        if close_db:
            db.close()


def save_month_demands(year: int, month: int, demands_df: pd.DataFrame, db: Session = None):
    """Save demands for a specific month to database (without holiday column).
    
    Holidays are stored separately - use save_month_holidays() for that.
    
    Args:
        year: Year
        month: Month (1-12)
        demands_df: DataFrame with demands data
        db: Database session (optional, will create one if not provided)
    """
    from backend.models import Demand
    from backend.database import SessionLocal
    
    # Use provided session or create a new one
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        # Remove holiday column if it exists - holidays are stored separately
        demands_df = demands_df.copy()
        if 'holiday' in demands_df.columns:
            demands_df = demands_df.drop(columns=['holiday'])
        
        # Ensure date column is properly formatted
        if 'date' in demands_df.columns:
            demands_df['date'] = pd.to_datetime(demands_df['date'], errors='coerce')
        
        # Delete existing demands for this month
        db.query(Demand).filter(
            Demand.year == year,
            Demand.month == month
        ).delete()
        
        # Standard shift types that have dedicated columns
        standard_shifts = get_standard_working_shifts(db)
        
        # Insert new demands
        for _, row in demands_df.iterrows():
            date_val = row['date']
            if pd.isna(date_val):
                continue
            
            if isinstance(date_val, pd.Timestamp):
                date_val = date_val.date()
            
            # Extract standard shift demands (only save standard shifts)
            standard_demands = {
                'need_M': int(row.get('need_M', 0)),
                'need_IP': int(row.get('need_IP', 0)),
                'need_A': int(row.get('need_A', 0)),
                'need_N': int(row.get('need_N', 0)),
                'need_M3': int(row.get('need_M3', 0)),
                'need_M4': int(row.get('need_M4', 0)),
                'need_H': int(row.get('need_H', 0)),
                'need_CL': int(row.get('need_CL', 0)),
                'need_E': int(row.get('need_E', 0))
            }
            
            # Only save standard shifts - non-standard shifts are not stored in demands
            demand = Demand(
                date=date_val,
                year=year,
                month=month,
                **standard_demands
            )
            db.add(demand)
        
        db.commit()
    finally:
        if close_db:
            db.close()


def save_month_holidays(year: int, month: int, holidays: Dict[str, str], db: Session = None):
    """Save holidays for a specific month to database.
    
    Args:
        year: Year
        month: Month (1-12)
        holidays: Dict mapping date strings (YYYY-MM-DD) to holiday names
        db: Database session (optional, will create one if not provided)
    """
    from backend.models import Holiday
    from backend.database import SessionLocal
    
    # Use provided session or create a new one
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        # Delete existing holidays for this month
        db.query(Holiday).filter(
            Holiday.year == year,
            Holiday.month == month
        ).delete()
        
        # Insert new holidays
        for date_str, holiday_name in holidays.items():
            if not holiday_name or not holiday_name.strip():
                continue
            try:
                date_obj = pd.to_datetime(date_str).date()
                if date_obj.year == year and date_obj.month == month:
                    holiday = Holiday(
                        date=date_obj,
                        year=year,
                        month=month,
                        name=holiday_name.strip()
                    )
                    db.add(holiday)
            except:
                continue
    
        db.commit()
    finally:
        if close_db:
            db.close()


def load_month_holidays(year: int, month: int, db: Session = None) -> Dict[str, str]:
    """Load holidays for a specific month from database.
    
    Returns:
        Dict mapping date strings (YYYY-MM-DD) to holiday names
    """
    from backend.models import Holiday
    from backend.database import SessionLocal
    
    # Use provided session or create a new one
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        holidays = db.query(Holiday).filter(
            Holiday.year == year,
            Holiday.month == month
        ).all()
        
        return {holiday.date.isoformat(): holiday.name for holiday in holidays}
    finally:
        if close_db:
            db.close()
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


def load_previous_month_last_days(year: int, month: int, db: Session = None) -> Dict[Tuple[str, date], str]:
    """Load the last 2 days of the immediately previous committed month.
    
    Args:
        year: Year of the month being generated
        month: Month being generated (1-12)
        db: Database session (optional, will create one if not provided)
    
    Returns:
        Dict mapping (employee_name, date) to shift code for the last 2 days of previous month.
        Returns empty dict if previous month doesn't exist or isn't committed.
    """
    from backend.models import CommittedSchedule
    from backend.database import SessionLocal
    import calendar
    
    # Use provided session or create a new one
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        # Calculate previous month
        if month == 1:
            prev_year = year - 1
            prev_month = 12
        else:
            prev_year = year
            prev_month = month - 1
        
        # Get last 2 days of previous month
        num_days_prev_month = calendar.monthrange(prev_year, prev_month)[1]
        last_day_prev_month = date(prev_year, prev_month, num_days_prev_month)
        second_last_day_prev_month = date(prev_year, prev_month, num_days_prev_month - 1)
        
        # Load committed schedules for these 2 days
        prev_schedules = db.query(CommittedSchedule).filter(
            CommittedSchedule.year == prev_year,
            CommittedSchedule.month == prev_month,
            CommittedSchedule.date.in_([second_last_day_prev_month, last_day_prev_month])
        ).all()
        
        # Build dict: (employee_name, date) -> shift
        result = {}
        for schedule in prev_schedules:
            result[(schedule.employee_name, schedule.date)] = schedule.shift
        
        return result
    finally:
        if close_db:
            db.close()


def get_holiday_demands() -> Dict[str, int]:
    """Get the standard demands for public holidays.
    
    Returns:
        Dict with holiday-specific demand values:
        - 1N, 1M, 1M3, 1A, 1IP, 2CL
    """
    return {
        'N': 1,
        'M': 1,
        'M3': 1,
        'A': 1,
        'IP': 1,
        'CL': 2,
        'M4': 0,
        'H': 0
    }


def generate_month_demands(year: int, month: int, base_demand: Dict[str, int], 
                           weekend_demand: Dict[str, int], 
                           holidays: Dict[date, str] = None) -> pd.DataFrame:
    """Generate default demands for a month.
    
    Special handling for H shifts: They are always assigned to Monday and Wednesday,
    with 2 shifts on each of those days. This is fixed and not configurable.
    
    Special handling for holidays: Public holidays use fixed demand values:
    1N, 1M, 1M3, 1A, 1IP, 2CL
    
    Args:
        year: Year
        month: Month (1-12)
        base_demand: Base demand for weekdays
        weekend_demand: Demand for weekends
        holidays: Optional dict mapping date objects to holiday names
    """
    import calendar
    
    if holidays is None:
        holidays = {}
    
    # Get all dates in the month
    num_days = calendar.monthrange(year, month)[1]
    dates = [date(year, month, day) for day in range(1, num_days + 1)]
    
    # Create a copy of base_demand WITHOUT H (we'll handle H separately - fixed to Mon/Wed)
    base_demand_no_h = {k: v for k, v in base_demand.items() if k != 'H'}
    # Explicitly ensure H is not in base_demand_no_h
    if 'H' in base_demand_no_h:
        del base_demand_no_h['H']
    
    # Get holiday demands
    holiday_demands = get_holiday_demands()
    
    records = []
    for d in dates:
        # Check if this date is a holiday
        is_holiday = d in holidays
        
        if is_holiday:
            # Use holiday-specific demands
            record = {
                'date': d,
                'need_M': holiday_demands.get('M', 0),
                'need_IP': holiday_demands.get('IP', 0),
                'need_A': holiday_demands.get('A', 0),
                'need_N': holiday_demands.get('N', 0),
                'need_M3': holiday_demands.get('M3', 0),
                'need_M4': holiday_demands.get('M4', 0),
                'need_H': holiday_demands.get('H', 0),
                'need_CL': holiday_demands.get('CL', 0)
            }
        else:
            # Normal logic for non-holidays
            weekday = d.weekday()  # 0 = Monday, 6 = Sunday
            # In Oman: Weekdays = Sunday(6), Monday(0), Tuesday(1), Wednesday(2), Thursday(3)
            # Weekends = Friday(4), Saturday(5)
            is_weekend = weekday in [4, 5]  # Friday (4) or Saturday (5)
            
            demand = weekend_demand if is_weekend else base_demand_no_h
            
            # H shifts are always 1 on Monday (weekday 0) and Wednesday (weekday 2), 0 otherwise
            if weekday == 0:  # Monday
                h_count = 1
            elif weekday == 2:  # Wednesday
                h_count = 1
            else:
                h_count = 0
            
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
            }
        
        records.append(record)
    
    return pd.DataFrame(records)

