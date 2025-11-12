"""Staff requests endpoints (leave and shift requests)."""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from pathlib import Path
import json
from datetime import datetime, date
from typing import List, Optional
import sys

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.routers.auth import get_current_user

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


def is_authorized_to_modify(request: dict, current_user: dict) -> bool:
    """Check if the current user can modify/delete the given request."""
    return (
        current_user['employee_type'] == 'Manager'
        or request.get('employee') == current_user['employee_name']
    )


def ensure_request_is_pending(request: dict):
    """Ensure the request is still pending."""
    if request.get('status') != 'Pending':
        raise HTTPException(
            status_code=400,
            detail=f"Request is already {request.get('status')}"
        )


def get_staff_requests_file() -> Path:
    """Get path to staff requests file."""
    return Path("roster/app/data/staff_requests.json")


def load_staff_requests() -> dict:
    """Load staff requests from file."""
    requests_file = get_staff_requests_file()
    if requests_file.exists():
        try:
            with open(requests_file, 'r') as f:
                content = f.read().strip()
                if content:
                    return json.loads(content)
        except (json.JSONDecodeError, ValueError):
            pass
    return {'leave_requests': [], 'shift_requests': []}


def save_staff_requests(requests: dict):
    """Save staff requests to file."""
    requests_file = get_staff_requests_file()
    requests_file.parent.mkdir(parents=True, exist_ok=True)
    with open(requests_file, 'w') as f:
        json.dump(requests, f, indent=2)


def generate_request_id(existing_requests: List[dict], prefix: str) -> str:
    """Generate a unique incremental request ID with the given prefix."""
    max_number = 0
    for req in existing_requests:
        req_id = req.get('request_id', '')
        if not req_id or not req_id.startswith(f"{prefix}_"):
            continue
        try:
            number = int(req_id.split('_')[1])
            if number > max_number:
                max_number = number
        except (IndexError, ValueError):
            continue
    return f"{prefix}_{max_number + 1}"


@router.get("/leave")
async def get_leave_requests(current_user: dict = Depends(get_current_user)):
    """Get leave requests for current user."""
    requests = load_staff_requests()
    user_requests = [
        req for req in requests.get('leave_requests', [])
        if req.get('employee') == current_user['employee_name']
    ]
    return user_requests


@router.post("/leave")
async def create_leave_request(
    request: LeaveRequest,
    current_user: dict = Depends(get_current_user)
):
    """Create a new leave request."""
    requests = load_staff_requests()
    
    # Validate dates
    from_date = date.fromisoformat(request.from_date)
    to_date = date.fromisoformat(request.to_date)
    
    if from_date > to_date:
        raise HTTPException(status_code=400, detail="The start date must be on or before the end date.")
    
    new_request = {
        'employee': current_user['employee_name'],
        'from_date': request.from_date,
        'to_date': request.to_date,
        'leave_type': request.leave_type,
        'reason': request.reason or '',
        'status': 'Pending',
        'submitted_at': datetime.now().isoformat(),
        'request_id': generate_request_id(requests.get('leave_requests', []), "LR")
    }
    
    requests['leave_requests'].append(new_request)
    save_staff_requests(requests)
    
    return {"message": "Leave request submitted successfully", "request": new_request}


@router.put("/leave/{request_id}")
async def update_leave_request(
    request_id: str,
    update: LeaveRequest,
    current_user: dict = Depends(get_current_user)
):
    """Update an existing leave request while it is pending."""
    requests = load_staff_requests()
    leave_requests = requests.get('leave_requests', [])

    request = next(
        (req for req in leave_requests if req.get('request_id') == request_id),
        None
    )
    if not request:
        raise HTTPException(status_code=404, detail="Leave request not found")

    if not is_authorized_to_modify(request, current_user):
        raise HTTPException(status_code=403, detail="Not authorized to modify this request")

    ensure_request_is_pending(request)

    from_date = date.fromisoformat(update.from_date)
    to_date = date.fromisoformat(update.to_date)

    if from_date > to_date:
        raise HTTPException(status_code=400, detail="The start date must be on or before the end date.")

    request['from_date'] = update.from_date
    request['to_date'] = update.to_date
    request['leave_type'] = update.leave_type
    request['reason'] = update.reason or ''
    request['updated_at'] = datetime.now().isoformat()

    save_staff_requests(requests)

    return {"message": "Leave request updated successfully", "request": request}


