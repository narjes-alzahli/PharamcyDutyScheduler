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

from roster.app.legacy_streamlit.data_manager import DataManager
from backend.routers.auth import get_current_user
from backend.database import get_db
from backend.utils import hash_password
from sqlalchemy.orm import Session

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
async def get_employees(current_user: dict = Depends(get_current_user)):
    """Get all employees."""
    data_manager = DataManager()
    roster_data = data_manager.load_initial_data()
    employees_df = roster_data['employees']
    return employees_df.to_dict('records')


@router.post("/employees")
async def create_employee(
    employee: EmployeeData,
    current_user: dict = Depends(get_current_user)
):
    """Create a new employee."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can create employees")
    
    data_manager = DataManager()
    roster_data = data_manager.load_initial_data()
    employees_df = roster_data['employees']
    
    # Check if employee already exists
    if employee.employee in employees_df['employee'].values:
        raise HTTPException(status_code=400, detail="Employee already exists")
    
    # Add new employee
    new_row = pd.DataFrame([{
        'employee': employee.employee,
        'skills': employee.skills,
        'maxN': employee.maxN,
        'maxA': employee.maxA,
        'min_days_off': employee.min_days_off
    }])
    employees_df = pd.concat([employees_df, new_row], ignore_index=True)
    
    # Save to file
    employees_df.to_csv(Path("roster/app/data/employees.csv"), index=False)
    
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
    
    data_manager = DataManager()
    
    # Load existing employees to detect changes
    existing_employees_df = data_manager.load_initial_data()['employees']
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
    current_user: dict = Depends(get_current_user)
):
    """Delete an employee."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can delete employees")
    
    data_manager = DataManager()
    roster_data = data_manager.load_initial_data()
    employees_df = roster_data['employees']
    
    # Check if employee exists
    if employee_name not in employees_df['employee'].values:
        raise HTTPException(status_code=404, detail="Employee not found")
    
    # Remove employee
    employees_df = employees_df[employees_df['employee'] != employee_name]
    
    # Save to file
    employees_df.to_csv(Path("roster/app/data/employees.csv"), index=False)
    
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
    data_manager = DataManager()
    roster_data = data_manager.load_initial_data()
    demands_df = roster_data['demands']
    
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
    
    data_manager = DataManager()
    roster_data = data_manager.load_initial_data()
    demands_df = roster_data['demands']
    
    # Add new demand
    new_row = pd.DataFrame([demand.dict()])
    demands_df = pd.concat([demands_df, new_row], ignore_index=True)
    
    # Save to file
    demands_df.to_csv(Path("roster/app/data/demands.csv"), index=False)
    
    return {"message": "Demand created successfully"}


@router.get("/roster-data")
async def get_roster_data(current_user: dict = Depends(get_current_user)):
    """Get all roster data (employees, demands, time_off, locks)."""
    data_manager = DataManager()
    roster_data = data_manager.load_initial_data()
    
    return {
        "employees": roster_data['employees'].to_dict('records'),
        "demands": roster_data['demands'].to_dict('records'),
        "time_off": roster_data['time_off'].to_dict('records'),
        "locks": roster_data['locks'].to_dict('records')
    }


@router.put("/time-off")
async def update_time_off(
    entries: List[TimeOffEntry],
    current_user: dict = Depends(get_current_user)
):
    """Persist time off entries."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update time off data")

    data_manager = DataManager()
    success = data_manager.save_time_off([entry.dict() for entry in entries])
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save time off data")
    return {"message": "Time off updated successfully"}


@router.put("/locks")
async def update_locks(
    entries: List[LockEntry],
    current_user: dict = Depends(get_current_user)
):
    """Persist shift lock entries."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update shift requests")

    data_manager = DataManager()
    success = data_manager.save_locks([entry.dict() for entry in entries])
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save shift request data")
    return {"message": "Shift requests updated successfully"}


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
    
    data_manager = DataManager()
    new_demands = data_manager.generate_month_demands(
        request.year,
        request.month,
        request.base_demand,
        request.weekend_demand
    )
    
    # Ensure holiday column exists
    if 'holiday' not in new_demands.columns:
        new_demands['holiday'] = ''
    
    # Save to month-specific file
    if data_manager.save_month_demands(request.year, request.month, new_demands):
        # Convert dates to strings for response
        new_demands = new_demands.copy()
        if 'date' in new_demands.columns:
            new_demands['date'] = pd.to_datetime(new_demands['date'], errors='coerce').dt.strftime('%Y-%m-%d')
        
        return {
            "message": "Demands generated successfully",
            "demands": new_demands.to_dict('records')
        }
    else:
        raise HTTPException(status_code=500, detail="Failed to save demands")


@router.get("/demands/month/{year}/{month}")
async def get_month_demands(
    year: int,
    month: int,
    current_user: dict = Depends(get_current_user)
):
    """Get demands for a specific month."""
    data_manager = DataManager()
    month_demands = data_manager.load_month_demands(year, month)
    
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
    
    data_manager = DataManager()
    demands_df = pd.DataFrame(demands)
    
    if data_manager.save_month_demands(year, month, demands_df):
        return {"message": "Demands saved successfully"}
    else:
        raise HTTPException(status_code=500, detail="Failed to save demands")

