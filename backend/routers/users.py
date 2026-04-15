"""User management endpoints."""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from pathlib import Path
from typing import Optional
import sys
import re
from sqlalchemy.orm import Session

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.routers.auth import get_current_user
from backend.database import get_db
from backend.models import User, EmployeeType, EmployeeSkills
from backend.user_employee_sync import apply_display_name_change_cascade
from backend.utils import hash_password, normalize_staff_no

router = APIRouter()
security = HTTPBearer()


class UserCreate(BaseModel):
    employee_name: str
    password: str
    employee_type: str
    staff_no: Optional[str] = None


class UserUpdate(BaseModel):
    employee_name: str
    username: str  # Required - must be unique
    password: Optional[str] = None
    employee_type: str
    old_username: Optional[str] = None  # Used to find the user if username/employee_name changed
    pending_off: Optional[float] = None
    staff_no: Optional[str] = None


@router.get("/")
async def get_all_users(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all users (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can view users")
    
    db_users = db.query(User).all()
    users = []
    for user in db_users:
        users.append({
            'username': user.username,
            'employee_name': user.employee_name,
            'employee_type': user.employee_type.value,
            'staff_no': user.staff_no,
            'password_hidden': '*' * len(user.password) if user.password else ''
        })
    return users


@router.post("/")
async def create_user(
    user_data: UserCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new user account (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can create users")
    
    # Generate username from employee name
    username = re.sub(r'\s+', '_', user_data.employee_name.strip().lower())
    
    # Check if user already exists
    existing_user = db.query(User).filter(User.username == username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="User with this name already exists")
    
    # Create user
    employee_type = EmployeeType.MANAGER if user_data.employee_type == 'Manager' else EmployeeType.STAFF
    hashed_password = hash_password(user_data.password)
    sn = normalize_staff_no(user_data.staff_no)
    if sn:
        taken = db.query(User).filter(User.staff_no == sn).first()
        if taken:
            raise HTTPException(status_code=400, detail="Staff number already in use")

    new_user = User(
        username=username,
        password=hashed_password,
        employee_name=user_data.employee_name,
        employee_type=employee_type,
        staff_no=sn,
    )
    db.add(new_user)
    db.flush()  # Get the user ID
    
    # Staff users get a linked EmployeeSkills row (roster/solver profile)
    if employee_type == EmployeeType.STAFF:
        employee_skills = EmployeeSkills(
            name=user_data.employee_name,
            user_id=new_user.id,
            skill_M=True,
            skill_IP=True,
            skill_A=True,
            skill_N=True,
            skill_M3=True,
            skill_M4=True,
            skill_H=False,
            skill_CL=True,
            skill_MS=True,
            min_days_off=4,
            weight=1.0,
            pending_off=0.0
        )
        db.add(employee_skills)
    
    db.commit()
    return {"message": "User created successfully. Staff accounts receive a roster skills profile automatically."}


@router.put("/")
async def update_user(
    update: UserUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a user account (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update users")
    
    # Validate username is provided
    if not update.username or not update.username.strip():
        raise HTTPException(status_code=400, detail="Username is required and cannot be empty")
    
    # Validate employee_name is provided
    if not update.employee_name or not update.employee_name.strip():
        raise HTTPException(status_code=400, detail="Employee name is required and cannot be empty")
    
    # Find user by old_username if provided, otherwise by generated username from employee_name
    if update.old_username:
        user = db.query(User).filter(User.username == update.old_username).first()
    else:
        generated_username = re.sub(r'\s+', '_', update.employee_name.strip().lower())
        user = db.query(User).filter(User.username == generated_username).first()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if new username is already taken (if username is being changed)
    new_username = update.username.strip().lower()
    
    if new_username != user.username:
        existing_user = db.query(User).filter(User.username == new_username).first()
        if existing_user and existing_user.id != user.id:
            raise HTTPException(status_code=400, detail="Username already exists. Please choose a different username.")
        user.username = new_username
    
    # Store old employee name before updating (needed to update committed schedules)
    old_employee_name = user.employee_name
    new_employee_name = update.employee_name.strip()
    user.employee_name = new_employee_name
    
    # If employee name changed, update all committed schedules and metrics
    if old_employee_name != new_employee_name:
        apply_display_name_change_cascade(db, old_employee_name, new_employee_name)
    old_type = user.employee_type
    user.employee_type = EmployeeType.MANAGER if update.employee_type == 'Manager' else EmployeeType.STAFF
    if update.password:
        # Hash the password before storing
        user.password = hash_password(update.password)

    update_payload = update.model_dump(exclude_unset=True)
    if "staff_no" in update_payload:
        sn = normalize_staff_no(update_payload["staff_no"])
        if sn:
            conflict = db.query(User).filter(User.staff_no == sn, User.id != user.id).first()
            if conflict:
                raise HTTPException(status_code=400, detail="Staff number already in use")
        user.staff_no = sn
    
    # Auto-create/update employee_skills for staff users
    if user.employee_type == EmployeeType.STAFF:
        employee_skills = db.query(EmployeeSkills).filter(EmployeeSkills.user_id == user.id).first()
        if not employee_skills:
            # Create employee_skills with default values
            employee_skills = EmployeeSkills(
                name=user.employee_name,
                user_id=user.id,
                skill_M=True,
                skill_IP=True,
                skill_A=True,
                skill_N=True,
                skill_M3=True,
                skill_M4=True,
                skill_H=False,
                skill_CL=True,
                skill_MS=True,
                min_days_off=4,
                weight=1.0,
                pending_off=0.0
            )
            db.add(employee_skills)
        else:
            # Update name if it changed
            employee_skills.name = user.employee_name
            # Update pending_off if provided
            if update.pending_off is not None:
                employee_skills.pending_off = float(update.pending_off)
    elif old_type == EmployeeType.STAFF and user.employee_type == EmployeeType.MANAGER:
        # Remove employee_skills if user changed from Staff to Manager
        employee_skills = db.query(EmployeeSkills).filter(EmployeeSkills.user_id == user.id).first()
        if employee_skills:
            db.delete(employee_skills)
    
    db.commit()
    return {"message": "User account updated successfully"}


@router.delete("/{username}")
async def delete_user(
    username: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a user account (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can delete users")
    
    # Prevent deleting your own account
    if username == current_user['username']:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Delete associated employee_skills if exists
    employee_skills = db.query(EmployeeSkills).filter(EmployeeSkills.user_id == user.id).first()
    if employee_skills:
        db.delete(employee_skills)
    
    db.delete(user)
    db.commit()
    return {"message": f"User account {username} deleted successfully"}
