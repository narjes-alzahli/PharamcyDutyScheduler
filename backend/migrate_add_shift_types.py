"""Migration script to add shift_types table and populate default shifts."""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine, SessionLocal, Base
from backend.models import ShiftType
from sqlalchemy import inspect

# Default shift types with their properties
DEFAULT_SHIFTS = [
    {"code": "M", "display_name": "Morning", "description": "Morning shift", "color_hex": "#3B82F6", "is_working_shift": True},
    {"code": "IP", "display_name": "IP", "description": "IP shift", "color_hex": "#8B5CF6", "is_working_shift": True},
    {"code": "A", "display_name": "Afternoon", "description": "Afternoon shift", "color_hex": "#F59E0B", "is_working_shift": True},
    {"code": "N", "display_name": "Night", "description": "Night shift", "color_hex": "#1F2937", "is_working_shift": True},
    {"code": "M3", "display_name": "Morning 3", "description": "Morning 3 shift", "color_hex": "#60A5FA", "is_working_shift": True},
    {"code": "M4", "display_name": "Morning 4", "description": "Morning 4 shift", "color_hex": "#93C5FD", "is_working_shift": True},
    {"code": "H", "display_name": "Harat", "description": "Harat shift", "color_hex": "#EC4899", "is_working_shift": True},
    {"code": "CL", "display_name": "Clinic", "description": "Clinic shift", "color_hex": "#10B981", "is_working_shift": True},
    {"code": "DO", "display_name": "Day Off", "description": "Day off", "color_hex": "#F5F5F5", "is_working_shift": False},
    {"code": "O", "display_name": "Off", "description": "Off day", "color_hex": "#E5E7EB", "is_working_shift": False},
]


def run_migration():
    """Create shift_types table and populate with default shifts."""
    print("🔄 Starting migration: Adding shift_types table...")
    
    # Create all tables (this will only create new ones)
    Base.metadata.create_all(bind=engine)
    print("✅ Tables created/verified")
    
    db = SessionLocal()
    try:
        # Check if shift_types table exists and has data
        inspector = inspect(engine)
        if "shift_types" in inspector.get_table_names():
            existing_count = db.query(ShiftType).count()
            if existing_count > 0:
                print(f"⚠️  shift_types table already has {existing_count} entries. Skipping population.")
                print("   If you want to re-populate, delete existing shift types first.")
                return
        
        # Create default shift types
        created_count = 0
        skipped_count = 0
        
        for shift_data in DEFAULT_SHIFTS:
            # Check if shift type already exists
            existing = db.query(ShiftType).filter(ShiftType.code == shift_data["code"]).first()
            if existing:
                print(f"⏭️  Shift type '{shift_data['code']}' already exists, skipping...")
                skipped_count += 1
                continue
            
            shift_type = ShiftType(**shift_data)
            db.add(shift_type)
            created_count += 1
            print(f"✅ Created shift type: {shift_data['code']} - {shift_data['display_name']}")
        
        db.commit()
        print(f"\n🎉 Migration complete!")
        print(f"   Created: {created_count} shift types")
        print(f"   Skipped: {skipped_count} shift types (already exist)")
        
    except Exception as e:
        db.rollback()
        print(f"❌ Error during migration: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run_migration()

