"""Migration script to combine display_name and description into description column."""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.database import SessionLocal
from backend.models import LeaveType, ShiftType

# Mapping of codes to new descriptions
LEAVE_TYPE_DESCRIPTIONS = {
    "AL": "Annual Leave",
    "APP": "Appointment",
    "DO": "Day Off",
    "L": "Leave",
    "ML": "Maternity Leave",
    "O": "Off Duty",
    "STL": "Study Leave",
    "UL": "Unpaid Leave",
    "W": "Workshop",
}

SHIFT_TYPE_DESCRIPTIONS = {
    "A": "Afternoon",
    "C": "Course",
    "CL": "Clinic",
    "H": "Harat",
    "IP": "Inpatient",
    "M": "Morning",
    "M3": "7am-2pm",
    "M4": "12pm-7pm",
    "MS": "Medical Store",
    "N": "Night",
}

def migrate_leave_types():
    """Combine display_name and description into description for leave types."""
    db = SessionLocal()
    try:
        leave_types = db.query(LeaveType).all()
        updated_count = 0
        
        for lt in leave_types:
            # Use provided description if available, otherwise combine display_name and description
            if lt.code in LEAVE_TYPE_DESCRIPTIONS:
                new_description = LEAVE_TYPE_DESCRIPTIONS[lt.code]
            else:
                # Combine display_name and existing description
                if lt.display_name and lt.description:
                    new_description = f"{lt.display_name} - {lt.description}"
                elif lt.display_name:
                    new_description = lt.display_name
                elif lt.description:
                    new_description = lt.description
                else:
                    new_description = lt.code  # Fallback to code
            
            lt.description = new_description
            updated_count += 1
        
        db.commit()
        print(f"✅ Updated {updated_count} leave types")
        return True
    except Exception as e:
        db.rollback()
        print(f"❌ Error updating leave types: {e}")
        return False
    finally:
        db.close()

def migrate_shift_types():
    """Combine display_name and description into description for shift types."""
    db = SessionLocal()
    try:
        # Use raw SQL to access display_name column before it's removed from model
        from sqlalchemy import text
        
        # Get all shift types with their display_name and description
        result = db.execute(text("""
            SELECT id, code, display_name, description 
            FROM shift_types
        """))
        
        updated_count = 0
        for row in result:
            shift_id, code, display_name, description = row
            
            # Use provided description if available, otherwise combine display_name and description
            if code in SHIFT_TYPE_DESCRIPTIONS:
                new_description = SHIFT_TYPE_DESCRIPTIONS[code]
            else:
                # Combine display_name and existing description
                if display_name and description:
                    new_description = f"{display_name} - {description}"
                elif display_name:
                    new_description = display_name
                elif description:
                    new_description = description
                else:
                    new_description = code  # Fallback to code
            
            # Update using raw SQL
            db.execute(text("""
                UPDATE shift_types 
                SET description = :desc 
                WHERE id = :id
            """), {"desc": new_description, "id": shift_id})
            updated_count += 1
        
        db.commit()
        print(f"✅ Updated {updated_count} shift types")
        return True
    except Exception as e:
        db.rollback()
        print(f"❌ Error updating shift types: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()

def main():
    """Run the migration."""
    print("🔄 Starting migration: Combining display_name and description...")
    
    success1 = migrate_leave_types()
    success2 = migrate_shift_types()
    
    if success1 and success2:
        print("✅ Migration completed successfully!")
        print("\n⚠️  Next steps:")
        print("1. Update database models to remove display_name column")
        print("2. Update API endpoints to use description instead of display_name")
        print("3. Update frontend to use description")
        print("4. Run Alembic migration to drop display_name column from database")
    else:
        print("❌ Migration failed!")
        sys.exit(1)

if __name__ == "__main__":
    main()

