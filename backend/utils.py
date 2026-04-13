"""Utility functions for the application."""

import bcrypt
import jwt
from datetime import date, datetime, timedelta
from typing import Optional, Dict, Any
import math
import os
from dotenv import load_dotenv

load_dotenv()

# JWT Configuration
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production-please-use-strong-random-key")
REFRESH_SECRET_KEY = os.getenv("JWT_REFRESH_SECRET_KEY", SECRET_KEY + "-refresh")  # Different key for refresh tokens
ALGORITHM = "HS256"
# Production-standard token expiration times
ACCESS_TOKEN_EXPIRE_MINUTES = 30  # 30 minutes (short-lived, expires naturally)
REFRESH_TOKEN_EXPIRE_DAYS = 30  # 30 days (long-lived, rotated on refresh)


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    # Bcrypt has a 72-byte limit, truncate if necessary
    password_bytes = password.encode('utf-8')
    if len(password_bytes) > 72:
        password_bytes = password_bytes[:72]
    
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a hash."""
    # Handle legacy plain text passwords (for migration)
    # If password is not a bcrypt hash (doesn't start with $2b$), compare directly
    if not hashed_password.startswith("$2b$"):
        return plain_password == hashed_password
    
    # Otherwise, verify using bcrypt
    try:
        plain_bytes = plain_password.encode('utf-8')
        if len(plain_bytes) > 72:
            plain_bytes = plain_bytes[:72]
        hashed_bytes = hashed_password.encode('utf-8')
        return bcrypt.checkpw(plain_bytes, hashed_bytes)
    except Exception:
        # If verification fails, fall back to plain text comparison
        return plain_password == hashed_password


def needs_rehash(hashed_password: str) -> bool:
    """Check if a password hash needs to be rehashed (for migration from plain text)."""
    return not hashed_password.startswith("$2b$")


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire, "iat": datetime.utcnow()})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify and decode a JWT token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None  # Token expired
    except (jwt.InvalidTokenError, jwt.DecodeError, jwt.InvalidSignatureError):
        return None  # Invalid token
    except Exception:
        return None  # Any other error


def decode_token_without_verification(token: str) -> Optional[Dict[str, Any]]:
    """Decode JWT token without verification (to get expiration time for blacklist)."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], options={"verify_signature": False})
        return payload
    except (jwt.InvalidTokenError, jwt.DecodeError, jwt.InvalidSignatureError):
        return None
    except Exception:
        return None


def create_refresh_token(data: Dict[str, Any]) -> str:
    """Create a JWT refresh token (longer-lived)."""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "iat": datetime.utcnow(), "type": "refresh"})
    encoded_jwt = jwt.encode(to_encode, REFRESH_SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_refresh_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify and decode a refresh token."""
    try:
        payload = jwt.decode(token, REFRESH_SECRET_KEY, algorithms=[ALGORITHM])
        # Ensure it's a refresh token
        if payload.get("type") != "refresh":
            return None
        return payload
    except jwt.ExpiredSignatureError:
        return None  # Token expired
    except (jwt.InvalidTokenError, jwt.DecodeError, jwt.InvalidSignatureError):
        return None  # Invalid token
    except Exception:
        return None  # Any other error


def normalize_staff_no(value: Any) -> Optional[str]:
    """Trim staff number; empty string maps to None."""
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def sanitize_json_floats(obj: Any) -> Any:
    """Replace NaN/Inf with None so json.dumps / FastAPI never raises (e.g. pandas NaN from null metrics)."""
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: sanitize_json_floats(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_json_floats(v) for v in obj]
    return obj


def deep_json_safe(obj: Any) -> Any:
    """Recursively convert objects to JSON-safe values (numpy scalars, date keys, NaN).

    Used for solver job payloads where metrics may use date dict keys and DataFrame rows
    may contain numpy integers; ``jsonable_encoder`` alone can still fail on ``numpy.int64``.
    """
    try:
        import numpy as np
    except ImportError:  # pragma: no cover
        np = None  # type: ignore

    try:
        import pandas as pd
    except ImportError:  # pragma: no cover
        pd = None  # type: ignore

    if obj is None:
        return None

    if np is not None:
        if isinstance(obj, np.generic):
            return deep_json_safe(obj.item())
        if isinstance(obj, np.ndarray):
            return deep_json_safe(obj.tolist())

    if pd is not None and isinstance(obj, float) and pd.isna(obj):
        return None
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None

    if isinstance(obj, (datetime, date)):
        return obj.isoformat()

    if isinstance(obj, dict):
        out: Dict[Any, Any] = {}
        for k, v in obj.items():
            if isinstance(k, (datetime, date)):
                nk = k.isoformat()
            elif np is not None and isinstance(k, np.generic):
                nk = k.item()
            else:
                nk = k
            if not isinstance(nk, str):
                nk = str(nk)
            out[nk] = deep_json_safe(v)
        return out

    if isinstance(obj, (list, tuple)):
        return [deep_json_safe(x) for x in obj]

    return obj

