"""FastAPI backend server for staff rostering system."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
import sys
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

# CORS middleware for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3333",
        "http://localhost:4000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3333",
        "http://127.0.0.1:4000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],  # React dev servers
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