@router.delete("/leave/{request_id}")
async def delete_leave_request(
    request_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete a pending leave request."""
    requests = load_staff_requests()
    leave_requests = requests.get('leave_requests', [])

    index = next(
        (idx for idx, req in enumerate(leave_requests) if req.get('request_id') == request_id),
        None
    )
    if index is None:
        raise HTTPException(status_code=404, detail="Leave request not found")

    request = leave_requests[index]

    if not is_authorized_to_modify(request, current_user):
        raise HTTPException(status_code=403, detail="Not authorized to delete this request")

    ensure_request_is_pending(request)

    del leave_requests[index]
    requests['leave_requests'] = leave_requests
    save_staff_requests(requests)

    return {"message": "Leave request deleted successfully"}


@router.get("/shift")
async def get_shift_requests(current_user: dict = Depends(get_current_user)):
    """Get shift requests for current user."""
    requests = load_staff_requests()
    user_requests = [
        req for req in requests.get('shift_requests', [])
        if req.get('employee') == current_user['employee_name']
    ]
    return user_requests


@router.post("/shift")
async def create_shift_request(
    request: ShiftRequest,
    current_user: dict = Depends(get_current_user)
):
    """Create a new shift request."""
    requests = load_staff_requests()
    
    # Validate dates
    from_date = date.fromisoformat(request.from_date)
    to_date = date.fromisoformat(request.to_date)

    if from_date > to_date:
        raise HTTPException(status_code=400, detail="The start date must be on or before the end date.")

    force = request.request_type == "Force (Must)"
    
    new_request = {
        'employee': current_user['employee_name'],
        'from_date': request.from_date,
        'to_date': request.to_date,
        'shift': request.shift,
        'force': force,
        'reason': request.reason or '',
        'status': 'Pending',
        'submitted_at': datetime.now().isoformat(),
        'request_id': generate_request_id(requests.get('shift_requests', []), "SR")
    }
    
    requests['shift_requests'].append(new_request)
    save_staff_requests(requests)
    
    return {"message": "Shift request submitted successfully", "request": new_request}


@router.put("/shift/{request_id}")
async def update_shift_request(
    request_id: str,
    update: ShiftRequest,
    current_user: dict = Depends(get_current_user)
):
    """Update an existing shift request while it is pending."""
    requests = load_staff_requests()
    shift_requests = requests.get('shift_requests', [])

    request = next(
        (req for req in shift_requests if req.get('request_id') == request_id),
        None
    )
    if not request:
        raise HTTPException(status_code=404, detail="Shift request not found")

    if not is_authorized_to_modify(request, current_user):
        raise HTTPException(status_code=403, detail="Not authorized to modify this request")

    ensure_request_is_pending(request)

    from_date = date.fromisoformat(update.from_date)
    to_date = date.fromisoformat(update.to_date)

    if from_date > to_date:
        raise HTTPException(status_code=400, detail="The start date must be on or before the end date.")

    force = update.request_type == "Force (Must)"

    request['from_date'] = update.from_date
    request['to_date'] = update.to_date
    request['shift'] = update.shift
    request['force'] = force
    request['reason'] = update.reason or ''
    request['updated_at'] = datetime.now().isoformat()

    save_staff_requests(requests)

    return {"message": "Shift request updated successfully", "request": request}


@router.delete("/shift/{request_id}")
async def delete_shift_request(
    request_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete a pending shift request."""
    requests = load_staff_requests()
    shift_requests = requests.get('shift_requests', [])

    index = next(
        (idx for idx, req in enumerate(shift_requests) if req.get('request_id') == request_id),
        None
    )
    if index is None:
        raise HTTPException(status_code=404, detail="Shift request not found")

    request = shift_requests[index]

    if not is_authorized_to_modify(request, current_user):
        raise HTTPException(status_code=403, detail="Not authorized to delete this request")

    ensure_request_is_pending(request)

    del shift_requests[index]
    requests['shift_requests'] = shift_requests
    save_staff_requests(requests)

    return {"message": "Shift request deleted successfully"}


@router.get("/leave/all")
async def get_all_leave_requests(current_user: dict = Depends(get_current_user)):
    """Get all leave requests (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can view all requests")
    
    requests = load_staff_requests()
    return requests.get('leave_requests', [])


@router.get("/shift/all")
async def get_all_shift_requests(current_user: dict = Depends(get_current_user)):
    """Get all shift requests (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can view all requests")
    
    requests = load_staff_requests()
    return requests.get('shift_requests', [])


@router.put("/leave/{request_id}/approve")
async def approve_leave_request(
    request_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Approve a leave request (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can approve requests")
    
    requests = load_staff_requests()
    leave_requests = requests.get('leave_requests', [])
    
    request = next(
        (req for req in leave_requests if req.get('request_id') == request_id and req.get('status') == 'Pending'),
        None,
    )
    if request is None:
        request = next((req for req in leave_requests if req.get('request_id') == request_id), None)
    if not request:
        raise HTTPException(status_code=404, detail="Leave request not found")
    
    if request.get('status') != 'Pending':
        raise HTTPException(status_code=400, detail=f"Request is already {request.get('status')}")
    
    # Update request status
    request['status'] = 'Approved'
    request['approved_by'] = current_user['employee_name']
    request['approved_at'] = datetime.now().isoformat()
    
    save_staff_requests(requests)
    
    # Add approved leave to roster time_off data
    try:
        import pandas as pd
        time_off_file = Path("roster/app/data/time_off.csv")
        
        # Load existing time_off data
        if time_off_file.exists():
            time_off_df = pd.read_csv(time_off_file)
        else:
            time_off_df = pd.DataFrame(columns=['employee', 'from_date', 'to_date', 'code'])
        
        # Check if this entry already exists
        from_date_str = request['from_date']
        to_date_str = request['to_date']
        employee = request['employee']
        leave_type = request['leave_type']
        
        # Check for duplicates
        existing = time_off_df[
            (time_off_df['employee'] == employee) &
            (time_off_df['from_date'] == from_date_str) &
            (time_off_df['to_date'] == to_date_str) &
            (time_off_df['code'] == leave_type)
        ]
        
        if existing.empty:
            # Add new entry
            new_entry = pd.DataFrame([{
                'employee': employee,
                'from_date': from_date_str,
                'to_date': to_date_str,
                'code': leave_type
            }])
            time_off_df = pd.concat([time_off_df, new_entry], ignore_index=True)
            time_off_file.parent.mkdir(parents=True, exist_ok=True)
            time_off_df.to_csv(time_off_file, index=False)
    
    except Exception as e:
        # Log error but don't fail the approval
        print(f"Warning: Failed to add approved leave to roster: {e}")
    
    return {"message": "Leave request approved successfully", "request": request}


@router.put("/leave/{request_id}/reject")
async def reject_leave_request(
    request_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Reject a leave request (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can reject requests")
    
    requests = load_staff_requests()
    leave_requests = requests.get('leave_requests', [])
    
    request = next(
        (req for req in leave_requests if req.get('request_id') == request_id and req.get('status') == 'Pending'),
        None,
    )
    if request is None:
        request = next((req for req in leave_requests if req.get('request_id') == request_id), None)
    if not request:
        raise HTTPException(status_code=404, detail="Leave request not found")
    
    if request.get('status') != 'Pending':
        raise HTTPException(status_code=400, detail=f"Request is already {request.get('status')}")
    
    # Update request status
    request['status'] = 'Rejected'
    request['approved_by'] = current_user['employee_name']
    request['approved_at'] = datetime.now().isoformat()
    
    save_staff_requests(requests)
    
    return {"message": "Leave request rejected", "request": request}


@router.put("/shift/{request_id}/approve")
async def approve_shift_request(
    request_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Approve a shift request (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can approve requests")
    
    requests = load_staff_requests()
    shift_requests = requests.get('shift_requests', [])
    
    request = next(
        (req for req in shift_requests if req.get('request_id') == request_id and req.get('status') == 'Pending'),
        None,
    )
    if request is None:
        request = next((req for req in shift_requests if req.get('request_id') == request_id), None)
    if not request:
        raise HTTPException(status_code=404, detail="Shift request not found")
    
    if request.get('status') != 'Pending':
        raise HTTPException(status_code=400, detail=f"Request is already {request.get('status')}")
    
    # Update request status
    request['status'] = 'Approved'
    request['approved_by'] = current_user['employee_name']
    request['approved_at'] = datetime.now().isoformat()
    
    save_staff_requests(requests)
    
    # Add approved shift to roster locks data
    try:
        import pandas as pd
        locks_file = Path("roster/app/data/locks.csv")
        
        # Load existing locks data
        if locks_file.exists():
            locks_df = pd.read_csv(locks_file)
        else:
            locks_df = pd.DataFrame(columns=['employee', 'from_date', 'to_date', 'shift', 'force'])
        
        # Check if this entry already exists
        from_date_str = request['from_date']
        to_date_str = request.get('to_date', request['from_date'])  # Use from_date if to_date not set
        employee = request['employee']
        shift = request['shift']
        force = request.get('force', False)
        
        # Check for duplicates
        existing = locks_df[
            (locks_df['employee'] == employee) &
            (locks_df['from_date'] == from_date_str) &
            (locks_df['to_date'] == to_date_str) &
            (locks_df['shift'] == shift) &
            (locks_df['force'] == force)
        ]
        
        if existing.empty:
            # Add new entry
            new_entry = pd.DataFrame([{
                'employee': employee,
                'from_date': from_date_str,
                'to_date': to_date_str,
                'shift': shift,
                'force': force
            }])
            locks_df = pd.concat([locks_df, new_entry], ignore_index=True)
            locks_file.parent.mkdir(parents=True, exist_ok=True)
            locks_df.to_csv(locks_file, index=False)
    
    except Exception as e:
        # Log error but don't fail the approval
        print(f"Warning: Failed to add approved shift to roster: {e}")
    
    return {"message": "Shift request approved successfully", "request": request}


@router.put("/shift/{request_id}/reject")
async def reject_shift_request(
    request_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Reject a shift request (managers only)."""
    if current_user['employee_type'] != 'Manager':
        raise HTTPException(status_code=403, detail="Only managers can reject requests")
    
    requests = load_staff_requests()
    shift_requests = requests.get('shift_requests', [])
    
    request = next(
        (req for req in shift_requests if req.get('request_id') == request_id and req.get('status') == 'Pending'),
        None,
    )
    if request is None:
        request = next((req for req in shift_requests if req.get('request_id') == request_id), None)
    if not request:
        raise HTTPException(status_code=404, detail="Shift request not found")
    
    if request.get('status') != 'Pending':
        raise HTTPException(status_code=400, detail=f"Request is already {request.get('status')}")
    
    # Update request status
    request['status'] = 'Rejected'
    request['approved_by'] = current_user['employee_name']
    request['approved_at'] = datetime.now().isoformat()
    
    save_staff_requests(requests)
    
    return {"message": "Shift request rejected", "request": request}

