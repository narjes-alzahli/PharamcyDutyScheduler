"""Leave types management endpoints (admin only)."""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import LeaveType
from backend.routers.auth import get_current_user

router = APIRouter()


class LeaveTypeCreate(BaseModel):
    code: str
    description: str
    color_hex: str = "#F5F5F5"
    counts_as_rest: bool = True
    is_active: bool = True


class LeaveTypeUpdate(BaseModel):
    description: Optional[str] = None
    color_hex: Optional[str] = None
    counts_as_rest: Optional[bool] = None
    is_active: Optional[bool] = None


class LeaveTypeResponse(BaseModel):
    id: int
    code: str
    description: str
    color_hex: str
    counts_as_rest: bool
    is_active: bool

    class Config:
        from_attributes = True


@router.get("/", response_model=List[LeaveTypeResponse])
async def get_leave_types(
    active_only: bool = False,
    db: Session = Depends(get_db)
):
    """Get all leave types."""
    query = db.query(LeaveType)
    if active_only:
        query = query.filter(LeaveType.is_active == True)
    leave_types = query.order_by(LeaveType.code).all()
    return leave_types


@router.get("/{code}", response_model=LeaveTypeResponse)
async def get_leave_type(
    code: str,
    db: Session = Depends(get_db)
):
    """Get a specific leave type by code."""
    leave_type = db.query(LeaveType).filter(LeaveType.code == code).first()
    if not leave_type:
        raise HTTPException(status_code=404, detail="Leave type not found")
    return leave_type


@router.post("/", response_model=LeaveTypeResponse)
async def create_leave_type(
    leave_type: LeaveTypeCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new leave type (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can create leave types")
    
    # Check if code already exists
    existing = db.query(LeaveType).filter(LeaveType.code == leave_type.code).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Leave type with code '{leave_type.code}' already exists")
    
    # Validate code format (alphanumeric, uppercase)
    if not leave_type.code.isalnum() or not leave_type.code.isupper():
        raise HTTPException(
            status_code=400,
            detail="Leave type code must be uppercase alphanumeric (e.g., 'AL', 'ML', 'STL')"
        )
    
    new_leave_type = LeaveType(
        code=leave_type.code,
        description=leave_type.description,
        color_hex=leave_type.color_hex,
        counts_as_rest=leave_type.counts_as_rest,
        is_active=leave_type.is_active
    )
    
    db.add(new_leave_type)
    db.commit()
    db.refresh(new_leave_type)
    
    return new_leave_type


@router.put("/{code}", response_model=LeaveTypeResponse)
async def update_leave_type(
    code: str,
    update: LeaveTypeUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a leave type (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update leave types")
    
    leave_type = db.query(LeaveType).filter(LeaveType.code == code).first()
    if not leave_type:
        raise HTTPException(status_code=404, detail="Leave type not found")
    
    if update.description is not None:
        leave_type.description = update.description
    if update.color_hex is not None:
        leave_type.color_hex = update.color_hex
    if update.counts_as_rest is not None:
        leave_type.counts_as_rest = update.counts_as_rest
    if update.is_active is not None:
        leave_type.is_active = update.is_active
    
    db.commit()
    db.refresh(leave_type)
    
    return leave_type


@router.delete("/{code}")
async def delete_leave_type(
    code: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a leave type (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can delete leave types")
    
    leave_type = db.query(LeaveType).filter(LeaveType.code == code).first()
    if not leave_type:
        raise HTTPException(status_code=404, detail="Leave type not found")
    
    # Check if there are any leave requests using this type
    if leave_type.leave_requests:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete leave type '{code}' because it is used by {len(leave_type.leave_requests)} leave request(s). Deactivate it instead."
        )
    
    db.delete(leave_type)
    db.commit()
    
    return {"message": f"Leave type '{code}' deleted successfully"}

