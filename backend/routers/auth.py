"""Authentication endpoints."""

from fastapi import APIRouter, HTTPException, Depends, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
import json
from collections import defaultdict

from backend.database import get_db
from backend.models import User, EmployeeType
from backend.utils import verify_password, hash_password, needs_rehash, create_access_token, verify_token

router = APIRouter()
security = HTTPBearer()

# Rate limiting for login (in-memory store)
# Format: {ip_address: [list of attempt timestamps]}
login_attempts = defaultdict(list)

def check_login_rate_limit(request: Request) -> None:
    """Check if failed login attempts exceed rate limit (5 per minute per IP)."""
    client_ip = request.client.host if request.client else "unknown"
    now = datetime.utcnow()
    
    # Remove attempts older than 1 minute
    login_attempts[client_ip] = [
        attempt_time for attempt_time in login_attempts[client_ip]
        if (now - attempt_time) < timedelta(minutes=1)
    ]
    
    # Check if limit exceeded
    if len(login_attempts[client_ip]) >= 5:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please wait a minute and try again."
        )


def record_failed_login_attempt(request: Request) -> None:
    """Record a failed login attempt for rate limiting."""
    client_ip = request.client.host if request.client else "unknown"
    now = datetime.utcnow()
    login_attempts[client_ip].append(now)


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
async def login(request: Request, login_data: LoginRequest, db: Session = Depends(get_db)):
    """Login endpoint with rate limiting (max 5 failed attempts per minute)."""
    # Check rate limit before processing (checks for failed attempts)
    check_login_rate_limit(request)
    
    user = db.query(User).filter(User.username == login_data.username).first()
    
    # Check if user exists and password is correct
    login_failed = False
    if not user:
        login_failed = True
    elif not verify_password(login_data.password, user.password):
        login_failed = True
    
    # If login failed, record the attempt
    if login_failed:
        record_failed_login_attempt(request)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    
    # Successful login - clear failed attempts for this IP
    client_ip = request.client.host if request.client else "unknown"
    if client_ip in login_attempts:
        login_attempts[client_ip] = []
    
    # Auto-upgrade plain text passwords to hashed on login
    if needs_rehash(user.password):
        user.password = hash_password(login_data.password)
        db.commit()
    
    # Create JWT access token
    # Use longer expiration if remember_me is checked
    expires_delta = timedelta(days=30) if login_data.remember_me else timedelta(days=7)
    
    token_data = {
        "sub": user.username,  # subject (username)
        "employee_name": user.employee_name,
        "employee_type": user.employee_type.value,
        "id": user.id
    }
    access_token = create_access_token(data=token_data, expires_delta=expires_delta)
    
    # Save login state if remember_me is checked (legacy support)
    if login_data.remember_me:
        save_login_state(login_data.username)
    
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
