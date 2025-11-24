"""Data management endpoints."""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from pathlib import Path
import pandas as pd
import json
from typing import List, Dict, Optional
import sys

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.routers.auth import get_current_user
from backend.database import get_db
from backend.utils import hash_password
from backend.roster_data_loader import load_roster_data_from_db, load_month_demands, save_month_demands, generate_month_demands
from backend.models import User, LeaveRequest, LeaveType, RequestStatus, EmployeeType, ShiftRequest, ShiftType
from sqlalchemy.orm import Session
from datetime import date

router = APIRouter()
security = HTTPBearer()


class EmployeeData(BaseModel):
    employee: str
    skills: str
    maxN: int
    maxA: int
    min_days_off: int


class DemandData(BaseModel):
    date: str
    need_M: int = 0
    need_IP: int = 0
    need_A: int = 0
    need_N: int = 0
    need_M3: int = 0
    need_M4: int = 0
    need_H: int = 0
    need_CL: int = 0


class TimeOffEntry(BaseModel):
    employee: str
    from_date: str
    to_date: str
    code: str


class LockEntry(BaseModel):
    employee: str
    from_date: str
    to_date: str
    shift: str
    force: bool


@router.get("/employees")
async def get_employees(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all employees."""
    roster_data = load_roster_data_from_db(db)
    employees_df = roster_data['employees']
    return employees_df.to_dict('records')


@router.post("/employees")
async def create_employee(
    employee: EmployeeData,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new employee."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can create employees")
    
    roster_data = load_roster_data_from_db(db)
    employees_df = roster_data['employees']
    
    # Check if employee already exists
    if not employees_df.empty and employee.employee in employees_df['employee'].values:
        raise HTTPException(status_code=400, detail="Employee already exists")
    
    # Add new employee with default values
    new_row = {
        'employee': employee.employee,
        'skill_M': True, 'skill_IP': True, 'skill_A': True, 'skill_N': True,
        'skill_M3': True, 'skill_M4': True, 'skill_H': True, 'skill_CL': True,
        'clinic_only': False, 'ip_ok': True, 'harat_ok': True,
        'maxN': employee.maxN if hasattr(employee, 'maxN') else 3,
        'maxA': employee.maxA if hasattr(employee, 'maxA') else 3,
        'min_days_off': employee.min_days_off if hasattr(employee, 'min_days_off') else 4,
        'weight': 1.0,
        'pending_off': 0.0
    }
    employees_df = pd.concat([employees_df, pd.DataFrame([new_row])], ignore_index=True)
    
    # Save to file (employee skills are still stored in CSV for now)
    employees_path = project_root / "roster" / "app" / "data" / "employees.csv"
    employees_df.to_csv(employees_path, index=False)
    
    return {"message": "Employee created successfully"}


@router.put("/employees")
async def update_employees(
    employees: List[dict],
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update all employees (save changes permanently)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update employees")
    
    from backend.models import User, EmployeeType
    import re
    
    # Load existing employees to detect changes
    existing_roster_data = load_roster_data_from_db(db)
    existing_employees_df = existing_roster_data['employees']
    existing_employee_names = set(existing_employees_df['employee'].values) if not existing_employees_df.empty else set()
    
    employees_df = pd.DataFrame(employees)
    
    # Validate: Check for duplicate employee names
    employee_names = employees_df['employee'].astype(str).str.strip()
    duplicates = employee_names[employee_names.duplicated()].unique()
    if len(duplicates) > 0:
        raise HTTPException(
            status_code=400, 
            detail=f"Duplicate employee names found: {', '.join(duplicates)}. Each employee must have a unique name."
        )
    
    # Validate: Check for empty employee names
    empty_names = employee_names[employee_names == '']
    if len(empty_names) > 0:
        raise HTTPException(
            status_code=400,
            detail="Employee names cannot be empty. Please enter a name for all employees."
        )
    
    # Ensure all required columns exist
    required_columns = ['employee', 'skill_M', 'skill_IP', 'skill_A', 'skill_N', 'skill_M3', 'skill_M4', 'skill_H', 'skill_CL', 'clinic_only', 'maxN', 'maxA', 'min_days_off', 'weight', 'pending_off']
    for col in required_columns:
        if col not in employees_df.columns:
            if col.startswith('skill_'):
                employees_df[col] = True
            elif col == 'clinic_only':
                employees_df[col] = False
            elif col in ['maxN', 'maxA']:
                employees_df[col] = 3
            elif col == 'min_days_off':
                employees_df[col] = 4
            elif col == 'weight':
                employees_df[col] = 1.0
            elif col == 'pending_off':
                employees_df[col] = 0.0
    
    # Convert boolean columns to proper boolean type
    skill_columns = ['skill_M', 'skill_IP', 'skill_A', 'skill_N', 'skill_M3', 'skill_M4', 'skill_H', 'skill_CL']
    for col in skill_columns:
        if col in employees_df.columns:
            employees_df[col] = employees_df[col].astype(bool)
    
    # Ensure numeric columns are proper types
    employees_df['maxN'] = employees_df['maxN'].astype(int)
    employees_df['maxA'] = employees_df['maxA'].astype(int)
    employees_df['min_days_off'] = employees_df['min_days_off'].astype(int)
    employees_df['weight'] = employees_df['weight'].astype(float)
    employees_df['pending_off'] = employees_df['pending_off'].astype(float)
    employees_df['clinic_only'] = employees_df['clinic_only'].astype(bool)
    
    # Reorder columns to match expected format
    employees_df = employees_df[required_columns]
    
    # Save to file
    employees_path = Path("roster/app/data/employees.csv")
    employees_df.to_csv(employees_path, index=False)
    
    # Sync user accounts: auto-create accounts for new employees (using database)
    new_employee_names = set(employees_df['employee'].values)
    
    # Create user accounts for new employees
    for employee_name in new_employee_names:
        if employee_name not in existing_employee_names:
            # Generate username: lowercase, replace all spaces (single or multiple) with underscore
            username = re.sub(r'\s+', '_', employee_name.strip().lower())
            
            # Check if user already exists in database
            existing_user = db.query(User).filter(User.username == username).first()
            if not existing_user:
                # Create default password: first letter lowercase + rest + "123"
                employee_password = f"{employee_name[0].lower()}{employee_name[1:]}123"
                # Hash the password before storing
                hashed_password = hash_password(employee_password)
                new_user = User(
                    username=username,
                    password=hashed_password,
                    employee_type=EmployeeType.STAFF,
                    employee_name=employee_name
                )
                db.add(new_user)
    
    # Update employee_name in user accounts if employee name changed
    for employee_name in new_employee_names:
        username = re.sub(r'\s+', '_', employee_name.strip().lower())
        user = db.query(User).filter(User.username == username).first()
        if user and user.employee_name != employee_name:
            user.employee_name = employee_name
    
    db.commit()
    
    return {"message": "Employees updated successfully"}


@router.delete("/employees/{employee_name}")
async def delete_employee(
    employee_name: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete an employee."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can delete employees")
    
    roster_data = load_roster_data_from_db(db)
    employees_df = roster_data['employees']
    
    # Check if employee exists
    if employees_df.empty or employee_name not in employees_df['employee'].values:
        raise HTTPException(status_code=404, detail="Employee not found")
    
    # Remove employee
    employees_df = employees_df[employees_df['employee'] != employee_name]
    
    # Save to file (employee skills are still stored in CSV for now)
    employees_path = project_root / "roster" / "app" / "data" / "employees.csv"
    employees_df.to_csv(employees_path, index=False)
    
    # Optionally delete user account (but keep it for now to preserve login history)
    # User accounts are kept even if employee is deleted, in case they need to be restored
    # Managers can manually delete user accounts from User Management page if needed
    
    return {"message": "Employee deleted successfully"}


@router.get("/demands")
async def get_demands(
    year: Optional[int] = None,
    month: Optional[int] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get demands data."""
    if year and month:
        demands_df = load_month_demands(year, month)
    else:
        # Load from general demands file
        demands_file = project_root / "roster" / "app" / "data" / "demands.csv"
        if demands_file.exists():
            demands_df = pd.read_csv(demands_file)
        else:
            demands_df = pd.DataFrame()
    
    if year and month:
        demands_df['date'] = pd.to_datetime(demands_df['date'])
        demands_df = demands_df[
            (demands_df['date'].dt.year == year) &
            (demands_df['date'].dt.month == month)
        ]
    
    return demands_df.to_dict('records')


@router.post("/demands")
async def create_demand(
    demand: DemandData,
    current_user: dict = Depends(get_current_user)
):
    """Create a new demand entry."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can create demands")
    
    # Load existing demands
    demands_file = project_root / "roster" / "app" / "data" / "demands.csv"
    if demands_file.exists():
        demands_df = pd.read_csv(demands_file)
    else:
        demands_df = pd.DataFrame()
    
    # Add new demand
    new_row = pd.DataFrame([demand.dict()])
    demands_df = pd.concat([demands_df, new_row], ignore_index=True)
    
    # Save to file
    demands_df.to_csv(demands_file, index=False)
    
    return {"message": "Demand created successfully"}


@router.get("/roster-data")
async def get_roster_data(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all roster data (employees, demands, time_off, locks)."""
    roster_data = load_roster_data_from_db(db)
    
    # Load demands from CSV (no database model yet)
    from pathlib import Path
    import pandas as pd
    project_root = Path(__file__).parent.parent.parent
    demands_file = project_root / "roster" / "app" / "data" / "demands.csv"
    if demands_file.exists():
        demands_df = pd.read_csv(demands_file)
    else:
        demands_df = pd.DataFrame()
    
    # Convert date objects to ISO strings for JSON serialization
    time_off_records = roster_data['time_off'].to_dict('records')
    for record in time_off_records:
        if isinstance(record.get('from_date'), date):
            record['from_date'] = record['from_date'].isoformat()
        if isinstance(record.get('to_date'), date):
            record['to_date'] = record['to_date'].isoformat()
    
    locks_records = roster_data['locks'].to_dict('records')
    for record in locks_records:
        if isinstance(record.get('from_date'), date):
            record['from_date'] = record['from_date'].isoformat()
        if isinstance(record.get('to_date'), date):
            record['to_date'] = record['to_date'].isoformat()
    
    return {
        "employees": roster_data['employees'].to_dict('records'),
        "demands": demands_df.to_dict('records') if not demands_df.empty else [],
        "time_off": time_off_records,
        "locks": locks_records
    }


@router.put("/time-off")
async def update_time_off(
    entries: List[TimeOffEntry],
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save time off entries as leave requests OR shift requests in the database.
    
    Note: Non-standard shifts (like MS, C) appear in time_off but are actually shift requests
    with force=True. This endpoint handles both cases.
    """
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update time off data")

    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Received {len(entries)} time-off entries to save")
    
    # Delete ALL existing "Added via Roster Generator" leave requests
    leave_deleted = db.query(LeaveRequest).filter(
        LeaveRequest.reason == 'Added via Roster Generator'
    ).delete(synchronize_session=False)
    
    # Delete ALL existing "Added via Roster Generator" shift requests with force=True
    # (These are non-standard shifts that appear in time_off)
    shift_deleted = db.query(ShiftRequest).filter(
        ShiftRequest.reason == 'Added via Roster Generator',
        ShiftRequest.force == True
    ).delete(synchronize_session=False)
    
    db.commit()  # Commit the deletions before creating new ones
    logger.info(f"Deleted {leave_deleted} leave requests and {shift_deleted} shift requests")
    
    # Separate entries into leave types and shift types
    STANDARD_WORKING_SHIFTS = {'M', 'IP', 'A', 'N', 'M3', 'M4', 'H', 'CL'}
    
    leave_entries = []
    shift_entries = []
    
    for entry in entries:
        # Check if code is a shift type or leave type
        shift_type = db.query(ShiftType).filter(ShiftType.code == entry.code).first()
        leave_type = db.query(LeaveType).filter(LeaveType.code == entry.code).first()
        
        # If it's a shift type (especially non-standard), treat as shift request
        # Non-standard shifts with force=True appear in time_off
        if shift_type:
            shift_entries.append(entry)
        elif leave_type:
            leave_entries.append(entry)
        else:
            logger.warning(f"Code '{entry.code}' not found as shift or leave type, skipping")
    
    # Process leave entries
    processed_leave = set()
    created_leave_count = 0
    
    for entry in leave_entries:
        key = (entry.employee, entry.from_date, entry.to_date, entry.code)
        if key in processed_leave:
            continue
        processed_leave.add(key)
        
        user = db.query(User).filter(User.employee_name == entry.employee).first()
        if not user:
            continue
        
        leave_type = db.query(LeaveType).filter(LeaveType.code == entry.code).first()
        if not leave_type:
            continue
        
        from_date = date.fromisoformat(entry.from_date)
        to_date = date.fromisoformat(entry.to_date)
        
        new_request = LeaveRequest(
            user_id=user.id,
            leave_type_id=leave_type.id,
            from_date=from_date,
            to_date=to_date,
            reason='Added via Roster Generator',
            status=RequestStatus.APPROVED
        )
        db.add(new_request)
        created_leave_count += 1
        logger.info(f"Created leave request: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.code}")
    
    # Process shift entries (non-standard shifts with force=True)
    processed_shift = set()
    created_shift_count = 0
    
    for entry in shift_entries:
        key = (entry.employee, entry.from_date, entry.to_date, entry.code)
        if key in processed_shift:
            continue
        processed_shift.add(key)
        
        user = db.query(User).filter(User.employee_name == entry.employee).first()
        if not user:
            continue
        
        shift_type = db.query(ShiftType).filter(ShiftType.code == entry.code).first()
        if not shift_type:
            continue
        
        from_date = date.fromisoformat(entry.from_date)
        to_date = date.fromisoformat(entry.to_date)
        
        # Create shift request with force=True (for non-standard shifts that appear in time_off)
        new_request = ShiftRequest(
            user_id=user.id,
            shift_type_id=shift_type.id,
            from_date=from_date,
            to_date=to_date,
            force=True,  # force=True means "must have this shift"
            reason='Added via Roster Generator',
            status=RequestStatus.APPROVED
        )
        db.add(new_request)
        created_shift_count += 1
        logger.info(f"Created shift request: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.code} (force=True)")
    
    db.commit()
    total_created = created_leave_count + created_shift_count
    logger.info(f"Committed {created_leave_count} leave requests and {created_shift_count} shift requests (total: {total_created})")
    
    return {
        "message": f"Time off saved ({created_leave_count} leave, {created_shift_count} shift requests)",
        "created": total_created
    }


@router.put("/locks")
async def update_locks(
    entries: List[LockEntry],
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save shift lock entries as shift requests in the database."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update shift requests")

    import logging
    logger = logging.getLogger(__name__)
    
    logger.info(f"Received {len(entries)} shift lock entries to save")
    
    # Delete ALL existing "Added via Roster Generator" shift requests
    # This ensures deletions are handled correctly even if an employee has no entries in the new list
    all_deleted = db.query(ShiftRequest).filter(
        ShiftRequest.reason == 'Added via Roster Generator'
    ).delete(synchronize_session=False)
    db.commit()  # Commit the deletion before creating new ones
    logger.info(f"Deleted {all_deleted} existing roster generator shift requests")
    
    # Group entries by employee, from_date, to_date, shift, and force to create shift requests
    # Each unique combination should be one shift request
    processed = set()
    created_count = 0
    
    for entry in entries:
        # Create a unique key for this entry
        key = (entry.employee, entry.from_date, entry.to_date, entry.shift, entry.force)
        if key in processed:
            continue
        processed.add(key)
        
        # Find user by employee_name
        user = db.query(User).filter(User.employee_name == entry.employee).first()
        if not user:
            # Skip if employee doesn't have a user account
            continue
        
        # Parse dates
        from_date = date.fromisoformat(entry.from_date)
        to_date = date.fromisoformat(entry.to_date)
        
        # Find shift type by code
        shift_type = db.query(ShiftType).filter(ShiftType.code == entry.shift).first()
        if not shift_type:
            logger.warning(f"Shift type not found: {entry.shift} for employee {entry.employee}")
            continue
        
        # Create new shift request (auto-approved for managers adding via Roster Generator)
        new_request = ShiftRequest(
            user_id=user.id,
            shift_type_id=shift_type.id,
            from_date=from_date,
            to_date=to_date,
            force=entry.force,
            reason='Added via Roster Generator',
            status=RequestStatus.APPROVED  # Auto-approve when manager adds via Roster Generator
        )
        db.add(new_request)
        created_count += 1
        logger.info(f"Created shift request: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.shift}, force={entry.force}")
    
    db.commit()
    logger.info(f"Committed {created_count} new shift requests")
    
    return {
        "message": f"Shift locks saved as shift requests ({created_count} created)",
        "created": created_count
    }


class GenerateDemandsRequest(BaseModel):
    year: int
    month: int
    base_demand: dict
    weekend_demand: dict


@router.post("/demands/generate")
async def generate_demands(
    request: GenerateDemandsRequest,
    current_user: dict = Depends(get_current_user)
):
    """Generate demands for a month."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can generate demands")
    
    new_demands = generate_month_demands(
        request.year,
        request.month,
        request.base_demand,
        request.weekend_demand
    )
    
    # Ensure holiday column exists
    if 'holiday' not in new_demands.columns:
        new_demands['holiday'] = ''
    
    # Save to month-specific file
    save_month_demands(request.year, request.month, new_demands)
    
    # Convert dates to strings for response
    new_demands = new_demands.copy()
    if 'date' in new_demands.columns:
        new_demands['date'] = pd.to_datetime(new_demands['date'], errors='coerce').dt.strftime('%Y-%m-%d')
    
    return {
        "message": "Demands generated successfully",
        "demands": new_demands.to_dict('records')
    }


@router.get("/demands/month/{year}/{month}")
async def get_month_demands(
    year: int,
    month: int,
    current_user: dict = Depends(get_current_user)
):
    """Get demands for a specific month."""
    month_demands = load_month_demands(year, month)
    
    if month_demands.empty:
        return []
    
    # Convert dates to strings
    month_demands = month_demands.copy()
    if 'date' in month_demands.columns:
        month_demands['date'] = pd.to_datetime(month_demands['date'], errors='coerce').dt.strftime('%Y-%m-%d')
    
    # Ensure holiday column exists
    if 'holiday' not in month_demands.columns:
        month_demands['holiday'] = ''
    
    return month_demands.to_dict('records')


@router.post("/demands/month/{year}/{month}")
async def save_month_demands(
    year: int,
    month: int,
    demands: List[dict],
    current_user: dict = Depends(get_current_user)
):
    """Save demands for a specific month."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can save demands")
    
    demands_df = pd.DataFrame(demands)
    save_month_demands(year, month, demands_df)
    return {"message": "Demands saved successfully"}

