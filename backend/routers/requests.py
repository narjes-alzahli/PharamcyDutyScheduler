"""Staff requests endpoints (leave and shift requests)."""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime, date
from typing import Optional, Dict, Any
import sys
from sqlalchemy.orm import Session

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.routers.auth import get_current_user
from backend.database import get_db
from backend.models import (
    LeaveRequest as LeaveRequestModel,
    ShiftRequest as ShiftRequestModel,
    LeaveType,
    RequestStatus,
    User
)

router = APIRouter()
security = HTTPBearer()


class LeaveRequest(BaseModel):
    from_date: str
    to_date: str
    leave_type: str
    reason: Optional[str] = None


class ShiftRequest(BaseModel):
    from_date: str
    to_date: str
    shift: str
    request_type: str  # "Force (Must)" or "Forbid (Cannot)"
    reason: Optional[str] = None


# Helper functions to convert database models to JSON-compatible format
def leave_request_to_dict(req: LeaveRequestModel) -> Dict[str, Any]:
    """Convert database LeaveRequest model to JSON-compatible dict."""
    return {
        'request_id': f"LR_{req.id}",
        'employee': req.user.employee_name,
        'from_date': req.from_date.isoformat(),
        'to_date': req.to_date.isoformat(),
        'leave_type': req.leave_type.code,
        'reason': req.reason or '',
        'status': req.status.value,
        'submitted_at': req.submitted_at.isoformat() if req.submitted_at else datetime.now().isoformat(),
        'approved_by': req.approved_by,
        'approved_at': req.approved_at.isoformat() if req.approved_at else None,
    }


def shift_request_to_dict(req: ShiftRequestModel) -> Dict[str, Any]:
    """Convert database ShiftRequest model to JSON-compatible dict."""
    return {
        'request_id': f"SR_{req.id}",
        'employee': req.user.employee_name,
        'from_date': req.from_date.isoformat(),
        'to_date': req.to_date.isoformat(),
        'shift': req.shift,
        'force': req.force,
        'reason': req.reason or '',
        'status': req.status.value,
        'submitted_at': req.submitted_at.isoformat() if req.submitted_at else datetime.now().isoformat(),
        'approved_by': req.approved_by,
        'approved_at': req.approved_at.isoformat() if req.approved_at else None,
    }


def parse_request_id(request_id: str) -> Optional[int]:
    """Parse request ID from format 'LR_1' or 'SR_1' to integer."""
    try:
        if request_id.startswith('LR_'):
            return int(request_id.split('_')[1])
        elif request_id.startswith('SR_'):
            return int(request_id.split('_')[1])
    except (IndexError, ValueError):
        pass
    return None






