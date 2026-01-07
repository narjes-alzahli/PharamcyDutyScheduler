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
from backend.utils import verify_password, hash_password, needs_rehash, create_access_token, create_refresh_token, verify_token, verify_refresh_token, decode_token_without_verification

router = APIRouter()
security = HTTPBearer()

# Rate limiting for login (in-memory store)
# Format: {ip_address: [list of attempt timestamps]}
login_attempts = defaultdict(list)

# Token blacklist for revoked tokens (in-memory store)
# Format: {token: expiration_timestamp}
# Tokens are stored until they expire naturally
token_blacklist = {}

def check_login_rate_limit(request: Request) -> None:
    """Check if failed login attempts exceed rate limit (5 per minute per IP)."""
    # Safely get client IP - request.client is a tuple (host, port)
    client_ip = "unknown"
    if request.client:
        if isinstance(request.client, tuple) and len(request.client) > 0:
            client_ip = request.client[0]
        elif hasattr(request.client, 'host'):
            client_ip = request.client.host
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
    # Safely get client IP - request.client is a tuple (host, port)
    client_ip = "unknown"
    if request.client:
        if isinstance(request.client, tuple) and len(request.client) > 0:
            client_ip = request.client[0]
        elif hasattr(request.client, 'host'):
            client_ip = request.client.host
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
    refresh_token: str
    user: UserResponse


def cleanup_expired_tokens():
    """Remove expired tokens from blacklist."""
    now = datetime.utcnow()
    expired_tokens = [
        token for token, exp in token_blacklist.items()
        if exp < now
    ]
    for token in expired_tokens:
        token_blacklist.pop(token, None)


def revoke_token(token: str, expiration_time: datetime):
    """Add token to blacklist until it expires."""
    cleanup_expired_tokens()  # Clean up old tokens first
    token_blacklist[token] = expiration_time


def is_token_revoked(token: str) -> bool:
    """Check if token is in blacklist."""
    cleanup_expired_tokens()
    if token in token_blacklist:
        # Check if token hasn't expired yet
        exp = token_blacklist[token]
        if exp > datetime.utcnow():
            return True  # Token is revoked and still valid
        else:
            # Token expired, remove from blacklist
            token_blacklist.pop(token, None)
    return False


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> dict:
    """Get current authenticated user from JWT token."""
    token = credentials.credentials
    
    # Check if token is revoked
    if is_token_revoked(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked"
        )
    
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
    # Safely get client IP - request.client is a tuple (host, port)
    client_ip = "unknown"
    if request.client:
        if isinstance(request.client, tuple) and len(request.client) > 0:
            client_ip = request.client[0]
        elif hasattr(request.client, 'host'):
            client_ip = request.client.host
    if client_ip in login_attempts:
        login_attempts[client_ip] = []
    
    # Auto-upgrade plain text passwords to hashed on login
    if needs_rehash(user.password):
        user.password = hash_password(login_data.password)
        db.commit()
    
    # Create JWT access token
    # Production standard: Short-lived access tokens (30 minutes default)
    # Note: remember_me doesn't extend access token - it's already short-lived
    # Refresh tokens handle long-term sessions
    token_data = {
        "sub": user.username,  # subject (username)
        "employee_name": user.employee_name,
        "employee_type": user.employee_type.value,
        "id": user.id
    }
    access_token = create_access_token(data=token_data)
    
    # Create refresh token (longer-lived, 30 days)
    refresh_token = create_refresh_token(data=token_data)
    
    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserResponse(
            username=user.username,
            employee_name=user.employee_name,
            employee_type=user.employee_type.value
        )
    )


@router.post("/logout")
async def logout(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    current_user: dict = Depends(get_current_user)
):
    """Logout endpoint - revokes the current token."""
    token = credentials.credentials
    
    # Get token expiration from payload (decode without verification to get exp even if expired)
    payload = decode_token_without_verification(token)
    if payload:
        # Get expiration time from token
        exp_timestamp = payload.get("exp")
        if exp_timestamp:
            # Convert Unix timestamp to datetime
            exp_time = datetime.utcfromtimestamp(exp_timestamp)
            # Only revoke if token hasn't expired yet
            if exp_time > datetime.utcnow():
                revoke_token(token, exp_time)
    
    # Clean up legacy login state file
    login_file = Path("roster/app/data/login_state.json")
    if login_file.exists():
        login_file.unlink()
    
    return {"message": "Logged out successfully. Token has been revoked."}


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class RefreshTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: UserResponse


@router.post("/refresh", response_model=RefreshTokenResponse)
async def refresh_token(
    request: RefreshTokenRequest,
    db: Session = Depends(get_db)
):
    """Refresh access token using refresh token."""
    refresh_token = request.refresh_token
    
    # Verify refresh token
    payload = verify_refresh_token(refresh_token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token"
        )
    
    # Check if refresh token is revoked
    if is_token_revoked(refresh_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has been revoked"
        )
    
    # Get user from database to ensure they still exist and get latest data
    username = payload.get("sub")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token format"
        )
    
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found"
        )
    
    # Create new tokens with latest user data (important: gets fresh employee_type)
    token_data = {
        "sub": user.username,
        "employee_name": user.employee_name,
        "employee_type": user.employee_type.value,  # Fresh data from database
        "id": user.id
    }
    
    # Create new access token (uses default 30 minutes from utils.py)
    # Production standard: Short-lived access tokens expire naturally, no need to revoke
    new_access_token = create_access_token(data=token_data)
    
    # Create new refresh token (30 days)
    # Production standard: Refresh token rotation - old refresh token is invalidated
    new_refresh_token = create_refresh_token(data=token_data)
    
    # Revoke old refresh token (refresh token rotation - production standard)
    # This ensures only the latest refresh token is valid
    payload_old = decode_token_without_verification(refresh_token)
    if payload_old:
        exp_timestamp = payload_old.get("exp")
        if exp_timestamp:
            exp_time = datetime.utcfromtimestamp(exp_timestamp)
            if exp_time > datetime.utcnow():
                revoke_token(refresh_token, exp_time)
    
    return RefreshTokenResponse(
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        user=UserResponse(
            username=user.username,
            employee_name=user.employee_name,
            employee_type=user.employee_type.value
        )
    )


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
