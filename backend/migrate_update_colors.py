"""Migration script to update shift type and leave type colors to new defaults."""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.database import SessionLocal
from backend.models import ShiftType, LeaveType

# Updated color mappings
SHIFT_TYPE_COLORS = {
    'M': '#FFFFFF',
    'IP': '#ffffff',
    'A': '#845699',
    'N': '#FFFF00',
    'M3': '#ecd0d0',
    'M4': '#a6cdf7',
    'H': '#ffcd9e',
    'CL': '#ffffff',
    'MS': '#ffffff',
    'C': '#e66bcf',
    'P': '#FFA07A',
    'M+P': '#ec7c13',
    'IP+P': '#ec7c13',
    'O': '#ffffff',
    'DO': '#70c770',
}

LEAVE_TYPE_COLORS = {
    'DO': '#70c770',
    'AL': '#FFD27F',
    'ML': '#DDA0DD',
    'W': '#D8BFD8',
    'UL': '#F5F5F5',
    'APP': '#ec7c13',
    'STL': '#B0E0E6',
    'L': '#ded9d9',
    'O': '#ffffff',
}


def run_migration():
    """Update colors for all shift types and leave types."""
    print("🔄 Starting migration: Updating shift and leave type colors...")
    
    db = SessionLocal()
    try:
        updated_shifts = 0
        updated_leaves = 0
        
        # Update shift types
        for code, color in SHIFT_TYPE_COLORS.items():
            shift_type = db.query(ShiftType).filter(ShiftType.code == code).first()
            if shift_type:
                if shift_type.color_hex.upper() != color.upper():
                    shift_type.color_hex = color
                    updated_shifts += 1
                    print(f"✅ Updated shift type: {code} -> {color}")
                else:
                    print(f"⏭️  Shift type {code} already has color {color}, skipping")
            else:
                print(f"⚠️  Shift type {code} not found in database, skipping")
        
        # Update leave types
        for code, color in LEAVE_TYPE_COLORS.items():
            leave_type = db.query(LeaveType).filter(LeaveType.code == code).first()
            if leave_type:
                if leave_type.color_hex.upper() != color.upper():
                    leave_type.color_hex = color
                    updated_leaves += 1
                    print(f"✅ Updated leave type: {code} -> {color}")
                else:
                    print(f"⏭️  Leave type {code} already has color {color}, skipping")
            else:
                print(f"⚠️  Leave type {code} not found in database, skipping")
        
        db.commit()
        print(f"\n🎉 Migration complete!")
        print(f"   Updated: {updated_shifts} shift types")
        print(f"   Updated: {updated_leaves} leave types")
        
    except Exception as e:
        db.rollback()
        print(f"❌ Error during migration: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run_migration()