@router.get("/leave")
async def get_leave_requests(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get leave requests for current user."""
    user = db.query(User).filter(User.employee_name == current_user['employee_name']).first()
    if not user:
        return []
    
    requests = db.query(LeaveRequestModel).filter(
        LeaveRequestModel.user_id == user.id
    ).order_by(LeaveRequestModel.submitted_at.desc()).all()
    return [leave_request_to_dict(req) for req in requests]


@router.post("/leave")
async def create_leave_request(
    request: LeaveRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new leave request."""
    # Validate dates
    from_date = date.fromisoformat(request.from_date)
    to_date = date.fromisoformat(request.to_date)
    
    if from_date > to_date:
        raise HTTPException(status_code=400, detail="From date cannot be after to date")
    
    user = db.query(User).filter(User.employee_name == current_user['employee_name']).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Find leave type
    leave_type = db.query(LeaveType).filter(LeaveType.code == request.leave_type).first()
    if not leave_type:
        raise HTTPException(status_code=400, detail=f"Leave type '{request.leave_type}' not found")
    
    new_request = LeaveRequestModel(
        user_id=user.id,
        leave_type_id=leave_type.id,
        from_date=from_date,
        to_date=to_date,
        reason=request.reason or '',
        status=RequestStatus.PENDING
    )
    db.add(new_request)
    db.commit()
    db.refresh(new_request)
    
    return {"message": "Leave request submitted successfully", "request": leave_request_to_dict(new_request)}


@router.put("/leave/{request_id}")
async def update_leave_request(
    request_id: str,
    update: LeaveRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update an existing leave request while it is pending."""
    db_id = parse_request_id(request_id)
    if not db_id:
        raise HTTPException(status_code=404, detail="Leave request not found")
    
    req = db.query(LeaveRequestModel).filter(LeaveRequestModel.id == db_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")

    # Check authorization
    if current_user['employee_type'] != 'Manager' and req.user.employee_name != current_user['employee_name']:
        raise HTTPException(status_code=403, detail="Not authorized to modify this request")

    if req.status != RequestStatus.PENDING:
        raise HTTPException(status_code=400, detail=f"Request is already {req.status.value}")

    from_date = date.fromisoformat(update.from_date)
    to_date = date.fromisoformat(update.to_date)
    if from_date > to_date:
        raise HTTPException(status_code=400, detail="From date cannot be after to date")

    # Update leave type if changed
    if update.leave_type != req.leave_type.code:
        leave_type = db.query(LeaveType).filter(LeaveType.code == update.leave_type).first()
        if not leave_type:
            raise HTTPException(status_code=400, detail=f"Leave type '{update.leave_type}' not found")
        req.leave_type_id = leave_type.id
    
    req.from_date = from_date
    req.to_date = to_date
    req.reason = update.reason or ''
    db.commit()
    db.refresh(req)

    return {"message": "Leave request updated successfully", "request": leave_request_to_dict(req)}


@router.delete("/leave/{request_id}")
async def delete_leave_request(
    request_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a pending leave request."""
    db_id = parse_request_id(request_id)
    if not db_id:
        raise HTTPException(status_code=404, detail="Leave request not found")
    
    req = db.query(LeaveRequestModel).filter(LeaveRequestModel.id == db_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")

    # Check authorization
    if current_user['employee_type'] != 'Manager' and req.user.employee_name != current_user['employee_name']:
        raise HTTPException(status_code=403, detail="Not authorized to delete this request")

    if req.status != RequestStatus.PENDING:
        raise HTTPException(status_code=400, detail=f"Request is already {req.status.value}")
    
    db.delete(req)
    db.commit()
    return {"message": "Leave request deleted successfully"}


@router.get("/shift")
async def get_shift_requests(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get shift requests for current user."""
    user = db.query(User).filter(User.employee_name == current_user['employee_name']).first()
    if not user:
        return []
    
    requests = db.query(ShiftRequestModel).filter(
        ShiftRequestModel.user_id == user.id
    ).order_by(ShiftRequestModel.submitted_at.desc()).all()
    return [shift_request_to_dict(req) for req in requests]


@router.post("/shift")
async def create_shift_request(
    request: ShiftRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new shift request."""
    # Validate dates
    from_date = date.fromisoformat(request.from_date)
    to_date = date.fromisoformat(request.to_date)

    if from_date > to_date:
        raise HTTPException(status_code=400, detail="From date cannot be after to date")

    force = request.request_type == "Force (Must)"
    
    # Try database first
    user = db.query(User).filter(User.employee_name == current_user['employee_name']).first()
    if user:
        new_request = ShiftRequestModel(
            user_id=user.id,
            shift=request.shift,
            from_date=from_date,
            to_date=to_date,
            force=force,
            reason=request.reason or '',
            status=RequestStatus.PENDING
        )
        db.add(new_request)
        db.commit()
        db.refresh(new_request)
        
        return {"message": "Shift request submitted successfully", "request": shift_request_to_dict(new_request)}
    return {"message": "Shift request submitted successfully", "request": new_request}


@router.put("/shift/{request_id}")
async def update_shift_request(
    request_id: str,
    update: ShiftRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update an existing shift request while it is pending."""
    # Try database first
    db_id = parse_request_id(request_id)
    if db_id:
        req = db.query(ShiftRequestModel).filter(ShiftRequestModel.id == db_id).first()
        if req:
            # Check authorization
            if current_user['employee_type'] != 'Manager' and req.user.employee_name != current_user['employee_name']:
                raise HTTPException(status_code=403, detail="Not authorized to modify this request")

            if req.status != RequestStatus.PENDING:
                raise HTTPException(status_code=400, detail=f"Request is already {req.status.value}")

            from_date = date.fromisoformat(update.from_date)
            to_date = date.fromisoformat(update.to_date)
            if from_date > to_date:
                raise HTTPException(status_code=400, detail="From date cannot be after to date")

            force = update.request_type == "Force (Must)"

            req.from_date = from_date
            req.to_date = to_date
            req.shift = update.shift
            req.force = force
            req.reason = update.reason or ''
            db.commit()
            db.refresh(req)
            
            return {"message": "Shift request updated successfully", "request": shift_request_to_dict(req)}
    return {"message": "Shift request updated successfully", "request": request}


@router.delete("/shift/{request_id}")
async def delete_shift_request(
    request_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a pending shift request."""
    # Try database first
    db_id = parse_request_id(request_id)
    if db_id:
        req = db.query(ShiftRequestModel).filter(ShiftRequestModel.id == db_id).first()
        if req:
            # Check authorization
            if current_user['employee_type'] != 'Manager' and req.user.employee_name != current_user['employee_name']:
                raise HTTPException(status_code=403, detail="Not authorized to delete this request")

            if req.status != RequestStatus.PENDING:
                raise HTTPException(status_code=400, detail=f"Request is already {req.status.value}")
            
            db.delete(req)
            db.commit()
            return {"message": "Shift request deleted successfully"}
    return {"message": "Shift request deleted successfully"}


@router.get("/leave/all")
async def get_all_leave_requests(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all leave requests (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can view all requests")
    
    # Try database first
    requests = db.query(LeaveRequestModel).order_by(LeaveRequestModel.submitted_at.desc()).all()
    return [leave_request_to_dict(req) for req in requests]


@router.get("/shift/all")
async def get_all_shift_requests(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all shift requests (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can view all requests")
    
    # Try database first
    requests = db.query(ShiftRequestModel).order_by(ShiftRequestModel.submitted_at.desc()).all()
    return [shift_request_to_dict(req) for req in requests]


@router.put("/leave/{request_id}/approve")
async def approve_leave_request(
    request_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Approve a leave request (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can approve requests")
    
    # Try database first
    db_id = parse_request_id(request_id)
    if db_id:
        req = db.query(LeaveRequestModel).filter(LeaveRequestModel.id == db_id).first()
        if req:
            if req.status != RequestStatus.PENDING:
                raise HTTPException(status_code=400, detail=f"Request is already {req.status.value}")
    
            req.status = RequestStatus.APPROVED
            req.approved_by = current_user['employee_name']
            req.approved_at = datetime.now()
            db.commit()
    
            # Add to time_off CSV (legacy integration)
            try:
                import pandas as pd
                time_off_file = Path("roster/app/data/time_off.csv")
                if time_off_file.exists():
                    time_off_df = pd.read_csv(time_off_file)
                else:
                    time_off_df = pd.DataFrame(columns=['employee', 'from_date', 'to_date', 'code'])
                
                existing = time_off_df[
                    (time_off_df['employee'] == req.user.employee_name) &
                    (time_off_df['from_date'] == req.from_date.isoformat()) &
                    (time_off_df['to_date'] == req.to_date.isoformat()) &
                    (time_off_df['code'] == req.leave_type.code)
                ]
                
                if existing.empty:
                    new_entry = pd.DataFrame([{
                        'employee': req.user.employee_name,
                        'from_date': req.from_date.isoformat(),
                        'to_date': req.to_date.isoformat(),
                        'code': req.leave_type.code
                    }])
                    time_off_df = pd.concat([time_off_df, new_entry], ignore_index=True)
                    time_off_file.parent.mkdir(parents=True, exist_ok=True)
                    time_off_df.to_csv(time_off_file, index=False)
            except Exception as e:
                print(f"Warning: Failed to add approved leave to roster: {e}")
            
            db.refresh(req)
            return {"message": "Leave request approved successfully", "request": leave_request_to_dict(req)}
    return {"message": "Leave request approved successfully", "request": request}


@router.put("/leave/{request_id}/reject")
async def reject_leave_request(
    request_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Reject a leave request (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can reject requests")
    
    # Try database first
    db_id = parse_request_id(request_id)
    if db_id:
        req = db.query(LeaveRequestModel).filter(LeaveRequestModel.id == db_id).first()
        if req:
            if req.status != RequestStatus.PENDING:
                raise HTTPException(status_code=400, detail=f"Request is already {req.status.value}")
    
            req.status = RequestStatus.REJECTED
            req.approved_by = current_user['employee_name']
            req.approved_at = datetime.now()
            db.commit()
            db.refresh(req)
            
            return {"message": "Leave request rejected", "request": leave_request_to_dict(req)}
    return {"message": "Leave request rejected", "request": request}


@router.put("/shift/{request_id}/approve")
async def approve_shift_request(
    request_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Approve a shift request (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can approve requests")
    
    # Try database first
    db_id = parse_request_id(request_id)
    if db_id:
        req = db.query(ShiftRequestModel).filter(ShiftRequestModel.id == db_id).first()
        if req:
            if req.status != RequestStatus.PENDING:
                raise HTTPException(status_code=400, detail=f"Request is already {req.status.value}")
    
            req.status = RequestStatus.APPROVED
            req.approved_by = current_user['employee_name']
            req.approved_at = datetime.now()
            db.commit()
    
            # Add to locks CSV (legacy integration)
            try:
                import pandas as pd
                locks_file = Path("roster/app/data/locks.csv")
                if locks_file.exists():
                    locks_df = pd.read_csv(locks_file)
                else:
                    locks_df = pd.DataFrame(columns=['employee', 'from_date', 'to_date', 'shift', 'force'])
                
                existing = locks_df[
                    (locks_df['employee'] == req.user.employee_name) &
                    (locks_df['from_date'] == req.from_date.isoformat()) &
                    (locks_df['to_date'] == req.to_date.isoformat()) &
                    (locks_df['shift'] == req.shift) &
                    (locks_df['force'] == req.force)
                ]
                
                if existing.empty:
                    new_entry = pd.DataFrame([{
                        'employee': req.user.employee_name,
                        'from_date': req.from_date.isoformat(),
                        'to_date': req.to_date.isoformat(),
                        'shift': req.shift,
                        'force': req.force
                    }])
                    locks_df = pd.concat([locks_df, new_entry], ignore_index=True)
                    locks_file.parent.mkdir(parents=True, exist_ok=True)
                    locks_df.to_csv(locks_file, index=False)
            except Exception as e:
                print(f"Warning: Failed to add approved shift to roster: {e}")
            
            db.refresh(req)
            return {"message": "Shift request approved successfully", "request": shift_request_to_dict(req)}
    return {"message": "Shift request approved successfully", "request": request}


@router.put("/shift/{request_id}/reject")
async def reject_shift_request(
    request_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Reject a shift request (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can reject requests")
    
    # Try database first
    db_id = parse_request_id(request_id)
    if db_id:
        req = db.query(ShiftRequestModel).filter(ShiftRequestModel.id == db_id).first()
        if req:
            if req.status != RequestStatus.PENDING:
                raise HTTPException(status_code=400, detail=f"Request is already {req.status.value}")
    
            req.status = RequestStatus.REJECTED
            req.approved_by = current_user['employee_name']
            req.approved_at = datetime.now()
            db.commit()
            db.refresh(req)
            
            return {"message": "Shift request rejected", "request": shift_request_to_dict(req)}
    return {"message": "Shift request rejected", "request": request}
