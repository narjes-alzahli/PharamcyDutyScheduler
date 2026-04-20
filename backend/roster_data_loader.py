"""Helper functions to load roster data from database and CSV files."""

import pandas as pd
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple
from datetime import date, timedelta
from sqlalchemy.orm import Session, joinedload

from backend.models import User, LeaveRequest, ShiftRequest, LeaveType, RequestStatus, EmployeeSkills, ShiftType
from backend.database import SessionLocal
from backend.user_employee_sync import roster_display_name, committed_schedule_display_name
from backend.ramadan_periods import get_ramadan_period_windows


def get_standard_working_shifts(db: Session = None) -> Set[str]:
    """
    Get standard working shift codes from database.
    
    Standard shifts are those that have dedicated columns in the Demand model.
    These are the shifts that are optimized by the solver and can be used in shift requests/locks.
    
    Args:
        db: Database session (optional, will create one if not provided)
    
    Returns:
        Set of standard shift codes (e.g., {"M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "MS"})
    """
    # Standard shifts are determined by having dedicated columns in Demand model
    # This is the source of truth - shifts that have need_* columns
    STANDARD_SHIFT_CODES = {"M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "MS", "IP+P", "P", "M+P"}
    
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
    employees = (
        db.query(EmployeeSkills)
        .options(joinedload(EmployeeSkills.user))
        .order_by(EmployeeSkills.id)
        .all()
    )
    if employees:
        employees_data = [{
            'employee': roster_display_name(emp),
            'user_id': emp.user_id,
            'staff_no': (emp.user.staff_no if getattr(emp, "user", None) is not None else None) or '',
            'skill_M': emp.skill_M,
            'skill_IP': emp.skill_IP,
            'skill_A': emp.skill_A,
            'skill_N': emp.skill_N,
            'skill_M3': emp.skill_M3,
            'skill_M4': emp.skill_M4,
            'skill_H': emp.skill_H,
            'skill_CL': emp.skill_CL,
            'skill_E': emp.skill_E,
            'skill_MS': emp.skill_MS,
            'skill_IP_P': emp.skill_IP_P,
            'skill_P': emp.skill_P,
            'skill_M_P': emp.skill_M_P,
            'min_days_off': emp.min_days_off,
            'weight': emp.weight,
            'pending_off': emp.pending_off
        } for emp in employees]
        employees_df = pd.DataFrame(employees_data)
    else:
        # Create empty DataFrame with required columns
        employees_df = pd.DataFrame(columns=[
            'employee', 'user_id', 'staff_no', 'skill_M', 'skill_IP', 'skill_A', 'skill_N',
            'skill_M3', 'skill_M4', 'skill_H', 'skill_CL', 'skill_E', 'skill_MS',
            'skill_IP_P', 'skill_P', 'skill_M_P',
            'min_days_off', 'weight', 'pending_off'
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
    # AS requests are preference-only input for solver objective (not locks/time_off)
    as_preferences = []
    
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
        
        # AS is a special shift request that only affects solver preferences.
        if shift_code == "AS" and shift.force:
            as_preferences.append({
                "employee": shift.user.employee_name,
                "from_date": shift.from_date,
                "to_date": shift.to_date,
            })
            # Keep AS visible in Requests UI as an approved shift request row.
            # Solver ignores AS from locks and uses `as_preferences` only.
            locks_records.append({
                'employee': shift.user.employee_name,
                'from_date': shift.from_date,
                'to_date': shift.to_date,
                'shift': shift_code,
                'force': shift.force,
                'request_id': f"SR_{shift.id}",
                'reason': shift.reason
            })
            continue

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
        'locks': locks_df,
        'as_preferences': as_preferences
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
                    'need_E': demand.need_E,
                    'need_MS': demand.need_MS,
                    'need_IP_P': demand.need_IP_P,
                    'need_P': demand.need_P,
                    'need_M_P': demand.need_M_P
                }
                demands_data.append(demand_dict)
            
            df = pd.DataFrame(demands_data)
            if 'date' in df.columns:
                df['date'] = pd.to_datetime(df['date'], errors='coerce')
            return df

        # Return empty DataFrame if no demands found
        # Demands must exist in database - solver will fail if empty
        return pd.DataFrame(columns=['date', 'need_M', 'need_IP', 'need_A', 'need_N',
                                      'need_M3', 'need_M4', 'need_H', 'need_CL', 'need_E', 'need_MS',
                                      'need_IP_P', 'need_P', 'need_M_P'])
    finally:
        if close_db:
            db.close()


def load_demands_by_date_range(start_date: date, end_date: date, db: Session = None) -> pd.DataFrame:
    """Load demands for a specific date range from database.
    
    Args:
        start_date: Start date (inclusive)
        end_date: End date (inclusive)
        db: Database session (optional, will create one if not provided)
    
    Returns:
        DataFrame with demands data filtered to the date range
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
        # Load from database filtered by date range
        demands = db.query(Demand).filter(
            Demand.date >= start_date,
            Demand.date <= end_date
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
                    'need_E': demand.need_E,
                    'need_MS': demand.need_MS,
                    'need_IP_P': demand.need_IP_P,
                    'need_P': demand.need_P,
                    'need_M_P': demand.need_M_P
                }
                demands_data.append(demand_dict)
            
            df = pd.DataFrame(demands_data)
            if 'date' in df.columns:
                df['date'] = pd.to_datetime(df['date'], errors='coerce')
            return df

        # Return empty DataFrame if no demands found
        return pd.DataFrame(columns=['date', 'need_M', 'need_IP', 'need_A', 'need_N',
                                      'need_M3', 'need_M4', 'need_H', 'need_CL', 'need_E', 'need_MS',
                                      'need_IP_P', 'need_P', 'need_M_P'])
    finally:
        if close_db:
            db.close()


_DEMAND_NEED_COLS = (
    "need_M",
    "need_IP",
    "need_A",
    "need_N",
    "need_M3",
    "need_M4",
    "need_H",
    "need_CL",
    "need_E",
    "need_MS",
    "need_IP_P",
    "need_P",
    "need_M_P",
)


def ensure_demands_cover_date_range(
    demands_df: pd.DataFrame,
    start_date: date,
    end_date: date,
) -> pd.DataFrame:
    """One demand row per calendar day in [start_date, end_date]; missing days get zero needs.

    Cross-month Ramadan (and similar windows) must still optimize every day even when
    staffing-needs rows exist only for the first calendar month in the DB.
    """
    if start_date > end_date:
        return demands_df

    days: List[date] = []
    cur = start_date
    while cur <= end_date:
        days.append(cur)
        cur += timedelta(days=1)

    df = demands_df.copy() if demands_df is not None else pd.DataFrame()
    if not df.empty and "date" in df.columns:
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.date
        df = df.dropna(subset=["date"])
    else:
        df = pd.DataFrame(columns=["date", *_DEMAND_NEED_COLS])

    by_date: Dict[date, Dict[str, Any]] = {}
    for _, row in df.iterrows():
        d = row.get("date")
        if d is None or pd.isna(d):
            continue
        if not isinstance(d, date):
            continue
        rec = {c: row.get(c, 0) for c in _DEMAND_NEED_COLS}
        for c in _DEMAND_NEED_COLS:
            v = rec[c]
            try:
                rec[c] = int(v) if v is not None and not (isinstance(v, float) and pd.isna(v)) else 0
            except (TypeError, ValueError):
                rec[c] = 0
        by_date[d] = rec

    rows: List[Dict[str, Any]] = []
    for d in days:
        base = by_date.get(d, {c: 0 for c in _DEMAND_NEED_COLS})
        rows.append({"date": d, **base})

    return pd.DataFrame(rows)


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
                'need_E': int(row.get('need_E', 0)),
                'need_MS': int(row.get('need_MS', 0)),
                'need_IP_P': int(row.get('need_IP_P', 0)),
                'need_P': int(row.get('need_P', 0)),
                'need_M_P': int(row.get('need_M_P', 0))
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


def load_holidays_by_date_range(start_date: date, end_date: date, db: Session = None) -> Dict[str, str]:
    """Load holidays for a specific date range from database.
    
    Args:
        start_date: Start date (inclusive)
        end_date: End date (inclusive)
        db: Database session (optional, will create one if not provided)
    
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
            Holiday.date >= start_date,
            Holiday.date <= end_date
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


# [HISTORY_AWARE_FAIRNESS] START - History extraction function
def load_assignment_history(
    year: int,
    month: int,
    employees: List[str],
    skills: Dict[str, Dict[str, bool]],
    db: Session = None,
    method: str = "previous_period",
    window_months: int = 3,
    alpha: float = 0.7,
    period_start_date: date = None,
) -> Dict[str, Dict[str, int]]:
    """Load assignment history from committed schedules for fairness calculations.
    
    [HISTORY_AWARE_FAIRNESS] This function extracts past assignments from CommittedSchedule
    table and computes history counts per category per employee for fairness calculations.
    
    Args:
        year: Year of the month being generated
        month: Month being generated (1-12)
        employees: List of employee names
        skills: Dict mapping employee name to their skills dict
        db: Database session (optional)
        method: "previous_period", "rolling_window" or "decayed_carryover"
        window_months: Number of months to look back for rolling window (default: 3)
        alpha: Decay factor for carryover method (default: 0.7, range: 0.6-0.8)
    
    Returns:
        Dict mapping category name to dict mapping employee name to history count.
        Categories: "nights", "afternoons", "m4", "thursdays", "weekends"
        
    Notes:
        - Current default is "previous_period" to support anti-carryover balancing
          (if someone had more last period, they should tend to get less this period).
        - Legacy behavior is preserved for rollback via:
            * "rolling_window" (multi-month sum)
            * "decayed_carryover" (multi-month decay)
          See branch below marked "LEGACY HISTORY METHODS".
    """
    from backend.models import CommittedSchedule
    from backend.database import SessionLocal
    import calendar
    from datetime import date, timedelta

    standard_shifts = ["M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "MS", "IP+P", "P", "M+P"]

    def _period_start_for_date(dt: date) -> date:
        """Map a date to the schedule period start (supports dynamic Ramadan windows)."""
        windows = get_ramadan_period_windows(dt.year, db)
        if not windows:
            return date(dt.year, dt.month, 1)
        for _, (start_d, end_d) in windows.items():
            if start_d <= dt <= end_d:
                return start_d
        return date(dt.year, dt.month, 1)

    def _next_period_start(period_start: date) -> date:
        windows = get_ramadan_period_windows(period_start.year, db)
        if not windows:
            if period_start.month == 12:
                return date(period_start.year + 1, 1, 1)
            return date(period_start.year, period_start.month + 1, 1)
        ordered_starts = sorted(start for start, _ in windows.values())
        for idx, start_d in enumerate(ordered_starts):
            if period_start == start_d and idx + 1 < len(ordered_starts):
                return ordered_starts[idx + 1]
            if idx == len(ordered_starts) - 1 and period_start == start_d:
                _, end_d = windows["post-ramadan"]
                return end_d + timedelta(days=1)
        if period_start.month == 12:
            return date(period_start.year + 1, 1, 1)
        return date(period_start.year, period_start.month + 1, 1)
    
    def _previous_period_start(period_start: date) -> date:
        """Return start date of previous scheduling period."""
        windows = get_ramadan_period_windows(period_start.year, db)
        if windows:
            ordered_starts = sorted(start for start, _ in windows.values())
            for idx, start_d in enumerate(ordered_starts):
                if period_start == start_d and idx > 0:
                    return ordered_starts[idx - 1]
        if period_start.month == 1:
            return date(period_start.year - 1, 12, 1)
        return date(period_start.year, period_start.month - 1, 1)

    def _is_single_skill(emp: str) -> bool:
        emp_skills = skills.get(emp, {})
        qualified_shifts = [shift for shift in standard_shifts if emp_skills.get(shift, False)]
        return len(qualified_shifts) == 1
    
    # Use provided session or create a new one
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        # Calculate date range for history extraction
        first_day_current_month = date(year, month, 1)
        current_period_start = _period_start_for_date(period_start_date or first_day_current_month)
        history_end_date = current_period_start

        if method == "previous_period":
            start_date = _previous_period_start(current_period_start)
        # LEGACY HISTORY METHODS (kept for rollback/testing)
        elif method == "rolling_window":
            start_date = first_day_current_month
            for _ in range(window_months):
                if start_date.month == 1:
                    start_date = date(start_date.year - 1, 12, 1)
                else:
                    start_date = date(start_date.year, start_date.month - 1, 1)
            history_end_date = first_day_current_month
        else:  # decayed_carryover
            start_date = first_day_current_month
            for _ in range(6):
                if start_date.month == 1:
                    start_date = date(start_date.year - 1, 12, 1)
                else:
                    start_date = date(start_date.year, start_date.month - 1, 1)
            history_end_date = first_day_current_month
        
        # Load all committed schedules in the history window
        schedules = (
            db.query(CommittedSchedule)
            .options(joinedload(CommittedSchedule.user))
            .filter(
                CommittedSchedule.date >= start_date,
                CommittedSchedule.date < history_end_date,
            )
            .all()
        )
        
        # Initialize history counts per category per employee
        history = {
            "nights": {emp: 0 for emp in employees},
            "afternoons": {emp: 0 for emp in employees},
            "m4": {emp: 0 for emp in employees},
            "e": {emp: 0 for emp in employees},
            "thursdays": {emp: 0 for emp in employees},
            "weekends": {emp: 0 for emp in employees},
            "M+P": {emp: 0 for emp in employees},
            "P": {emp: 0 for emp in employees},
        }
        
        # Count assignments per category
        for schedule in schedules:
            emp = committed_schedule_display_name(schedule)
            if emp not in employees:
                continue
            
            emp_skills = skills.get(emp, {})
            schedule_date = schedule.date
            shift = schedule.shift
            
            # Night shifts - only for employees with skill_N
            if shift == "N" and emp_skills.get("N", False):
                history["nights"][emp] += 1
            
            # Afternoon shifts - only for employees with skill_A
            if shift == "A" and emp_skills.get("A", False):
                history["afternoons"][emp] += 1
            
            # M4 shifts - only for employees with skill_M4
            if shift == "M4" and emp_skills.get("M4", False):
                history["m4"][emp] += 1
            
            # E shifts - for fairness when E is assigned
            if shift == "E" and emp_skills.get("E", False):
                history["e"][emp] += 1
            
            # M+P and P - for rotation (prefer who hasn't done recently)
            if shift == "M+P" and emp_skills.get("M+P", False):
                history["M+P"][emp] += 1
            if shift == "P" and emp_skills.get("P", False):
                history["P"][emp] += 1
            
            # Thursday shifts (excluding M, M3 and IP) - only for multi-skill employees
            if schedule_date.weekday() == 3:  # Thursday
                qualified_shifts = [
                    s for s in ["M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "MS", "IP+P", "P", "M+P"]
                    if emp_skills.get(s, False)
                ]
                is_multi_skill = len(qualified_shifts) > 1
                if is_multi_skill and shift not in ["M", "M3", "IP"]:
                    history["thursdays"][emp] += 1
            
            # Weekend shifts (Friday=4, Saturday=5) - only for multi-skill employees
            if schedule_date.weekday() in [4, 5]:  # Friday or Saturday
                qualified_shifts = [
                    s for s in ["M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "MS", "IP+P", "P", "M+P"]
                    if emp_skills.get(s, False)
                ]
                is_multi_skill = len(qualified_shifts) > 1
                if is_multi_skill:
                    history["weekends"][emp] += 1
        
        # Apply decayed carryover if method is "decayed_carryover"
        if method == "decayed_carryover":
            # Group schedules by month and compute decayed values
            monthly_counts = {}
            for schedule in schedules:
                emp = committed_schedule_display_name(schedule)
                if emp not in employees:
                    continue
                
                schedule_date = schedule.date
                month_key = (schedule_date.year, schedule_date.month)
                
                if month_key not in monthly_counts:
                    monthly_counts[month_key] = {
                        "nights": {e: 0 for e in employees},
                        "afternoons": {e: 0 for e in employees},
                        "m4": {e: 0 for e in employees},
                        "e": {e: 0 for e in employees},
                        "thursdays": {e: 0 for e in employees},
                        "weekends": {e: 0 for e in employees},
                        "M+P": {e: 0 for e in employees},
                        "P": {e: 0 for e in employees},
                    }
                
                emp_skills = skills.get(emp, {})
                shift = schedule.shift
                
                # Count by category
                if shift == "N" and emp_skills.get("N", False):
                    monthly_counts[month_key]["nights"][emp] += 1
                if shift == "A" and emp_skills.get("A", False):
                    monthly_counts[month_key]["afternoons"][emp] += 1
                if shift == "M4" and emp_skills.get("M4", False):
                    monthly_counts[month_key]["m4"][emp] += 1
                if shift == "E" and emp_skills.get("E", False):
                    monthly_counts[month_key]["e"][emp] += 1
                if shift == "M+P" and emp_skills.get("M+P", False):
                    monthly_counts[month_key]["M+P"][emp] += 1
                if shift == "P" and emp_skills.get("P", False):
                    monthly_counts[month_key]["P"][emp] += 1
                # Thursday shifts (excluding M, M3 and IP) - only for multi-skill employees
                if schedule_date.weekday() == 3:  # Thursday
                    qualified_shifts = [
                        s for s in ["M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "MS", "IP+P", "P", "M+P"]
                        if emp_skills.get(s, False)
                    ]
                    is_multi_skill = len(qualified_shifts) > 1
                    if is_multi_skill and shift not in ["M", "M3", "IP"]:
                        monthly_counts[month_key]["thursdays"][emp] += 1
                # Weekend shifts (Friday=4, Saturday=5) - only for multi-skill employees
                if schedule_date.weekday() in [4, 5]:  # Weekend
                    qualified_shifts = [
                        s for s in ["M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "MS", "IP+P", "P", "M+P"]
                        if emp_skills.get(s, False)
                    ]
                    is_multi_skill = len(qualified_shifts) > 1
                    if is_multi_skill:
                        monthly_counts[month_key]["weekends"][emp] += 1
            
            # Compute decayed carryover: history = round(alpha * previous_history + last_month_count)
            # Sort months chronologically
            sorted_months = sorted(monthly_counts.keys())
            
            # Initialize decayed history
            decayed_history = {
                "nights": {emp: 0.0 for emp in employees},
                "afternoons": {emp: 0.0 for emp in employees},
                "m4": {emp: 0.0 for emp in employees},
                "e": {emp: 0.0 for emp in employees},
                "thursdays": {emp: 0.0 for emp in employees},
                "weekends": {emp: 0.0 for emp in employees},
                "M+P": {emp: 0.0 for emp in employees},
                "P": {emp: 0.0 for emp in employees},
            }
            
            # Apply decay recursively from oldest to newest month
            categories = ["nights", "afternoons", "m4", "e", "thursdays", "weekends", "M+P", "P"]
            for month_key in sorted_months:
                for category in categories:
                    for emp in employees:
                        last_month_count = monthly_counts[month_key][category][emp]
                        decayed_history[category][emp] = alpha * decayed_history[category][emp] + last_month_count
            
            # Round final values
            for category in categories:
                for emp in employees:
                    history[category][emp] = round(decayed_history[category][emp])
        
        # Bootstrap fairness for new employees: first two schedule periods inherit peer averages
        # from other multi-skill employees to avoid "zero-history" bias.
        start_dates_by_employee: Dict[str, date] = {}
        users_with_start = (
            db.query(User)
            .filter(User.start_date.isnot(None))
            .all()
        )
        for usr in users_with_start:
            if usr.employee_name:
                start_dates_by_employee[usr.employee_name.strip().lower()] = usr.start_date

        non_single_skill_employees = [emp for emp in employees if not _is_single_skill(emp)]
        skill_required_by_category = {
            "nights": "N",
            "afternoons": "A",
            "m4": "M4",
            "e": "E",
            "M+P": "M+P",
            "P": "P",
            "thursdays": None,
            "weekends": None,
        }

        for emp in employees:
            emp_start_date = start_dates_by_employee.get(emp.strip().lower())
            if not emp_start_date:
                continue
            first_period = _period_start_for_date(emp_start_date)
            second_period = _next_period_start(first_period)
            if current_period_start not in (first_period, second_period):
                continue

            for category, required_skill in skill_required_by_category.items():
                peers = []
                for peer in non_single_skill_employees:
                    if peer == emp:
                        continue
                    if required_skill and not skills.get(peer, {}).get(required_skill, False):
                        continue
                    peers.append(peer)
                if not peers:
                    continue
                avg_history = round(sum(history[category][peer] for peer in peers) / len(peers))
                history[category][emp] = avg_history

        return history
    finally:
        if close_db:
            db.close()
# [HISTORY_AWARE_FAIRNESS] END - History extraction function


def load_previous_period_last_days(
    start_date: date,
    db: Session = None,
    lookback_days: int = 2
) -> Dict[Tuple[str, date], str]:
    """Load the last N days of the immediately previous committed period.
    
    This function finds the most recent committed schedule before start_date and loads
    the last 2 days of that period. This works for normal months and special periods
    like Ramadan (pre-Ramadan, Ramadan, post-Ramadan).
    
    Args:
        start_date: Start date of the period being generated
        db: Database session (optional, will create one if not provided)
    
    Returns:
        Dict mapping (employee_name, date) to shift code for the last N days of previous period.
        Returns empty dict if no previous period exists or isn't committed.
    """
    from backend.models import CommittedSchedule
    from backend.database import SessionLocal
    
    # Use provided session or create a new one
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        # Find all unique committed dates before start_date
        # Get distinct dates ordered by date descending (most recent first)
        # Limit to lookback_days to get the trailing days of previous period
        period_dates_result = db.query(CommittedSchedule.date).filter(
            CommittedSchedule.date < start_date
        ).distinct().order_by(CommittedSchedule.date.desc()).limit(max(1, lookback_days)).all()
        
        if not period_dates_result:
            return {}
        
        # Extract date objects from query result (SQLAlchemy 1.4 returns tuples/Row objects)
        last_dates = []
        for row in period_dates_result:
            # SQLAlchemy 1.4 returns tuples when querying a single column
            if isinstance(row, tuple):
                date_val = row[0]
            elif hasattr(row, '__iter__') and not isinstance(row, (str, bytes)):
                # Row object or other iterable
                date_val = list(row)[0] if len(list(row)) > 0 else row
            else:
                date_val = row
            
            if isinstance(date_val, date):
                last_dates.append(date_val)
        
        if not last_dates:
            return {}
        
        # Sort to ensure chronological order (oldest first)
        last_dates = sorted(last_dates)
        
        # Load committed schedules for these dates
        prev_schedules = (
            db.query(CommittedSchedule)
            .options(joinedload(CommittedSchedule.user))
            .filter(CommittedSchedule.date.in_(last_dates))
            .all()
        )
        
        # Build dict: (display name, date) -> shift
        result = {}
        for schedule in prev_schedules:
            result[(committed_schedule_display_name(schedule), schedule.date)] = schedule.shift
        
        return result
    finally:
        if close_db:
            db.close()


def load_previous_month_last_days(year: int, month: int, db: Session = None) -> Dict[Tuple[str, date], str]:
    """Load the last 2 days of the immediately previous committed month.
    
    This is a backward-compatible wrapper that uses calendar month boundaries.
    For better continuity (especially for Ramadan periods), use load_previous_period_last_days instead.
    
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
        prev_schedules = (
            db.query(CommittedSchedule)
            .options(joinedload(CommittedSchedule.user))
            .filter(
                CommittedSchedule.year == prev_year,
                CommittedSchedule.month == prev_month,
                CommittedSchedule.date.in_([second_last_day_prev_month, last_day_prev_month]),
            )
            .all()
        )
        
        # Build dict: (display name, date) -> shift
        result = {}
        for schedule in prev_schedules:
            result[(committed_schedule_display_name(schedule), schedule.date)] = schedule.shift
        
        return result
    finally:
        if close_db:
            db.close()


def get_holiday_demands(is_weekend: bool = False) -> Dict[str, int]:
    """Get demand template for public holidays.
    
    Business rule:
    - All holidays (weekday or weekend) default to weekend-like staffing:
      1N, 1M3, 1A
    - ``is_weekend`` is kept for backward compatibility but no longer changes values.
    """
    return {
        'N': 1,
        'M': 0,
        'M3': 1,
        'A': 1,
        'IP': 0,
        'CL': 0,
        'M4': 0,
        'H': 0,
        'MS': 0,
        'IP+P': 0,
        'P': 0,
        'M+P': 0,
    }


def generate_month_demands(year: int, month: int, base_demand: Dict[str, int], 
                           weekend_demand: Dict[str, int], 
                           holidays: Dict[date, str] = None,
                           fixed_shifts: List[Dict[str, any]] = None) -> pd.DataFrame:
    """Generate default demands for a month.
    
    Special handling for fixed shifts: Shifts can be configured to appear on specific days
    of the week with specific counts.
    
    Special handling for holidays: Public holidays use fixed demand values:
    1N, 1M, 1M3, 1A, 1IP, 2CL
    
    Args:
        year: Year
        month: Month (1-12)
        base_demand: Base demand for weekdays
        weekend_demand: Demand for weekends
        holidays: Optional dict mapping date objects to holiday names
        fixed_shifts: Optional list of dicts with keys: shift (str), day (int), count (int)
                     day: 0 = Monday, 1 = Tuesday, 2 = Wednesday, 3 = Thursday, 
                          4 = Friday, 5 = Saturday, 6 = Sunday
    """
    import calendar
    from typing import List, Dict, Any
    
    if holidays is None:
        holidays = {}
    
    if fixed_shifts is None:
        fixed_shifts = []
    
    # Get all dates in the month
    num_days = calendar.monthrange(year, month)[1]
    dates = [date(year, month, day) for day in range(1, num_days + 1)]
    
    records = []
    for d in dates:
        # Check if this date is a holiday
        is_holiday = d in holidays
        
        if is_holiday:
            is_weekend = d.weekday() in [4, 5]  # Friday (4) or Saturday (5)
            holiday_demands = get_holiday_demands(is_weekend=is_weekend)
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
                'need_CL': holiday_demands.get('CL', 0),
                'need_E': 0,
                'need_MS': 0,
                'need_IP_P': 0,
                'need_P': 0,
                'need_M_P': 0
            }
        else:
            # Normal logic for non-holidays
            weekday = d.weekday()  # 0 = Monday, 6 = Sunday
            # In Oman: Weekdays = Sunday(6), Monday(0), Tuesday(1), Wednesday(2), Thursday(3)
            # Weekends = Friday(4), Saturday(5)
            is_weekend = weekday in [4, 5]  # Friday (4) or Saturday (5)
            
            demand = weekend_demand if is_weekend else base_demand
            
            # Initialize record with base/weekend demands
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
                'need_E': demand.get('E', 0),
                'need_MS': demand.get('MS', 0),
                'need_IP_P': demand.get('IP+P', 0),
                'need_P': demand.get('P', 0),
                'need_M_P': demand.get('M+P', 0)
            }
            
            # Apply fixed shifts for this day (including M+P which is now configurable)
            # weekday: 0 = Monday, 1 = Tuesday, 2 = Wednesday, 3 = Thursday, 4 = Friday, 5 = Saturday, 6 = Sunday
            for fixed in fixed_shifts:
                # Handle P shift specially (day: -1 means 1st/2nd/3rd of month)
                if fixed['shift'] == 'P' and fixed['day'] == -1:
                    # Add P on the 1st, 2nd, or 3rd (checking if it's a weekend - weekends shouldn't have P)
                    # Only apply to the first non-weekend day among 1st, 2nd, or 3rd
                    day_of_month = d.day
                    if day_of_month in [1, 2, 3]:
                        # Check if this day is a weekend (shouldn't have P)
                        if weekday not in [4, 5]:  # Not Friday or Saturday
                            count = fixed['count']
                            # Check if we haven't already added P to an earlier day in the month
                            # We'll add it to the first non-weekend day among 1st, 2nd, 3rd
                            if day_of_month == 1:
                                # Always add on 1st if it's not a weekend
                                record['need_P'] = (record.get('need_P', 0) or 0) + count
                            elif day_of_month == 2:
                                # Add on 2nd only if 1st was a weekend
                                day1 = date(year, month, 1)
                                if day1.weekday() in [4, 5]:  # 1st was a weekend
                                    record['need_P'] = (record.get('need_P', 0) or 0) + count
                            elif day_of_month == 3:
                                # Add on 3rd only if both 1st and 2nd were weekends
                                day1 = date(year, month, 1)
                                day2 = date(year, month, 2)
                                if day1.weekday() in [4, 5] and day2.weekday() in [4, 5]:  # Both 1st and 2nd were weekends
                                    record['need_P'] = (record.get('need_P', 0) or 0) + count
                elif fixed['day'] == weekday:
                    # Regular fixed shift for this day of week
                    shift_code = fixed['shift']
                    count = fixed['count']
                    # Convert shift code to column name (e.g., "IP+P" -> "IP_P")
                    column_name = shift_code.replace('+', '_')
                    need_key = f'need_{column_name}'
                    if need_key in record:
                        record[need_key] = (record.get(need_key, 0) or 0) + count
                    else:
                        # If shift code doesn't have a need_ column, initialize it
                        record[need_key] = count
        
        records.append(record)
    
    return pd.DataFrame(records)

