"""
Comprehensive database seed script.
Creates all shift types, leave types, and default admin user.

This should be run when setting up a new database or syncing environments.
Run: python3 -m backend.seed_database
"""

import sys
from pathlib import Path

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.database import Base, engine, SessionLocal
from backend.models import User, ShiftType, LeaveType, EmployeeType
from backend.utils import hash_password
from sqlalchemy import inspect

# All shift types with updated colors
SHIFT_TYPES = [
    {"code": "M", "description": "Morning", "color_hex": "#FFFFFF", "is_working_shift": True},
    {"code": "IP", "description": "Inpatient", "color_hex": "#ffffff", "is_working_shift": True},
    {"code": "A", "description": "Afternoon", "color_hex": "#845699", "is_working_shift": True},
    {"code": "N", "description": "Night", "color_hex": "#FFFF00", "is_working_shift": True},
    {"code": "M3", "description": "7am-2pm", "color_hex": "#ecd0d0", "is_working_shift": True},
    {"code": "M4", "description": "12pm-7pm", "color_hex": "#a6cdf7", "is_working_shift": True},
    {"code": "H", "description": "Harat", "color_hex": "#ffcd9e", "is_working_shift": True},
    {"code": "CL", "description": "Clinic", "color_hex": "#ffffff", "is_working_shift": True},
    {"code": "MS", "description": "Medical Store", "color_hex": "#ffffff", "is_working_shift": True},
    {"code": "C", "description": "Course", "color_hex": "#e66bcf", "is_working_shift": True},
    {"code": "P", "description": "Preparation", "color_hex": "#FFA07A", "is_working_shift": True},
    {"code": "M+P", "description": "Main+Preparation", "color_hex": "#ec7c13", "is_working_shift": True},
    {"code": "IP+P", "description": "Inpatient+Preparation", "color_hex": "#ec7c13", "is_working_shift": True},
    {"code": "O", "description": "Off Duty", "color_hex": "#ffffff", "is_working_shift": False},
]

# All leave types with updated colors
LEAVE_TYPES = [
    {"code": "DO", "description": "Day Off", "color_hex": "#70c770", "counts_as_rest": True},
    {"code": "AL", "description": "Annual Leave", "color_hex": "#FFD27F", "counts_as_rest": True},
    {"code": "ML", "description": "Maternity Leave", "color_hex": "#DDA0DD", "counts_as_rest": True},
    {"code": "W", "description": "Workshop", "color_hex": "#D8BFD8", "counts_as_rest": True},
    {"code": "UL", "description": "Unpaid Leave", "color_hex": "#F5F5F5", "counts_as_rest": True},
    {"code": "APP", "description": "Appointment", "color_hex": "#ec7c13", "counts_as_rest": True},
    {"code": "STL", "description": "Study Leave", "color_hex": "#B0E0E6", "counts_as_rest": True},
    {"code": "L", "description": "Leave", "color_hex": "#ded9d9", "counts_as_rest": True},
    {"code": "O", "description": "Off Duty", "color_hex": "#ffffff", "counts_as_rest": True},
]


def seed_database(force=False):
    """
    Seed database with all default data.
    
    Args:
        force: If True, updates existing records. If False, skips existing records.
    """
    print("🌱 Starting database seed...")
    
    # Create all tables
    Base.metadata.create_all(bind=engine)
    print("✅ Tables created/verified")
    
    db = SessionLocal()
    try:
        # Create/update admin user
        admin_user = db.query(User).filter(User.username == "admin").first()
        if admin_user:
            if force:
                admin_user.password = hash_password("admin123")
                admin_user.employee_name = "Admin"
                admin_user.employee_type = EmployeeType.MANAGER
                print("✅ Updated admin user")
            else:
                print("⏭️  Admin user already exists, skipping")
        else:
            admin_user = User(
                username="admin",
                password=hash_password("admin123"),
                employee_name="Admin",
                employee_type=EmployeeType.MANAGER
            )
            db.add(admin_user)
            print("✅ Created admin user (username: admin, password: admin123)")
        
        # Create/update shift types
        shift_created = 0
        shift_updated = 0
        shift_skipped = 0
        
        for shift_data in SHIFT_TYPES:
            existing = db.query(ShiftType).filter(ShiftType.code == shift_data["code"]).first()
            if existing:
                if force:
                    existing.description = shift_data["description"]
                    existing.color_hex = shift_data["color_hex"]
                    existing.is_working_shift = shift_data["is_working_shift"]
                    existing.is_active = True
                    shift_updated += 1
                    print(f"✅ Updated shift type: {shift_data['code']}")
                else:
                    shift_skipped += 1
            else:
                shift_type = ShiftType(
                    code=shift_data["code"],
                    description=shift_data["description"],
                    color_hex=shift_data["color_hex"],
                    is_working_shift=shift_data["is_working_shift"],
                    is_active=True
                )
                db.add(shift_type)
                shift_created += 1
                print(f"✅ Created shift type: {shift_data['code']}")
        
        # Create/update leave types
        leave_created = 0
        leave_updated = 0
        leave_skipped = 0
        
        for leave_data in LEAVE_TYPES:
            existing = db.query(LeaveType).filter(LeaveType.code == leave_data["code"]).first()
            if existing:
                if force:
                    existing.description = leave_data["description"]
                    existing.color_hex = leave_data["color_hex"]
                    existing.counts_as_rest = leave_data["counts_as_rest"]
                    existing.is_active = True
                    leave_updated += 1
                    print(f"✅ Updated leave type: {leave_data['code']}")
                else:
                    leave_skipped += 1
            else:
                leave_type = LeaveType(
                    code=leave_data["code"],
                    description=leave_data["description"],
                    color_hex=leave_data["color_hex"],
                    counts_as_rest=leave_data["counts_as_rest"],
                    is_active=True
                )
                db.add(leave_type)
                leave_created += 1
                print(f"✅ Created leave type: {leave_data['code']}")
        
        db.commit()
        
        print("\n" + "=" * 80)
        print("🎉 Database seed complete!")
        print("=" * 80)
        print(f"Shift Types: {shift_created} created, {shift_updated} updated, {shift_skipped} skipped")
        print(f"Leave Types: {leave_created} created, {leave_updated} updated, {leave_skipped} skipped")
        
    except Exception as e:
        db.rollback()
        print(f"❌ Error during seed: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Seed database with default data")
    parser.add_argument("--force", action="store_true", help="Update existing records")
    args = parser.parse_args()
    
    seed_database(force=args.force)
