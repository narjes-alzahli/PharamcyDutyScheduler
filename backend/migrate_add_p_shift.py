"""Migration script to add P (Preparation) shift type."""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.database import SessionLocal
from backend.models import ShiftType

def run_migration():
    """Add P (Preparation) shift type if it doesn't exist."""
    print("🔄 Adding P (Preparation) shift type...")
    
    db = SessionLocal()
    try:
        # Check if P already exists
        existing = db.query(ShiftType).filter(ShiftType.code == 'P').first()
        if existing:
            print(f"✅ P shift type already exists: {existing.code} - {existing.description}")
            return
        
        # Create P shift type (non-standard, like MS)
        p_shift = ShiftType(
            code='P',
            description='Preparation',
            color_hex='#FFA07A',  # Light salmon (matching shiftColors.ts)
            is_working_shift=True,
            is_active=True
        )
        
        db.add(p_shift)
        db.commit()
        print("✅ Created P shift type: Preparation")
        
    except Exception as e:
        db.rollback()
        print(f"❌ Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run_migration()

