"""Shift types management endpoints (admin only)."""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import ShiftType
from backend.routers.auth import get_current_user

router = APIRouter()


class ShiftTypeCreate(BaseModel):
    code: str
    description: str
    color_hex: str = "#E5E7EB"
    is_working_shift: bool = True
    is_active: bool = True


class ShiftTypeUpdate(BaseModel):
    description: Optional[str] = None
    color_hex: Optional[str] = None
    is_working_shift: Optional[bool] = None
    is_active: Optional[bool] = None


class ShiftTypeResponse(BaseModel):
    id: int
    code: str
    description: str
    color_hex: str
    is_working_shift: bool
    is_active: bool

    class Config:
        from_attributes = True


@router.get("/", response_model=List[ShiftTypeResponse])
async def get_shift_types(
    active_only: bool = False,
    working_only: bool = False,
    db: Session = Depends(get_db)
):
    """Get all shift types."""
    query = db.query(ShiftType)
    if active_only:
        query = query.filter(ShiftType.is_active == True)
    if working_only:
        query = query.filter(ShiftType.is_working_shift == True)
    shift_types = query.order_by(ShiftType.code).all()
    return shift_types


@router.get("/{code}", response_model=ShiftTypeResponse)
async def get_shift_type(
    code: str,
    db: Session = Depends(get_db)
):
    """Get a specific shift type by code."""
    shift_type = db.query(ShiftType).filter(ShiftType.code == code).first()
    if not shift_type:
        raise HTTPException(status_code=404, detail="Shift type not found")
    return shift_type


@router.post("/", response_model=ShiftTypeResponse)
async def create_shift_type(
    shift_type: ShiftTypeCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new shift type (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can create shift types")
    
    # Check if code already exists
    existing = db.query(ShiftType).filter(ShiftType.code == shift_type.code).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Shift type with code '{shift_type.code}' already exists")
    
    # Validate code format (alphanumeric, uppercase)
    if not shift_type.code.isalnum() or not shift_type.code.isupper():
        raise HTTPException(
            status_code=400,
            detail="Shift type code must be uppercase alphanumeric (e.g., 'M', 'IP', 'A', 'N')"
        )
    
    new_shift_type = ShiftType(
        code=shift_type.code,
        description=shift_type.description,
        color_hex=shift_type.color_hex,
        is_working_shift=shift_type.is_working_shift,
        is_active=shift_type.is_active
    )
    
    db.add(new_shift_type)
    db.commit()
    db.refresh(new_shift_type)
    
    return new_shift_type


@router.put("/{code}", response_model=ShiftTypeResponse)
async def update_shift_type(
    code: str,
    update: ShiftTypeUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a shift type (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can update shift types")
    
    shift_type = db.query(ShiftType).filter(ShiftType.code == code).first()
    if not shift_type:
        raise HTTPException(status_code=404, detail="Shift type not found")
    
    if update.description is not None:
        shift_type.description = update.description
    if update.color_hex is not None:
        shift_type.color_hex = update.color_hex
    if update.is_working_shift is not None:
        shift_type.is_working_shift = update.is_working_shift
    if update.is_active is not None:
        shift_type.is_active = update.is_active
    
    db.commit()
    db.refresh(shift_type)
    
    return shift_type


@router.delete("/{code}")
async def delete_shift_type(
    code: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a shift type (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can delete shift types")
    
    shift_type = db.query(ShiftType).filter(ShiftType.code == code).first()
    if not shift_type:
        raise HTTPException(status_code=404, detail="Shift type not found")
    
    # Check if there are any shift requests using this type
    if shift_type.shift_requests:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete shift type '{code}' because it is used by {len(shift_type.shift_requests)} shift request(s). Deactivate it instead."
        )
    
    db.delete(shift_type)
    db.commit()
    
    return {"message": f"Shift type '{code}' deleted successfully"}

