"""FastAPI backend server for staff rostering system."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
import sys
import os
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.routers import auth, data, solver, schedules, requests, users, leave_types

app = FastAPI(
    title="Staff Rostering API",
    description="Backend API for staff rostering system",
    version="1.0.0"
)

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


@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "Staff Rostering API", "version": "1.0.0"}


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}

