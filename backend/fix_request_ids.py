"""
Script to verify and fix missing request_ids in the database.
This ensures all LeaveRequest and ShiftRequest records are properly loaded.
"""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.database import SessionLocal, engine
from backend.models import LeaveRequest, ShiftRequest, User, LeaveType, ShiftType, RequestStatus
from sqlalchemy.orm import joinedload
from datetime import date

def fix_request_ids():
    """Verify all LeaveRequest and ShiftRequest records can be loaded with request_ids."""
    db = SessionLocal()
    
    try:
        # Load all approved leave requests with relationships
        approved_leaves = db.query(LeaveRequest).filter(
            LeaveRequest.status == RequestStatus.APPROVED
        ).options(
            joinedload(LeaveRequest.user),
            joinedload(LeaveRequest.leave_type)
        ).all()
        
        print(f"\n📊 Found {len(approved_leaves)} approved leave requests")
        
        missing_user = 0
        missing_leave_type = 0
        missing_dates = 0
        valid_requests = 0
        
        for leave in approved_leaves:
            if not leave.user:
                missing_user += 1
                print(f"⚠️  LeaveRequest {leave.id} has no user")
                continue
            if not leave.leave_type:
                missing_leave_type += 1
                print(f"⚠️  LeaveRequest {leave.id} has no leave_type")
                continue
            if not leave.from_date or not leave.to_date:
                missing_dates += 1
                print(f"⚠️  LeaveRequest {leave.id} has missing dates")
                continue
            
            valid_requests += 1
            request_id = f"LR_{leave.id}"
            print(f"✅ LeaveRequest {leave.id}: {leave.user.employee_name}, {leave.leave_type.code}, {leave.from_date} to {leave.to_date}, request_id={request_id}")
        
        print(f"\n📈 Summary:")
        print(f"  - Valid requests: {valid_requests}")
        print(f"  - Missing user: {missing_user}")
        print(f"  - Missing leave_type: {missing_leave_type}")
        print(f"  - Missing dates: {missing_dates}")
        
        # Load all shift requests with relationships
        shift_requests = db.query(ShiftRequest).options(
            joinedload(ShiftRequest.user),
            joinedload(ShiftRequest.shift_type)
        ).all()
        
        print(f"\n📊 Found {len(shift_requests)} shift requests")
        
        missing_user_sr = 0
        missing_shift_type = 0
        missing_dates_sr = 0
        valid_shift_requests = 0
        
        for shift in shift_requests:
            if not shift.user:
                missing_user_sr += 1
                print(f"⚠️  ShiftRequest {shift.id} has no user")
                continue
            if not shift.shift_type:
                missing_shift_type += 1
                print(f"⚠️  ShiftRequest {shift.id} has no shift_type")
                continue
            if not shift.from_date or not shift.to_date:
                missing_dates_sr += 1
                print(f"⚠️  ShiftRequest {shift.id} has missing dates")
                continue
            
            valid_shift_requests += 1
            request_id = f"SR_{shift.id}"
            print(f"✅ ShiftRequest {shift.id}: {shift.user.employee_name}, {shift.shift_type.code}, {shift.from_date} to {shift.to_date}, request_id={request_id}")
        
        print(f"\n📈 Shift Requests Summary:")
        print(f"  - Valid requests: {valid_shift_requests}")
        print(f"  - Missing user: {missing_user_sr}")
        print(f"  - Missing shift_type: {missing_shift_type}")
        print(f"  - Missing dates: {missing_dates_sr}")
        
        # Check for orphaned records (user or type deleted)
        if missing_user > 0 or missing_leave_type > 0:
            print(f"\n⚠️  WARNING: Some LeaveRequest records have missing relationships!")
            print(f"   These will not appear in roster data. Consider cleaning them up.")
        
        if missing_user_sr > 0 or missing_shift_type > 0:
            print(f"\n⚠️  WARNING: Some ShiftRequest records have missing relationships!")
            print(f"   These will not appear in roster data. Consider cleaning them up.")
        
        print(f"\n✅ Database check complete!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    fix_request_ids()

