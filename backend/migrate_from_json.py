"""Migrate existing JSON data to database."""

import json
from pathlib import Path
from datetime import datetime
from backend.database import SessionLocal
from backend.models import User, LeaveType, LeaveRequest, ShiftRequest, EmployeeType, RequestStatus
from backend.routers.auth import load_user_data
from backend.routers.requests import load_staff_requests


def migrate_users(db):
    """Migrate users from JSON to database."""
    user_data = load_user_data()
    
    for username, user_info in user_data.items():
        # Check if user already exists
        existing = db.query(User).filter(User.username == username).first()
        if existing:
            print(f"  User {username} already exists, skipping...")
            continue
        
        user = User(
            username=username,
            password=user_info.get('password', ''),
            employee_name=user_info.get('employee_name', username),
            employee_type=EmployeeType.MANAGER if user_info.get('employee_type') == 'Manager' else EmployeeType.STAFF
        )
        db.add(user)
        print(f"  Migrated user: {username}")
    
    db.commit()


def migrate_leave_requests(db):
    """Migrate leave requests from JSON to database."""
    requests_data = load_staff_requests()
    leave_requests = requests_data.get('leave_requests', [])
    
    for req in leave_requests:
        # Find user
        username = req.get('employee')
        if not username:
            continue
        
        user = db.query(User).filter(User.employee_name == username).first()
        if not user:
            print(f"  User {username} not found for leave request, skipping...")
            continue
        
        # Find leave type
        leave_type_code = req.get('leave_type', 'DO')
        leave_type = db.query(LeaveType).filter(LeaveType.code == leave_type_code).first()
        if not leave_type:
            print(f"  Leave type {leave_type_code} not found, skipping request...")
            continue
        
        # Check if request already exists (by dates and user)
        existing = db.query(LeaveRequest).filter(
            LeaveRequest.user_id == user.id,
            LeaveRequest.from_date == datetime.fromisoformat(req['from_date']).date(),
            LeaveRequest.to_date == datetime.fromisoformat(req['to_date']).date()
        ).first()
        
        if existing:
            continue
        
        status = RequestStatus.PENDING
        if req.get('status') == 'Approved':
            status = RequestStatus.APPROVED
        elif req.get('status') == 'Rejected':
            status = RequestStatus.REJECTED
        
        leave_request = LeaveRequest(
            user_id=user.id,
            leave_type_id=leave_type.id,
            from_date=datetime.fromisoformat(req['from_date']).date(),
            to_date=datetime.fromisoformat(req['to_date']).date(),
            reason=req.get('reason', ''),
            status=status,
            submitted_at=datetime.fromisoformat(req.get('submitted_at', datetime.now().isoformat())),
            approved_by=req.get('approved_by'),
            approved_at=datetime.fromisoformat(req['approved_at']).date() if req.get('approved_at') else None
        )
        db.add(leave_request)
        print(f"  Migrated leave request for {username}")
    
    db.commit()


def migrate_shift_requests(db):
    """Migrate shift requests from JSON to database."""
    requests_data = load_staff_requests()
    shift_requests = requests_data.get('shift_requests', [])
    
    for req in shift_requests:
        # Find user
        username = req.get('employee')
        if not username:
            continue
        
        user = db.query(User).filter(User.employee_name == username).first()
        if not user:
            print(f"  User {username} not found for shift request, skipping...")
            continue
        
        # Check if request already exists
        existing = db.query(ShiftRequest).filter(
            ShiftRequest.user_id == user.id,
            ShiftRequest.from_date == datetime.fromisoformat(req['from_date']).date(),
            ShiftRequest.to_date == datetime.fromisoformat(req['to_date']).date(),
            ShiftRequest.shift == req.get('shift')
        ).first()
        
        if existing:
            continue
        
        status = RequestStatus.PENDING
        if req.get('status') == 'Approved':
            status = RequestStatus.APPROVED
        elif req.get('status') == 'Rejected':
            status = RequestStatus.REJECTED
        
        shift_request = ShiftRequest(
            user_id=user.id,
            shift=req.get('shift', 'M'),
            from_date=datetime.fromisoformat(req['from_date']).date(),
            to_date=datetime.fromisoformat(req['to_date']).date(),
            force=req.get('force', True),
            reason=req.get('reason', ''),
            status=status,
            submitted_at=datetime.fromisoformat(req.get('submitted_at', datetime.now().isoformat())),
            approved_by=req.get('approved_by'),
            approved_at=datetime.fromisoformat(req['approved_at']).date() if req.get('approved_at') else None
        )
        db.add(shift_request)
        print(f"  Migrated shift request for {username}")
    
    db.commit()


def migrate_all():
    """Migrate all data from JSON files to database."""
    print("🔄 Starting migration from JSON to database...")
    
    db = SessionLocal()
    try:
        print("\n📦 Migrating users...")
        migrate_users(db)
        
        print("\n📦 Migrating leave requests...")
        migrate_leave_requests(db)
        
        print("\n📦 Migrating shift requests...")
        migrate_shift_requests(db)
        
        print("\n✅ Migration completed successfully!")
    except Exception as e:
        db.rollback()
        print(f"\n❌ Error during migration: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    migrate_all()

