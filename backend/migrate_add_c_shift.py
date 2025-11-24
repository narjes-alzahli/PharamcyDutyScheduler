"""Migration script to add C (Course) shift type."""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.database import SessionLocal
from backend.models import ShiftType

def run_migration():
    """Add C (Course) shift type if it doesn't exist."""
    print("🔄 Adding C (Course) shift type...")
    
    db = SessionLocal()
    try:
        # Check if C already exists
        existing = db.query(ShiftType).filter(ShiftType.code == 'C').first()
        if existing:
            print(f"✅ C shift type already exists: {existing.code} - {existing.display_name}")
            return
        
        # Create C shift type
        c_shift = ShiftType(
            code='C',
            display_name='Course',
            description='Course',
            color_hex='#F0F8FF',  # Very light blue (similar to IP)
            is_working_shift=True,
            is_active=True
        )
        
        db.add(c_shift)
        db.commit()
        print("✅ Created C shift type: Course")
        
    except Exception as e:
        db.rollback()
        print(f"❌ Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run_migration()

