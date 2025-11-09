"""Authentication endpoints."""

from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from pathlib import Path
import json
from datetime import datetime
from typing import Optional

router = APIRouter()
security = HTTPBearer()


class LoginRequest(BaseModel):
    username: str
    password: str
    remember_me: bool = False


class UserResponse(BaseModel):
    username: str
    employee_name: str
    employee_type: str


class LoginResponse(BaseModel):
    access_token: str
    user: UserResponse


def get_user_data_file() -> Path:
    """Get path to user data file."""
    return Path("roster/app/data/user_data.json")


def load_user_data() -> dict:
    """Load user data from file."""
    user_data_file = get_user_data_file()
    if user_data_file.exists():
        try:
            with open(user_data_file, 'r') as f:
                content = f.read().strip()
                if content:
                    return json.loads(content)
        except (json.JSONDecodeError, ValueError):
            pass
    return {}


def save_user_data(user_data: dict):
    """Save user data to file."""
    user_data_file = get_user_data_file()
    user_data_file.parent.mkdir(parents=True, exist_ok=True)
    with open(user_data_file, 'w') as f:
        json.dump(user_data, f, indent=2)


def save_login_state(username: str):
    """Save login state to file."""
    login_file = Path("roster/app/data/login_state.json")
    login_file.parent.mkdir(parents=True, exist_ok=True)
    login_data = {
        'username': username,
        'timestamp': datetime.now().isoformat()
    }
    with open(login_file, 'w') as f:
        json.dump(login_data, f, indent=2)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Get current authenticated user from token."""
    # Simple token validation (in production, use JWT)
    username = credentials.credentials
    user_data = load_user_data()
    
    if username not in user_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )
    
    return user_data[username]


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Login endpoint."""
    user_data = load_user_data()
    
    # Initialize default admin if no users exist
    if not user_data:
        user_data = {
            'admin': {
                'username': 'admin',
                'password': 'admin123',
                'employee_type': 'Manager',
                'employee_name': 'Admin'
            }
        }
        save_user_data(user_data)
    
    # Check credentials
    if request.username not in user_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    
    user = user_data[request.username]
    if user['password'] != request.password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    
    # Save login state if remember_me is checked
    if request.remember_me:
        save_login_state(request.username)
    
    # Simple token (in production, use JWT)
    access_token = request.username
    
    return LoginResponse(
        access_token=access_token,
        user=UserResponse(
            username=user['username'],
            employee_name=user['employee_name'],
            employee_type=user['employee_type']
        )
    )


@router.post("/logout")
async def logout():
    """Logout endpoint."""
    login_file = Path("roster/app/data/login_state.json")
    if login_file.exists():
        login_file.unlink()
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    """Get current user information."""
    return UserResponse(
        username=current_user['username'],
        employee_name=current_user['employee_name'],
        employee_type=current_user['employee_type']
    )


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
async def change_password(
    request: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user)
):
    """Change user password."""
    user_data = load_user_data()
    username = current_user['username']
    
    if user_data[username]['password'] != request.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect"
        )
    
    user_data[username]['password'] = request.new_password
    save_user_data(user_data)
    
    return {"message": "Password updated successfully"}

