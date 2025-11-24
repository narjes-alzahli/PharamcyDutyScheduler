"""Migration script to update shift_requests table to use shift_type_id instead of shift string."""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine, SessionLocal
from backend.models import ShiftRequest, ShiftType
from sqlalchemy import text
import sqlite3

def run_migration():
    """Migrate shift_requests table from shift string to shift_type_id."""
    print("🔄 Starting migration: Updating shift_requests table...")
    
    db_path = Path("roster.db")
    if not db_path.exists():
        print("❌ Database file not found at roster.db")
        return
    
    # Connect directly to SQLite to check and alter table
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    try:
        # Check if shift_type_id column already exists
        cursor.execute("PRAGMA table_info(shift_requests)")
        columns = [row[1] for row in cursor.fetchall()]
        
        if 'shift_type_id' in columns:
            print("✅ shift_type_id column already exists. Checking if migration needed...")
            # Check if there are any rows with shift but no shift_type_id
            cursor.execute("SELECT COUNT(*) FROM shift_requests WHERE shift_type_id IS NULL AND shift IS NOT NULL")
            count = cursor.fetchone()[0]
            if count == 0:
                print("✅ Migration already completed. No action needed.")
                return
        else:
            print("📝 Adding shift_type_id column...")
            # Add shift_type_id column (nullable initially)
            cursor.execute("ALTER TABLE shift_requests ADD COLUMN shift_type_id INTEGER")
            conn.commit()
            print("✅ Column added")
        
        # Get all shift requests that need migration
        cursor.execute("SELECT id, shift FROM shift_requests WHERE shift_type_id IS NULL AND shift IS NOT NULL")
        rows_to_migrate = cursor.fetchall()
        
        if not rows_to_migrate:
            print("✅ No rows to migrate. Migration complete!")
            return
        
        print(f"📝 Found {len(rows_to_migrate)} shift requests to migrate...")
        
        # Get shift type mappings
        db = SessionLocal()
        try:
            shift_types = db.query(ShiftType).all()
            shift_type_map = {st.code: st.id for st in shift_types}
            print(f"✅ Found {len(shift_type_map)} shift types in database")
            
            migrated = 0
            failed = 0
            
            for request_id, shift_code in rows_to_migrate:
                if shift_code in shift_type_map:
                    shift_type_id = shift_type_map[shift_code]
                    cursor.execute(
                        "UPDATE shift_requests SET shift_type_id = ? WHERE id = ?",
                        (shift_type_id, request_id)
                    )
                    migrated += 1
                    print(f"  ✅ Migrated request {request_id}: {shift_code} -> shift_type_id {shift_type_id}")
                else:
                    print(f"  ⚠️  Warning: Shift code '{shift_code}' not found in shift_types. Setting to NULL.")
                    failed += 1
            
            conn.commit()
            print(f"\n🎉 Migration complete!")
            print(f"   Migrated: {migrated} requests")
            if failed > 0:
                print(f"   Failed: {failed} requests (shift code not found)")
            
            # Now we can make shift_type_id NOT NULL and drop the old shift column
            # But first check if all rows have shift_type_id
            cursor.execute("SELECT COUNT(*) FROM shift_requests WHERE shift_type_id IS NULL")
            null_count = cursor.fetchone()[0]
            
            if null_count == 0:
                print("\n📝 Making shift_type_id NOT NULL...")
                # SQLite doesn't support ALTER COLUMN, so we need to recreate the table
                # But this is complex - for now, just leave it nullable
                # The application code should handle NULL cases
                print("   (Leaving column nullable for now - can be made NOT NULL later if needed)")
            else:
                print(f"\n⚠️  Warning: {null_count} rows still have NULL shift_type_id")
                
        finally:
            db.close()
            
    except Exception as e:
        conn.rollback()
        print(f"❌ Error during migration: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    run_migration()

