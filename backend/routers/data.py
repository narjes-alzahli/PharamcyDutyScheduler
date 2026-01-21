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
from backend.roster_data_loader import (
    load_roster_data_from_db, 
    load_month_demands, 
    save_month_demands as save_month_demands_to_file, 
    generate_month_demands,
    save_month_holidays,
    load_month_holidays,
    get_holiday_demands
)
from backend.models import User, LeaveRequest, LeaveType, RequestStatus, EmployeeType, ShiftRequest, ShiftType, EmployeeSkills
from sqlalchemy.orm import Session
from sqlalchemy import not_
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
    need_E: int = 0
    need_IP_P: int = 0
    need_P: int = 0
    need_M_P: int = 0


class TimeOffEntry(BaseModel):
    employee: str
    from_date: str
    to_date: str
    code: str
    request_id: Optional[str] = None  # If provided, update this specific request; if None, always create new


class LockEntry(BaseModel):
    employee: str
    from_date: str
    to_date: str
    shift: str
    force: bool
    request_id: Optional[str] = None  # If provided, update this specific request; if None, always create new


@router.get("/employees")
async def get_employees(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all employees."""
    roster_data = load_roster_data_from_db(db)
    employees_df = roster_data['employees']
    return employees_df.to_dict('records')


# POST /employees removed - employees are now created automatically when creating Staff users in User Management

@router.put("/employees")
async def update_employees(
    employees: List[dict],
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update all employees (save changes permanently)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update employees")
    
    import re
    
    # Get existing employees from database
    existing_employees = {emp.name: emp for emp in db.query(EmployeeSkills).all()}
    existing_employee_names = set(existing_employees.keys())
    
    # Validate: Check for duplicate employee names
    employee_names = [str(emp.get('employee', '')).strip() for emp in employees]
    duplicates = [name for name in employee_names if employee_names.count(name) > 1]
    if duplicates:
        raise HTTPException(
            status_code=400, 
            detail=f"Duplicate employee names found: {', '.join(set(duplicates))}. Each employee must have a unique name."
        )
    
    # Validate: Check for empty employee names
    empty_names = [name for name in employee_names if not name]
    if empty_names:
        raise HTTPException(
            status_code=400,
            detail="Employee names cannot be empty. Please enter a name for all employees."
        )
    
    new_employee_names = set(employee_names)
    
    # Update or create employees
    for emp_data in employees:
        employee_name = str(emp_data.get('employee', '')).strip()
        if not employee_name:
            continue
        
        if employee_name in existing_employees:
            # Update existing
            emp = existing_employees[employee_name]
            emp.skill_M = bool(emp_data.get('skill_M', True))
            emp.skill_IP = bool(emp_data.get('skill_IP', True))
            emp.skill_A = bool(emp_data.get('skill_A', True))
            emp.skill_N = bool(emp_data.get('skill_N', True))
            emp.skill_M3 = bool(emp_data.get('skill_M3', True))
            emp.skill_M4 = bool(emp_data.get('skill_M4', True))
            emp.skill_H = bool(emp_data.get('skill_H', False))
            emp.skill_CL = bool(emp_data.get('skill_CL', True))
            emp.clinic_only = bool(emp_data.get('clinic_only', False))
            emp.maxN = int(emp_data.get('maxN', 3))
            emp.maxA = int(emp_data.get('maxA', 3))
            emp.min_days_off = int(emp_data.get('min_days_off', 4))
            emp.weight = float(emp_data.get('weight', 1.0))
            emp.pending_off = float(emp_data.get('pending_off', 0.0))
        else:
            # Create new
            new_emp = EmployeeSkills(
                name=employee_name,
                skill_M=bool(emp_data.get('skill_M', True)),
                skill_IP=bool(emp_data.get('skill_IP', True)),
                skill_A=bool(emp_data.get('skill_A', True)),
                skill_N=bool(emp_data.get('skill_N', True)),
                skill_M3=bool(emp_data.get('skill_M3', True)),
                skill_M4=bool(emp_data.get('skill_M4', True)),
                skill_H=bool(emp_data.get('skill_H', False)),
                skill_CL=bool(emp_data.get('skill_CL', True)),
                clinic_only=bool(emp_data.get('clinic_only', False)),
                maxN=int(emp_data.get('maxN', 3)),
                maxA=int(emp_data.get('maxA', 3)),
                min_days_off=int(emp_data.get('min_days_off', 4)),
                weight=float(emp_data.get('weight', 1.0)),
                pending_off=float(emp_data.get('pending_off', 0.0))
            )
            db.add(new_emp)
    
    # Delete employees that are no longer in the list
    employees_to_delete = existing_employee_names - new_employee_names
    for employee_name in employees_to_delete:
        db.delete(existing_employees[employee_name])
    
    # Sync user accounts: auto-create accounts for new employees
    for employee_name in new_employee_names:
        if employee_name not in existing_employee_names:
            # Generate username: lowercase, replace all spaces with underscore
            username = re.sub(r'\s+', '_', employee_name.strip().lower())
            
            # Check if user already exists in database
            existing_user = db.query(User).filter(User.username == username).first()
            if not existing_user:
                # Create default password: first letter lowercase + rest + "123"
                employee_password = f"{employee_name[0].lower()}{employee_name[1:]}123"
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
    
    # Check if employee exists
    employee = db.query(EmployeeSkills).filter(EmployeeSkills.name == employee_name).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    
    # Delete employee
    db.delete(employee)
    db.commit()
    
    # Note: User accounts are kept even if employee is deleted, in case they need to be restored
    # Managers can manually delete user accounts from User Management page if needed
    
    return {"message": "Employee deleted successfully"}


@router.get("/demands")
async def get_demands(
    year: Optional[int] = None,
    month: Optional[int] = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get demands data for a specific month. Year and month are required."""
    if not year or not month:
        raise HTTPException(
            status_code=400, 
            detail="Year and month parameters are required"
        )
    
    demands_df = load_month_demands(year, month, db)
    return demands_df.to_dict('records')


# POST /demands removed - use POST /demands/month/{year}/{month} instead
# Demands must be created for specific months


@router.get("/roster-data")
async def get_roster_data(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all roster data (employees, demands, time_off, locks)."""
    try:
        # Don't expand ranges for frontend - keep as ranges
        roster_data = load_roster_data_from_db(db, expand_ranges=False)
        
        # Demands are loaded per-month from month-specific files
        # No general demands file needed
        demands_df = pd.DataFrame()
        
        # Convert date objects to ISO strings for JSON serialization
        # Replace NaN values with None to make JSON serializable
        import numpy as np
        time_off_records = roster_data['time_off'].replace({np.nan: None}).to_dict('records')
        for record in time_off_records:
            if isinstance(record.get('from_date'), date):
                record['from_date'] = record['from_date'].isoformat()
            if isinstance(record.get('to_date'), date):
                record['to_date'] = record['to_date'].isoformat()
        
        locks_records = roster_data['locks'].replace({np.nan: None}).to_dict('records')
        for record in locks_records:
            if isinstance(record.get('from_date'), date):
                record['from_date'] = record['from_date'].isoformat()
            if isinstance(record.get('to_date'), date):
                record['to_date'] = record['to_date'].isoformat()
        
        # Replace NaN in employees and demands DataFrames
        employees_records = roster_data['employees'].replace({np.nan: None}).to_dict('records')
        demands_records = demands_df.replace({np.nan: None}).to_dict('records') if not demands_df.empty else []
        
        return {
            "employees": employees_records,
            "demands": demands_records,
            "time_off": time_off_records,
            "locks": locks_records
        }
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"Error in get_roster_data: {error_details}")
        raise HTTPException(status_code=500, detail=f"Failed to load roster data: {str(e)}")


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
    
    # Use upsert pattern: update existing requests or create new ones
    # This is more efficient than deleting all and recreating
    
    # Separate entries into leave types and shift types
    # (STANDARD_WORKING_SHIFTS already defined above)
    
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
    
    # Process leave entries - use upsert pattern (update if exists, create if not)
    created_leave_count = 0
    updated_leave_count = 0
    
    for entry in leave_entries:
        user = db.query(User).filter(User.employee_name == entry.employee).first()
        if not user:
            continue
        
        leave_type = db.query(LeaveType).filter(LeaveType.code == entry.code).first()
        if not leave_type:
            continue
        
        # Parse dates - handle both YYYY-MM-DD and DD-MM-YYYY formats
        try:
            from_date = date.fromisoformat(entry.from_date)
        except ValueError:
            # Try parsing DD-MM-YYYY format
            try:
                parts = entry.from_date.split('-')
                if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                    from_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid date format for time-off request (employee: {entry.employee}): '{entry.from_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                    )
            except (ValueError, IndexError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to parse from_date '{entry.from_date}' for employee {entry.employee}: {str(e)}"
                )
        
        try:
            to_date = date.fromisoformat(entry.to_date)
        except ValueError:
            # Try parsing DD-MM-YYYY format
            try:
                parts = entry.to_date.split('-')
                if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                    to_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid date format for time-off request (employee: {entry.employee}): '{entry.to_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                    )
            except (ValueError, IndexError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to parse to_date '{entry.to_date}' for employee {entry.employee}: {str(e)}"
                )
        
        # IMPORTANT: Only update if entry has a request_id (indicating it's an edit)
        # If no request_id, always create a new request (even if one exists with same dates)
        existing_request = None
        if entry.request_id:
            # Try to parse request_id to get the database ID
            request_id_str = str(entry.request_id)
            if request_id_str.startswith('LR_'):
                try:
                    request_db_id = int(request_id_str.split('_')[1])
                    existing_request = db.query(LeaveRequest).filter(
                        LeaveRequest.id == request_db_id,
                        LeaveRequest.user_id == user.id,
                        LeaveRequest.leave_type_id == leave_type.id,
                        LeaveRequest.reason == 'Added via Roster Generator'
                    ).first()
                except (ValueError, IndexError):
                    pass  # Invalid request_id format, treat as new
        
        if existing_request:
            # Update existing request (explicit edit via request_id)
            existing_request.from_date = from_date
            existing_request.to_date = to_date
            updated_leave_count += 1
            logger.info(f"Updated leave request: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.code}")
        else:
            # Always create new request if no request_id (new entry)
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
    # Allow multiple requests - don't deduplicate, just create/update each one
    created_shift_count = 0
    updated_shift_count = 0
    
    for entry in shift_entries:
        user = db.query(User).filter(User.employee_name == entry.employee).first()
        if not user:
            continue
        
        shift_type = db.query(ShiftType).filter(ShiftType.code == entry.code).first()
        if not shift_type:
            continue
        
        # Parse dates - handle both YYYY-MM-DD and DD-MM-YYYY formats
        try:
            from_date = date.fromisoformat(entry.from_date)
        except ValueError:
            # Try parsing DD-MM-YYYY format
            try:
                parts = entry.from_date.split('-')
                if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                    from_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid date format for time-off request (employee: {entry.employee}): '{entry.from_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                    )
            except (ValueError, IndexError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to parse from_date '{entry.from_date}' for employee {entry.employee}: {str(e)}"
                )
        
        try:
            to_date = date.fromisoformat(entry.to_date)
        except ValueError:
            # Try parsing DD-MM-YYYY format
            try:
                parts = entry.to_date.split('-')
                if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                    to_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid date format for time-off request (employee: {entry.employee}): '{entry.to_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                    )
            except (ValueError, IndexError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to parse to_date '{entry.to_date}' for employee {entry.employee}: {str(e)}"
                )
        
        # IMPORTANT: Only update if entry has a request_id (indicating it's an edit)
        # If no request_id, always create a new request (even if one exists with same dates)
        existing_request = None
        if entry.request_id:
            # Try to parse request_id to get the database ID
            request_id_str = str(entry.request_id)
            if request_id_str.startswith('SR_'):
                try:
                    request_db_id = int(request_id_str.split('_')[1])
                    existing_request = db.query(ShiftRequest).filter(
                        ShiftRequest.id == request_db_id,
                        ShiftRequest.user_id == user.id,
                        ShiftRequest.shift_type_id == shift_type.id,
                        ShiftRequest.reason == 'Added via Roster Generator'
                    ).first()
                except (ValueError, IndexError):
                    pass  # Invalid request_id format, treat as new
        
        if existing_request:
            # Update existing request (explicit edit via request_id)
            existing_request.from_date = from_date
            existing_request.to_date = to_date
            updated_shift_count += 1
            logger.info(f"Updated shift request: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.code} (force=True)")
        else:
            # Always create new request if no request_id (new entry)
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
    total_updated = updated_leave_count + updated_shift_count
    logger.info(f"Committed {created_leave_count} leave requests created, {updated_leave_count} updated; {created_shift_count} shift requests created, {updated_shift_count} updated (total: {total_created} created, {total_updated} updated)")
    
    # Reload created requests to get their IDs and return them
    created_leave_requests = []
    created_shift_requests = []
    
    if created_leave_count > 0:
        # Get the most recently created leave requests (last N created)
        recent_leaves = db.query(LeaveRequest).filter(
            LeaveRequest.reason == 'Added via Roster Generator',
            LeaveRequest.status == RequestStatus.APPROVED
        ).order_by(LeaveRequest.id.desc()).limit(created_leave_count).all()
        
        for leave in recent_leaves:
            # Check if this leave matches any of the entries we just created
            for entry in leave_entries:
                if (leave.user.employee_name == entry.employee and
                    leave.leave_type.code == entry.code and
                    leave.from_date.isoformat() == entry.from_date and
                    leave.to_date.isoformat() == entry.to_date):
                    created_leave_requests.append({
                        'request_id': f"LR_{leave.id}",
                        'employee': leave.user.employee_name,
                        'from_date': leave.from_date.isoformat(),
                        'to_date': leave.to_date.isoformat(),
                        'code': leave.leave_type.code,
                        'reason': leave.reason or '',
                    })
                    break
    
    if created_shift_count > 0:
        # Get the most recently created shift requests (last N created)
        recent_shifts = db.query(ShiftRequest).filter(
            ShiftRequest.reason == 'Added via Roster Generator',
            ShiftRequest.status == RequestStatus.APPROVED
        ).order_by(ShiftRequest.id.desc()).limit(created_shift_count).all()
        
        for shift in recent_shifts:
            # Check if this shift matches any of the entries we just created
            for entry in shift_entries:
                if (shift.user.employee_name == entry.employee and
                    shift.shift_type.code == entry.code and
                    shift.from_date.isoformat() == entry.from_date and
                    shift.to_date.isoformat() == entry.to_date):
                    created_shift_requests.append({
                        'request_id': f"SR_{shift.id}",
                        'employee': shift.user.employee_name,
                        'from_date': shift.from_date.isoformat(),
                        'to_date': shift.to_date.isoformat(),
                        'shift': shift.shift_type.code,
                        'force': shift.force,
                        'reason': shift.reason or '',
                    })
                    break
    
    return {
        "message": f"Time off saved ({created_leave_count} leave, {created_shift_count} shift requests)",
        "created": total_created,
        "created_leave_requests": created_leave_requests,
        "created_shift_requests": created_shift_requests
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
    
    # Use upsert pattern: update existing requests or create new ones
    # This is more efficient than deleting all and recreating
    # Allow multiple shift requests - don't prevent duplicates
    created_count = 0
    updated_count = 0
    
    for entry in entries:
        # Find user by employee_name
        user = db.query(User).filter(User.employee_name == entry.employee).first()
        if not user:
            # Skip if employee doesn't have a user account
            continue
        
        # Parse dates
        # Parse dates - handle both YYYY-MM-DD and DD-MM-YYYY formats
        try:
            from_date = date.fromisoformat(entry.from_date)
        except ValueError:
            # Try parsing DD-MM-YYYY format
            try:
                parts = entry.from_date.split('-')
                if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                    from_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid date format for shift request (employee: {entry.employee}): '{entry.from_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                    )
            except (ValueError, IndexError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to parse from_date '{entry.from_date}' for employee {entry.employee}: {str(e)}"
                )
        
        try:
            to_date = date.fromisoformat(entry.to_date)
        except ValueError:
            # Try parsing DD-MM-YYYY format
            try:
                parts = entry.to_date.split('-')
                if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                    to_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid date format for shift request (employee: {entry.employee}): '{entry.to_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                    )
            except (ValueError, IndexError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to parse to_date '{entry.to_date}' for employee {entry.employee}: {str(e)}"
                )
        
        # Find shift type by code
        shift_type = db.query(ShiftType).filter(ShiftType.code == entry.shift).first()
        if not shift_type:
            raise HTTPException(
                status_code=400,
                detail=f"Shift type '{entry.shift}' not found for employee {entry.employee}"
            )
        
        # If request_id is provided, update that specific request
        if entry.request_id:
            # Parse request_id (format: "SR_123")
            try:
                if entry.request_id.startswith('SR_'):
                    db_id = int(entry.request_id.split('_')[1])
                else:
                    raise ValueError(f"Invalid request_id format: {entry.request_id}")
            except (IndexError, ValueError) as e:
                logger.warning(f"Invalid request_id '{entry.request_id}', creating new request instead: {e}")
                entry.request_id = None  # Fall through to create new request
        
        if entry.request_id:
            # Update specific existing request
            existing_request = db.query(ShiftRequest).filter(
                ShiftRequest.id == db_id,
                ShiftRequest.user_id == user.id  # Verify ownership
            ).first()
            
            if existing_request:
                existing_request.from_date = from_date
                existing_request.to_date = to_date
                existing_request.force = entry.force
                existing_request.shift_type_id = shift_type.id  # Allow shift type changes
                updated_count += 1
                logger.info(f"Updated shift request {entry.request_id}: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.shift}, force={entry.force}")
            else:
                # Request ID provided but not found - create new instead
                logger.warning(f"Request ID {entry.request_id} not found for employee {entry.employee}, creating new request")
                new_request = ShiftRequest(
                    user_id=user.id,
                    shift_type_id=shift_type.id,
                    from_date=from_date,
                    to_date=to_date,
                    force=entry.force,
                    reason='Added via Roster Generator',
                    status=RequestStatus.APPROVED
                )
                db.add(new_request)
                created_count += 1
                logger.info(f"Created shift request: {entry.employee}, {entry.from_date} to {entry.to_date}, {entry.shift}, force={entry.force}")
        else:
            # No request_id provided - always create new request (allow duplicates)
            # This prevents overwriting existing requests when user adds a new one
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
    logger.info(f"Committed {created_count} new shift requests, {updated_count} updated")
    
    # Reload created requests to get their IDs and return them
    created_requests = []
    
    if created_count > 0:
        # Get the most recently created shift requests (last N created)
        recent_shifts = db.query(ShiftRequest).filter(
            ShiftRequest.reason == 'Added via Roster Generator',
            ShiftRequest.status == RequestStatus.APPROVED
        ).order_by(ShiftRequest.id.desc()).limit(created_count).all()
        
        for shift in recent_shifts:
            # Check if this shift matches any of the entries we just created
            for entry in entries:
                if (shift.user.employee_name == entry.employee and
                    shift.shift_type.code == entry.shift and
                    shift.from_date.isoformat() == entry.from_date and
                    shift.to_date.isoformat() == entry.to_date and
                    shift.force == entry.force):
                    created_requests.append({
                        'request_id': f"SR_{shift.id}",
                        'employee': shift.user.employee_name,
                        'from_date': shift.from_date.isoformat(),
                        'to_date': shift.to_date.isoformat(),
                        'shift': shift.shift_type.code,
                        'force': shift.force,
                        'reason': shift.reason or '',
                    })
                    break
    
    return {
        "message": f"Shift locks saved as shift requests ({created_count} created)",
        "created": created_count,
        "created_requests": created_requests
    }


class FixedShiftConfig(BaseModel):
    shift: str
    day: int  # 0 = Monday, 1 = Tuesday, 2 = Wednesday, 3 = Thursday, 4 = Friday, 5 = Saturday, 6 = Sunday
    count: int

class GenerateDemandsRequest(BaseModel):
    year: int
    month: int
    base_demand: dict
    weekend_demand: dict
    fixed_shifts: List[FixedShiftConfig] = []  # Optional list of fixed shifts


@router.post("/demands/generate")
async def generate_demands(
    request: GenerateDemandsRequest,
    current_user: dict = Depends(get_current_user)
):
    """Generate demands for a month."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can generate demands")
    
    # Load existing holidays separately (not from demands)
    # Note: generate_demands doesn't have db session, so it will create its own
    existing_holidays = load_month_holidays(request.year, request.month)
    # Convert date strings to date objects for matching
    existing_holidays_dates = {}
    for date_str, holiday_name in existing_holidays.items():
        try:
            date_val = pd.to_datetime(date_str, errors='coerce').date()
            if date_val:
                existing_holidays_dates[date_val] = holiday_name
        except:
            continue
    
    # Convert fixed_shifts to list of dicts if provided
    fixed_shifts_list = []
    if request.fixed_shifts:
        fixed_shifts_list = [{"shift": fs.shift, "day": fs.day, "count": fs.count} for fs in request.fixed_shifts]
    
    new_demands = generate_month_demands(
        request.year,
        request.month,
        request.base_demand,
        request.weekend_demand,
        holidays=existing_holidays_dates,  # Pass holidays to set holiday-specific demands
        fixed_shifts=fixed_shifts_list  # Pass fixed shifts configuration
    )
    
    # Save holidays separately (not in demands)
    if existing_holidays_dates:
        # Convert date objects to strings for saving
        holidays_dict = {d.isoformat(): name for d, name in existing_holidays_dates.items()}
        save_month_holidays(request.year, request.month, holidays_dict)
    
    # Save demands without holiday column
    save_month_demands_to_file(request.year, request.month, new_demands)
    
    # Add holiday column to response for UI (but not saved in demands CSV)
    if existing_holidays_dates:
        new_demands['holiday'] = new_demands['date'].apply(
            lambda d: existing_holidays_dates.get(d, '')
        )
    else:
        new_demands['holiday'] = ''
    
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
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get demands for a specific month (with holidays merged for UI display)."""
    month_demands = load_month_demands(year, month, db)
    
    if month_demands.empty:
        return []
    
    # Load holidays separately
    # Note: get_month_demands doesn't have db session, so it will create its own
    holidays = load_month_holidays(year, month)
    
    # Convert dates to strings
    month_demands = month_demands.copy()
    if 'date' in month_demands.columns:
        month_demands['date'] = pd.to_datetime(month_demands['date'], errors='coerce').dt.strftime('%Y-%m-%d')
        # Merge holidays into demands for UI display
        month_demands['holiday'] = month_demands['date'].map(lambda d: holidays.get(str(d), ''))
    else:
        # If no date column, add empty holiday column
        month_demands['holiday'] = ''
    
    return month_demands.to_dict('records')


@router.post("/demands/month/{year}/{month}")
async def save_month_demands(
    year: int,
    month: int,
    demands: List[dict],
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save demands for a specific month (without holidays - holidays are saved separately)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can save demands")
    
    demands_df = pd.DataFrame(demands)
    
    # Extract holidays if present (for backward compatibility during transition)
    holidays = {}
    if 'holiday' in demands_df.columns:
        for _, row in demands_df.iterrows():
            date_str = str(row.get('date', ''))
            holiday_name = str(row.get('holiday', '')).strip()
            if date_str and holiday_name:
                holidays[date_str] = holiday_name
        # Remove holiday column from demands
        demands_df = demands_df.drop(columns=['holiday'])
    
    # Ensure date column is properly formatted
    if 'date' in demands_df.columns:
        # Convert date strings to datetime, then back to date for consistent storage
        demands_df['date'] = pd.to_datetime(demands_df['date'], errors='coerce')
        # Filter out any invalid dates
        demands_df = demands_df[demands_df['date'].notna()]
        # Convert to date type (not datetime)
        demands_df['date'] = demands_df['date'].dt.date
    
    # Ensure all required columns exist
    required_columns = ['date', 'need_M', 'need_IP', 'need_A', 'need_N', 'need_M3', 'need_M4', 'need_H', 'need_CL', 'need_E', 'need_IP_P', 'need_P', 'need_M_P']
    for col in required_columns:
        if col not in demands_df.columns:
            if col == 'date':
                raise HTTPException(status_code=400, detail="Missing required 'date' column")
            else:
                demands_df[col] = 0
    
    # Load holidays to check which days need holiday-specific demands
    existing_holidays = load_month_holidays(year, month)
    # Convert date strings to date objects for matching
    existing_holidays_dates = {}
    for date_str, holiday_name in existing_holidays.items():
        try:
            date_val = pd.to_datetime(date_str, errors='coerce').date()
            if date_val:
                existing_holidays_dates[date_val] = holiday_name
        except:
            continue
    
    # Override demands for holidays with holiday-specific values
    if existing_holidays_dates:
        holiday_demands = get_holiday_demands()
        for idx, row in demands_df.iterrows():
            date_val = row['date']
            if date_val in existing_holidays_dates:
                # Override with holiday demands
                demands_df.at[idx, 'need_M'] = holiday_demands.get('M', 0)
                demands_df.at[idx, 'need_IP'] = holiday_demands.get('IP', 0)
                demands_df.at[idx, 'need_A'] = holiday_demands.get('A', 0)
                demands_df.at[idx, 'need_N'] = holiday_demands.get('N', 0)
                demands_df.at[idx, 'need_M3'] = holiday_demands.get('M3', 0)
                demands_df.at[idx, 'need_M4'] = holiday_demands.get('M4', 0)
                demands_df.at[idx, 'need_H'] = holiday_demands.get('H', 0)
                demands_df.at[idx, 'need_CL'] = holiday_demands.get('CL', 0)
                demands_df.at[idx, 'need_E'] = holiday_demands.get('E', 0)
                demands_df.at[idx, 'need_IP_P'] = holiday_demands.get('IP+P', 0)
                demands_df.at[idx, 'need_P'] = holiday_demands.get('P', 0)
                demands_df.at[idx, 'need_M_P'] = holiday_demands.get('M+P', 0)
    
    # Save demands to database (without holiday column)
    save_month_demands_to_file(year, month, demands_df, db)
    
    # Save holidays separately if any were provided
    if holidays:
        save_month_holidays(year, month, holidays, db=db)
    
    return {"message": "Demands saved successfully"}


@router.get("/holidays/month/{year}/{month}")
async def get_month_holidays(
    year: int,
    month: int,
    current_user: dict = Depends(get_current_user)
):
    """Get holidays for a specific month."""
    # Note: get_month_holidays doesn't have db session, so it will create its own
    holidays = load_month_holidays(year, month)
    return holidays


@router.post("/holidays/month/{year}/{month}")
async def save_month_holidays_endpoint(
    year: int,
    month: int,
    holidays: Dict[str, str],
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save holidays for a specific month."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can save holidays")
    
    save_month_holidays(year, month, holidays, db=db)
    return {"message": "Holidays saved successfully"}

