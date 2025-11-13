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
from backend.models import User, EmployeeType

router = APIRouter()
security = HTTPBearer()


class UserUpdate(BaseModel):
    employee_name: str
    password: Optional[str] = None
    employee_type: str


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
            'password_hidden': '*' * len(user.password) if user.password else ''
        })
    return users


@router.put("/")
async def update_user(
    update: UserUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a user account (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update users")
    
    username = re.sub(r'\s+', '_', update.employee_name.strip().lower())
    
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.employee_name = update.employee_name
    user.employee_type = EmployeeType.MANAGER if update.employee_type == 'Manager' else EmployeeType.STAFF
    if update.password:
        user.password = update.password
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
    
    db.delete(user)
    db.commit()
    return {"message": f"User account {username} deleted successfully"}
