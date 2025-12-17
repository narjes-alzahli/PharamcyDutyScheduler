"""FastAPI backend server for staff rostering system."""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from datetime import datetime, timedelta
from collections import defaultdict
import sys
import os
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.routers import auth, data, solver, schedules, requests, users, leave_types, shift_types

app = FastAPI(
    title="Staff Rostering API",
    description="Backend API for staff rostering system",
    version="1.0.0"
)

# Rate limiting - protects all endpoints from DoS attacks
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Global rate limiting middleware for all /api/* routes
api_request_counts = defaultdict(list)

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Apply rate limiting to all API routes (1000 requests per minute per IP)."""
    try:
        if request.url.path.startswith("/api/"):
            # Safely get client IP
            client_ip = "unknown"
            if request.client:
                # request.client is a tuple (host, port) or None
                if isinstance(request.client, tuple) and len(request.client) > 0:
                    client_ip = request.client[0]
                elif hasattr(request.client, 'host'):
                    client_ip = request.client.host
            
            now = datetime.utcnow()
            
            # Initialize if not exists
            if client_ip not in api_request_counts:
                api_request_counts[client_ip] = []
            
            # Remove requests older than 1 minute
            api_request_counts[client_ip] = [
                req_time for req_time in api_request_counts[client_ip]
                if (now - req_time) < timedelta(minutes=1)
            ]
            
            # Check if limit exceeded (1000 requests per minute)
            if len(api_request_counts[client_ip]) >= 1000:
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Rate limit exceeded. Maximum 1000 requests per minute."}
                )
            
            # Record this request
            api_request_counts[client_ip].append(now)
        
        response = await call_next(request)
        return response
    except Exception as e:
        # Log error but don't break the request
        import logging
        logging.error(f"Error in rate_limit_middleware: {e}")
        # Continue with request even if rate limiting fails
        return await call_next(request)

# CORS configuration
dev_origins = [
    "http://localhost:3333",
    "http://127.0.0.1:3333",
]

# Production nginx website
production_nginx = "http://185.226.124.30:8502"

# Additional production origins from environment variable (optional)
# Set FRONTEND_ORIGIN=http://your-ip-or-hostname if you need more origins
additional_origins = os.getenv("FRONTEND_ORIGIN", "")

# Combine origins
allowed_origins = dev_origins.copy()
allowed_origins.append(production_nginx)  # Add your nginx website
if additional_origins:
    # Support multiple origins (comma-separated) or single origin
    extra_origins = [origin.strip() for origin in additional_origins.split(",") if origin.strip()]
    allowed_origins.extend(extra_origins)

# CORS middleware for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],  # Only methods we actually use
    allow_headers=["Content-Type", "Authorization"],  # Only headers we actually use
)

# Security
security = HTTPBearer()

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["authentication"])
app.include_router(data.router, prefix="/api/data", tags=["data"])
app.include_router(solver.router, prefix="/api/solver", tags=["solver"])
app.include_router(schedules.router, prefix="/api/schedules", tags=["schedules"])
app.include_router(requests.router, prefix="/api/requests", tags=["requests"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(leave_types.router, prefix="/api/leave-types", tags=["leave-types"])
app.include_router(shift_types.router, prefix="/api/shift-types", tags=["shift-types"])


@app.get("/")
@limiter.limit("1000/minute")
async def root(request: Request):
    """Root endpoint."""
    return {"message": "Staff Rostering API", "version": "1.0.0"}


@app.get("/api/health")
@limiter.limit("1000/minute")
async def health_check(request: Request):
    """Health check endpoint."""
    return {"status": "healthy"}

