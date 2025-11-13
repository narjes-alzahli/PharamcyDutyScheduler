"""Utility functions for the application."""

import bcrypt


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

