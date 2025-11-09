"""User management endpoints."""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from pathlib import Path
import json
from typing import List, Optional
import sys

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.routers.auth import get_current_user, load_user_data, save_user_data

router = APIRouter()
security = HTTPBearer()


class UserUpdate(BaseModel):
    employee_name: str
    password: Optional[str] = None
    employee_type: str


@router.get("/")
async def get_all_users(current_user: dict = Depends(get_current_user)):
    """Get all users (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can view users")
    
    user_data = load_user_data()
    
    users = []
    for username, user_info in user_data.items():
        users.append({
            'username': username,
            'employee_name': user_info['employee_name'],
            'employee_type': user_info['employee_type'],
            'password_hidden': '*' * len(user_info.get('password', ''))
        })
    
    return users


@router.put("/")
async def update_user(
    update: UserUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update a user account (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update users")
    
    user_data = load_user_data()
    import re
    username = re.sub(r'\s+', '_', update.employee_name.strip().lower())
    
    if username not in user_data:
        raise HTTPException(status_code=404, detail="User not found")
    
    if update.password:
        user_data[username]['password'] = update.password
    user_data[username]['employee_type'] = update.employee_type
    
    save_user_data(user_data)
    
    return {"message": "User account updated successfully"}


@router.delete("/{username}")
async def delete_user(
    username: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete a user account (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can delete users")
    
    user_data = load_user_data()
    
    # Prevent deleting your own account
    if username == current_user['username']:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    
    if username not in user_data:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Delete the user
    del user_data[username]
    save_user_data(user_data)
    
    return {"message": f"User account {username} deleted successfully"}

