"""Authentication endpoints."""

from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
from sqlalchemy.orm import Session
import json

from backend.database import get_db
from backend.models import User, EmployeeType
from backend.utils import verify_password, hash_password, needs_rehash, create_access_token, verify_token
from datetime import timedelta

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
    """Get current authenticated user from JWT token."""
    token = credentials.credentials
    
    # Try to verify as JWT token first
    payload = verify_token(token)
    
    if payload:
        # Valid JWT token
        username = payload.get("sub")  # subject (username)
        if not username:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token format"
            )
        
        # Get user from database to ensure they still exist
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )
        
        return {
            'username': user.username,
            'employee_name': user.employee_name,
            'employee_type': user.employee_type.value,
            'id': user.id
        }
    else:
        # Fallback: check if it's a legacy username token (for backwards compatibility)
        # This allows old tokens to still work during migration
        username = token
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
    
    # Check password (supports both plain text for migration and hashed)
    if not verify_password(request.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    
    # Auto-upgrade plain text passwords to hashed on login
    if needs_rehash(user.password):
        user.password = hash_password(request.password)
        db.commit()
    
    # Create JWT access token
    # Use longer expiration if remember_me is checked
    expires_delta = timedelta(days=30) if request.remember_me else timedelta(days=7)
    
    token_data = {
        "sub": user.username,  # subject (username)
        "employee_name": user.employee_name,
        "employee_type": user.employee_type.value,
        "id": user.id
    }
    access_token = create_access_token(data=token_data, expires_delta=expires_delta)
    
    # Save login state if remember_me is checked (legacy support)
    if request.remember_me:
        save_login_state(request.username)
    
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
    
    # Verify current password (supports both plain text and hashed)
    if not verify_password(request.current_password, user.password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect"
        )
    
    # Hash the new password before storing
    user.password = hash_password(request.new_password)
    db.commit()
    return {"message": "Password updated successfully"}
