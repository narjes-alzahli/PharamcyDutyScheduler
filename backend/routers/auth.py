"""Authentication endpoints."""

from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import User, EmployeeType

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


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> dict:
    """Get current authenticated user from token."""
    username = credentials.credentials
    
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )
    
    return {
        'username': user.username,
        'employee_name': user.employee_name,
        'employee_type': user.employee_type.value,
        'id': user.id
    }


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    """Login endpoint."""
    user = db.query(User).filter(User.username == request.username).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    
    # Check password
    if user.password != request.password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    
    # Save login state if remember_me is checked
    if request.remember_me:
        save_login_state(request.username)
    
    access_token = request.username
    
    return LoginResponse(
        access_token=access_token,
        user=UserResponse(
            username=user.username,
            employee_name=user.employee_name,
            employee_type=user.employee_type.value
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
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Change user password."""
    username = current_user['username']
    
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    if user.password != request.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect"
        )
    
    user.password = request.new_password
    db.commit()
    return {"message": "Password updated successfully"}
