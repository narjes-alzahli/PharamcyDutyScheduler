"""Migration script to remove the old 'shift' column from shift_requests table."""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine
import sqlite3

def run_migration():
    """Remove the old 'shift' column from shift_requests table."""
    print("🔄 Starting migration: Removing old 'shift' column from shift_requests...")
    
    db_path = Path("roster.db")
    if not db_path.exists():
        print("❌ Database file not found at roster.db")
        return
    
    # SQLite doesn't support ALTER TABLE DROP COLUMN directly
    # We need to recreate the table without the shift column
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    try:
        # Check if shift column exists
        cursor.execute("PRAGMA table_info(shift_requests)")
        columns = [row[1] for row in cursor.fetchall()]
        
        if 'shift' not in columns:
            print("✅ 'shift' column doesn't exist. Migration not needed.")
            return
        
        print("📝 'shift' column found. Removing it...")
        
        # Step 1: Create new table without shift column
        cursor.execute("""
            CREATE TABLE shift_requests_new (
                id INTEGER NOT NULL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                shift_type_id INTEGER NOT NULL,
                from_date DATE NOT NULL,
                to_date DATE NOT NULL,
                force BOOLEAN NOT NULL,
                reason TEXT,
                status VARCHAR NOT NULL,
                submitted_at DATETIME,
                updated_at DATETIME,
                approved_by VARCHAR,
                approved_at DATETIME,
                FOREIGN KEY(user_id) REFERENCES users (id),
                FOREIGN KEY(shift_type_id) REFERENCES shift_types (id)
            )
        """)
        
        # Step 2: Copy data from old table to new table
        cursor.execute("""
            INSERT INTO shift_requests_new 
            (id, user_id, shift_type_id, from_date, to_date, force, reason, status, submitted_at, updated_at, approved_by, approved_at)
            SELECT 
                id, user_id, shift_type_id, from_date, to_date, force, reason, status, submitted_at, updated_at, approved_by, approved_at
            FROM shift_requests
        """)
        
        # Step 3: Drop old table
        cursor.execute("DROP TABLE shift_requests")
        
        # Step 4: Rename new table to original name
        cursor.execute("ALTER TABLE shift_requests_new RENAME TO shift_requests")
        
        # Step 5: Recreate indexes
        cursor.execute("CREATE INDEX ix_shift_requests_id ON shift_requests (id)")
        cursor.execute("CREATE INDEX ix_shift_requests_user_id ON shift_requests (user_id)")
        cursor.execute("CREATE INDEX ix_shift_requests_shift_type_id ON shift_requests (shift_type_id)")
        
        conn.commit()
        print("✅ Successfully removed 'shift' column from shift_requests table!")
        print("   All data preserved and migrated to new structure.")
        
    except Exception as e:
        conn.rollback()
        print(f"❌ Error during migration: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    run_migration()

