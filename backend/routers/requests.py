"""Staff requests endpoints (leave and shift requests)."""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime, date
from typing import Optional, Dict, Any
import sys
from sqlalchemy.orm import Session, joinedload

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.routers.auth import get_current_user
from backend.database import get_db
from backend.models import (
    LeaveRequest as LeaveRequestModel,
    ShiftRequest as ShiftRequestModel,
    LeaveType,
    ShiftType,
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
    employee: Optional[str] = None  # Optional: for managers updating "Added via Roster Generator" requests


class ShiftRequest(BaseModel):
    from_date: str
    to_date: str
    shift: str
    request_type: str  # "Must" or "Cannot" (also accepts legacy "Force (Must)" or "Forbid (Cannot)")
    reason: Optional[str] = None
    employee: Optional[str] = None  # Optional: for managers updating "Added via Roster Generator" requests


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
    # Handle cases where relationships might not be loaded or are None
    employee_name = req.user.employee_name if req.user else 'Unknown'
    shift_code = req.shift_type.code if req.shift_type else 'UNKNOWN'
    
    return {
        'request_id': f"SR_{req.id}",
        'employee': employee_name,
        'from_date': req.from_date.isoformat() if req.from_date else '',
        'to_date': req.to_date.isoformat() if req.to_date else '',
        'shift': shift_code,
        'force': req.force if req.force is not None else False,
        'reason': req.reason or '',
        'status': req.status.value if req.status else 'Pending',
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


def check_date_overlap(new_from: date, new_to: date, existing_from: date, existing_to: date) -> bool:
    """Check if two date ranges overlap."""
    return new_from <= existing_to and new_to >= existing_from


def check_request_overlaps(
    db: Session,
    user_id: int,
    from_date: date,
    to_date: date,
    exclude_leave_request_id: Optional[int] = None,
    exclude_shift_request_id: Optional[int] = None
) -> list:
    """Check for overlapping leave and shift requests (excluding rejected ones).
    
    Returns a list of conflict messages, empty if no conflicts.
    """
    conflicts = []
    
    # Check leave requests (excluding rejected and the one being updated)
    leave_requests = db.query(LeaveRequestModel).filter(
        LeaveRequestModel.user_id == user_id,
        LeaveRequestModel.status != RequestStatus.REJECTED
    ).all()
    
    for req in leave_requests:
        if exclude_leave_request_id and req.id == exclude_leave_request_id:
            continue
        if check_date_overlap(from_date, to_date, req.from_date, req.to_date):
            leave_type_code = req.leave_type.code if req.leave_type else 'Unknown'
            conflicts.append({
                'type': 'Leave',
                'code': leave_type_code,
                'from_date': req.from_date.isoformat(),
                'to_date': req.to_date.isoformat()
            })
    
    # Check shift requests (excluding rejected and the one being updated)
    shift_requests = db.query(ShiftRequestModel).options(
        joinedload(ShiftRequestModel.shift_type)
    ).filter(
        ShiftRequestModel.user_id == user_id,
        ShiftRequestModel.status != RequestStatus.REJECTED
    ).all()
    
    for req in shift_requests:
        if exclude_shift_request_id and req.id == exclude_shift_request_id:
            continue
        if check_date_overlap(from_date, to_date, req.from_date, req.to_date):
            shift_type_code = req.shift_type.code if req.shift_type else 'Unknown'
            conflicts.append({
                'type': 'Shift',
                'code': shift_type_code,
                'from_date': req.from_date.isoformat(),
                'to_date': req.to_date.isoformat()
            })
    
    return conflicts


def format_overlap_error(conflicts: list) -> str:
    """Format overlap conflicts into a detailed error message."""
    if not conflicts:
        return ""
    
    messages = ["You have existing requests that overlap with the requested date range:"]
    for conflict in conflicts:
        messages.append(
            f"- {conflict['type']} request ({conflict['code']}): "
            f"{conflict['from_date']} to {conflict['to_date']}"
        )
    
    return "\n".join(messages)






@router.get("/leave")
async def get_leave_requests(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get leave requests for current user. Excludes 'Added via Roster Generator' requests."""
    user = db.query(User).filter(User.employee_name == current_user['employee_name']).first()
    if not user:
        return []
    
    # Exclude "Added via Roster Generator" requests - those are admin-managed, not employee requests
    requests = db.query(LeaveRequestModel).filter(
        LeaveRequestModel.user_id == user.id,
        LeaveRequestModel.reason != 'Added via Roster Generator'
    ).order_by(LeaveRequestModel.submitted_at.desc()).all()
    return [leave_request_to_dict(req) for req in requests]


@router.post("/leave")
async def create_leave_request(
    request: LeaveRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new leave request."""
    # Validate dates - handle both YYYY-MM-DD and DD-MM-YYYY formats
    try:
        from_date = date.fromisoformat(request.from_date)
    except ValueError:
        # Try parsing DD-MM-YYYY format
        try:
            parts = request.from_date.split('-')
            if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                from_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid date format for from_date: '{request.from_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                )
        except (ValueError, IndexError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse from_date '{request.from_date}': {str(e)}"
            )
    
    try:
        to_date = date.fromisoformat(request.to_date)
    except ValueError:
        # Try parsing DD-MM-YYYY format
        try:
            parts = request.to_date.split('-')
            if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                to_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid date format for to_date: '{request.to_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                )
        except (ValueError, IndexError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse to_date '{request.to_date}': {str(e)}"
            )
    
    if from_date > to_date:
        raise HTTPException(status_code=400, detail="From date cannot be after to date")
    
    user = db.query(User).filter(User.employee_name == current_user['employee_name']).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check for overlapping requests
    conflicts = check_request_overlaps(db, user.id, from_date, to_date)
    if conflicts:
        error_message = format_overlap_error(conflicts)
        raise HTTPException(status_code=400, detail=error_message)
    
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
    import logging
    logger = logging.getLogger(__name__)
    print(f"🔵 [backend] update_leave_request called: request_id={request_id}, update={update}")
    logger.info(f"🔵 [backend] update_leave_request called: request_id={request_id}, update={update}")
    
    db_id = parse_request_id(request_id)
    print(f"📋 Parsed db_id: {db_id}")
    if not db_id:
        raise HTTPException(status_code=404, detail="Leave request not found")
    
    print(f"🔍 Querying database for LeaveRequestModel.id={db_id}")
    # Eagerly load relationships to avoid N+1 queries (like shift requests do)
    req = db.query(LeaveRequestModel).options(
        joinedload(LeaveRequestModel.user),
        joinedload(LeaveRequestModel.leave_type)
    ).filter(LeaveRequestModel.id == db_id).first()
    print(f"📊 Query result: req={req is not None}")
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")

    # Check authorization
    print(f"🔐 Checking authorization: user_type={current_user.get('employee_type')}, req_user={req.user.employee_name if req.user else 'None'}")
    if current_user['employee_type'] != 'Manager' and req.user.employee_name != current_user['employee_name']:
        raise HTTPException(status_code=403, detail="Not authorized to modify this request")
    print("✅ Authorization passed")

    # Allow managers to update "Added via Roster Generator" requests even if they're approved
    # Regular employee requests can only be updated while pending
    is_manager = current_user['employee_type'] == 'Manager'
    is_roster_generator_request = req.reason == 'Added via Roster Generator'
    
    if req.status != RequestStatus.PENDING and not (is_manager and is_roster_generator_request):
        raise HTTPException(status_code=400, detail=f"Request is already {req.status.value}")

    # Parse dates - handle both YYYY-MM-DD and DD-MM-YYYY formats
    try:
        from_date = date.fromisoformat(update.from_date)
    except ValueError:
        # Try parsing DD-MM-YYYY format
        try:
            parts = update.from_date.split('-')
            if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                from_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid date format for from_date: '{update.from_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                )
        except (ValueError, IndexError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse from_date '{update.from_date}': {str(e)}"
            )
    
    try:
        to_date = date.fromisoformat(update.to_date)
    except ValueError:
        # Try parsing DD-MM-YYYY format
        try:
            parts = update.to_date.split('-')
            if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                to_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid date format for to_date: '{update.to_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                )
        except (ValueError, IndexError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse to_date '{update.to_date}': {str(e)}"
            )
    
    if from_date > to_date:
        raise HTTPException(status_code=400, detail="From date cannot be after to date")

    # Only check for overlapping requests if dates have changed
    # If dates are unchanged, we're just updating other fields (leave_type, reason, etc.) and don't need overlap check
    dates_changed = req.from_date != from_date or req.to_date != to_date
    
    if dates_changed:
        # Check for overlapping requests (excluding the current request being updated)
        conflicts = check_request_overlaps(db, req.user_id, from_date, to_date, exclude_leave_request_id=req.id)
        if conflicts:
            error_message = format_overlap_error(conflicts)
            raise HTTPException(status_code=400, detail=error_message)

    # Update leave type if changed
    leave_type = db.query(LeaveType).filter(LeaveType.code == update.leave_type).first()
    if not leave_type:
        raise HTTPException(status_code=400, detail=f"Leave type '{update.leave_type}' not found")

    # Update employee/user if provided and user is a manager (for "Added via Roster Generator" requests)
    is_manager = current_user['employee_type'] == 'Manager'
    is_roster_generator_request = req.reason == 'Added via Roster Generator'
    if is_manager and is_roster_generator_request and update.employee:
        new_user = db.query(User).filter(User.employee_name == update.employee).first()
        if not new_user:
            raise HTTPException(status_code=400, detail=f"Employee '{update.employee}' not found")
        req.user_id = new_user.id
    
    print(f"💾 Updating request: from_date={from_date}, to_date={to_date}, leave_type_id={leave_type.id}")
    req.from_date = from_date
    req.to_date = to_date
    req.leave_type_id = leave_type.id
    req.reason = update.reason or ''
    
    print("💾 Committing to database...")
    db.commit()
    print("✅ Commit successful")
    
    # Use db.refresh like shift requests do (simpler and faster than full query reload)
    db.refresh(req)
    print("✅ Refresh successful")

    print(f"🟢 [backend] update_leave_request completed successfully: request_id={request_id}")
    logger.info(f"🟢 [backend] update_leave_request completed successfully: request_id={request_id}")
    return {"message": "Leave request updated successfully", "request": leave_request_to_dict(req)}


@router.delete("/leave/{request_id}")
async def delete_leave_request(
    request_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a leave request. Managers can delete any request, employees can only delete their own pending requests."""
    db_id = parse_request_id(request_id)
    if not db_id:
        raise HTTPException(status_code=404, detail="Leave request not found")
    
    req = db.query(LeaveRequestModel).filter(LeaveRequestModel.id == db_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")

    # Check authorization
    is_manager = current_user['employee_type'] == 'Manager'
    is_owner = req.user.employee_name == current_user['employee_name']
    
    if not is_manager and not is_owner:
        raise HTTPException(status_code=403, detail="Not authorized to delete this request")

    # Employees can only delete their own pending requests
    # Managers can delete any request (pending or approved)
    if not is_manager and req.status != RequestStatus.PENDING:
        raise HTTPException(status_code=400, detail=f"Request is already {req.status.value}. Only managers can delete approved requests.")
    
    db.delete(req)
    db.commit()
    return {"message": "Leave request deleted successfully"}


@router.get("/shift")
async def get_shift_requests(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get shift requests for current user. Excludes 'Added via Roster Generator' requests."""
    user = db.query(User).filter(User.employee_name == current_user['employee_name']).first()
    if not user:
        return []
    
    # Exclude "Added via Roster Generator" requests - those are admin-managed, not employee requests
    requests = db.query(ShiftRequestModel).options(
        joinedload(ShiftRequestModel.shift_type),
        joinedload(ShiftRequestModel.user)
    ).filter(
        ShiftRequestModel.user_id == user.id,
        ShiftRequestModel.reason != 'Added via Roster Generator'
    ).order_by(ShiftRequestModel.submitted_at.desc()).all()
    return [shift_request_to_dict(req) for req in requests]


@router.post("/shift")
async def create_shift_request(
    request: ShiftRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new shift request."""
    # Validate dates - handle both YYYY-MM-DD and DD-MM-YYYY formats
    try:
        from_date = date.fromisoformat(request.from_date)
    except ValueError:
        # Try parsing DD-MM-YYYY format
        try:
            parts = request.from_date.split('-')
            if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                from_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid date format for from_date: '{request.from_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                )
        except (ValueError, IndexError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse from_date '{request.from_date}': {str(e)}"
            )
    
    try:
        to_date = date.fromisoformat(request.to_date)
    except ValueError:
        # Try parsing DD-MM-YYYY format
        try:
            parts = request.to_date.split('-')
            if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                to_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid date format for to_date: '{request.to_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                )
        except (ValueError, IndexError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse to_date '{request.to_date}': {str(e)}"
            )

    if from_date > to_date:
        raise HTTPException(status_code=400, detail="From date cannot be after to date")

    force = request.request_type == "Must" or request.request_type == "Force (Must)"  # Support both new and legacy formats
    
    user = db.query(User).filter(User.employee_name == current_user['employee_name']).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check for overlapping requests
    conflicts = check_request_overlaps(db, user.id, from_date, to_date)
    if conflicts:
        error_message = format_overlap_error(conflicts)
        raise HTTPException(status_code=400, detail=error_message)
    
    # Find shift type by code
    shift_type = db.query(ShiftType).filter(ShiftType.code == request.shift).first()
    if not shift_type:
        raise HTTPException(status_code=400, detail=f"Shift type '{request.shift}' not found")
    
    new_request = ShiftRequestModel(
        user_id=user.id,
        shift_type_id=shift_type.id,
        from_date=from_date,
        to_date=to_date,
        force=force,
        reason=request.reason or '',
        status=RequestStatus.PENDING
    )
    db.add(new_request)
    db.commit()
    db.refresh(new_request)
    # Reload with relationships for serialization
    new_request = db.query(ShiftRequestModel).options(
        joinedload(ShiftRequestModel.shift_type),
        joinedload(ShiftRequestModel.user)
    ).filter(ShiftRequestModel.id == new_request.id).first()
    
    return {"message": "Shift request submitted successfully", "request": shift_request_to_dict(new_request)}


@router.put("/shift/{request_id}")
async def update_shift_request(
    request_id: str,
    update: ShiftRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update an existing shift request while it is pending."""
    db_id = parse_request_id(request_id)
    if not db_id:
        raise HTTPException(status_code=404, detail="Shift request not found")
    
    req = db.query(ShiftRequestModel).options(
        joinedload(ShiftRequestModel.shift_type),
        joinedload(ShiftRequestModel.user)
    ).filter(ShiftRequestModel.id == db_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Shift request not found")

    # Check authorization
    if current_user['employee_type'] != 'Manager' and req.user.employee_name != current_user['employee_name']:
        raise HTTPException(status_code=403, detail="Not authorized to modify this request")

    # Allow managers to update "Added via Roster Generator" requests even if they're approved
    # Regular employee requests can only be updated while pending
    is_manager = current_user['employee_type'] == 'Manager'
    is_roster_generator_request = req.reason == 'Added via Roster Generator'
    
    if req.status != RequestStatus.PENDING and not (is_manager and is_roster_generator_request):
        raise HTTPException(status_code=400, detail=f"Request is already {req.status.value}")

    # Parse dates - handle both YYYY-MM-DD and DD-MM-YYYY formats
    try:
        from_date = date.fromisoformat(update.from_date)
    except ValueError:
        # Try parsing DD-MM-YYYY format
        try:
            parts = update.from_date.split('-')
            if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                from_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid date format for from_date: '{update.from_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                )
        except (ValueError, IndexError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse from_date '{update.from_date}': {str(e)}"
            )
    
    try:
        to_date = date.fromisoformat(update.to_date)
    except ValueError:
        # Try parsing DD-MM-YYYY format
        try:
            parts = update.to_date.split('-')
            if len(parts) == 3 and len(parts[0]) == 2 and len(parts[2]) == 4:
                to_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid date format for to_date: '{update.to_date}'. Expected YYYY-MM-DD or DD-MM-YYYY."
                )
        except (ValueError, IndexError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse to_date '{update.to_date}': {str(e)}"
            )
    
    if from_date > to_date:
        raise HTTPException(status_code=400, detail="From date cannot be after to date")

    # Only check for overlapping requests if dates have changed
    # If dates are unchanged, we're just updating other fields (shift, force, etc.) and don't need overlap check
    dates_changed = req.from_date != from_date or req.to_date != to_date
    
    if dates_changed:
        # Check for overlapping requests (excluding the current request being updated)
        conflicts = check_request_overlaps(db, req.user_id, from_date, to_date, exclude_shift_request_id=req.id)
        if conflicts:
            error_message = format_overlap_error(conflicts)
            raise HTTPException(status_code=400, detail=error_message)

    force = update.request_type == "Must" or update.request_type == "Force (Must)"  # Support both new and legacy formats

    # Find shift type by code
    shift_type = db.query(ShiftType).filter(ShiftType.code == update.shift).first()
    if not shift_type:
        raise HTTPException(status_code=400, detail=f"Shift type '{update.shift}' not found")

    # Update employee/user if provided and user is a manager (for "Added via Roster Generator" requests)
    if is_manager and is_roster_generator_request and hasattr(update, 'employee') and update.employee:
        new_user = db.query(User).filter(User.employee_name == update.employee).first()
        if not new_user:
            raise HTTPException(status_code=400, detail=f"Employee '{update.employee}' not found")
        req.user_id = new_user.id

    req.from_date = from_date
    req.to_date = to_date
    req.shift_type_id = shift_type.id
    req.force = force
    req.reason = update.reason or ''
    db.commit()
    db.refresh(req)

    return {"message": "Shift request updated successfully", "request": shift_request_to_dict(req)}


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
        req = db.query(ShiftRequestModel).options(
            joinedload(ShiftRequestModel.shift_type),
            joinedload(ShiftRequestModel.user)
        ).filter(ShiftRequestModel.id == db_id).first()
        if req:
            # Check authorization
            if current_user['employee_type'] != 'Manager' and req.user.employee_name != current_user['employee_name']:
                raise HTTPException(status_code=403, detail="Not authorized to delete this request")

            # Allow managers to delete any status, employees can only delete pending requests
            if current_user['employee_type'] != 'Manager' and req.status != RequestStatus.PENDING:
                raise HTTPException(status_code=400, detail=f"Request is already {req.status.value}")
            
            db.delete(req)
            db.commit()
            return {"message": "Shift request deleted successfully"}
    
    raise HTTPException(status_code=404, detail="Shift request not found")


@router.get("/leave/all")
async def get_all_leave_requests(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all leave requests (managers only). Excludes 'Added via Roster Generator' requests."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can view all requests")
    
    # Get all requests except "Added via Roster Generator" (those are admin-managed, not employee requests)
    requests = db.query(LeaveRequestModel).filter(
        LeaveRequestModel.reason != 'Added via Roster Generator'
    ).order_by(LeaveRequestModel.submitted_at.desc()).all()
    return [leave_request_to_dict(req) for req in requests]


@router.get("/shift/all")
async def get_all_shift_requests(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all shift requests (managers only). Excludes 'Added via Roster Generator' requests."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can view all requests")
    
    try:
        # Get all requests except "Added via Roster Generator" (those are admin-managed, not employee requests)
        requests = db.query(ShiftRequestModel).options(
            joinedload(ShiftRequestModel.shift_type),
            joinedload(ShiftRequestModel.user)
        ).filter(
            ShiftRequestModel.reason != 'Added via Roster Generator'
        ).order_by(ShiftRequestModel.submitted_at.desc()).all()
        
        # Convert to dict with error handling
        result = []
        for req in requests:
            try:
                result.append(shift_request_to_dict(req))
            except Exception as e:
                # Log error but continue processing other requests
                import logging
                logging.error(f"Error converting shift request {req.id} to dict: {e}")
                # Skip this request or add a placeholder
                continue
        
        return result
    except Exception as e:
        import logging
        import traceback
        logging.error(f"Error in get_all_shift_requests: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to load shift requests: {str(e)}")


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
    
            db.refresh(req)
            return {"message": "Leave request approved successfully", "request": leave_request_to_dict(req)}
    
    raise HTTPException(status_code=404, detail="Leave request not found")


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
    
        raise HTTPException(status_code=404, detail="Leave request not found")


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
        req = db.query(ShiftRequestModel).options(
            joinedload(ShiftRequestModel.shift_type),
            joinedload(ShiftRequestModel.user)
        ).filter(ShiftRequestModel.id == db_id).first()
        if req:
            if req.status != RequestStatus.PENDING:
                raise HTTPException(status_code=400, detail=f"Request is already {req.status.value}")
    
            req.status = RequestStatus.APPROVED
            req.approved_by = current_user['employee_name']
            req.approved_at = datetime.now()
            db.commit()
    
            db.refresh(req)
            return {"message": "Shift request approved successfully", "request": shift_request_to_dict(req)}
    
    raise HTTPException(status_code=404, detail="Shift request not found")


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
        req = db.query(ShiftRequestModel).options(
            joinedload(ShiftRequestModel.shift_type),
            joinedload(ShiftRequestModel.user)
        ).filter(ShiftRequestModel.id == db_id).first()
        if req:
            if req.status != RequestStatus.PENDING:
                raise HTTPException(status_code=400, detail=f"Request is already {req.status.value}")
            
            req.status = RequestStatus.REJECTED
            req.approved_by = current_user['employee_name']
            req.approved_at = datetime.now()
            db.commit()
            db.refresh(req)
            
            return {"message": "Shift request rejected", "request": shift_request_to_dict(req)}
    
        raise HTTPException(status_code=404, detail="Shift request not found")
