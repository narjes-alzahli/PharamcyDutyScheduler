"""Migration script to drop display_name column from leave_types and shift_types tables."""

import sys
from pathlib import Path
import sqlite3

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.database import DATABASE_URL

def drop_display_name_column():
    """Drop display_name column from leave_types and shift_types tables."""
    # Extract database path from SQLite URL
    if DATABASE_URL.startswith("sqlite:///"):
        db_path = Path(DATABASE_URL.replace("sqlite:///", ""))
        if not db_path.is_absolute():
            db_path = project_root / db_path
    else:
        print("❌ This migration only supports SQLite databases")
        return False
    
    if not db_path.exists():
        print(f"❌ Database file not found at {db_path}")
        return False
    
    print(f"🔄 Connecting to database: {db_path}")
    
    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        
        # SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
        print("🔄 Dropping display_name column from leave_types...")
        
        # For leave_types
        cursor.execute("""
            CREATE TABLE leave_types_new (
                id INTEGER PRIMARY KEY,
                code VARCHAR NOT NULL UNIQUE,
                description VARCHAR NOT NULL,
                color_hex VARCHAR DEFAULT '#F5F5F5',
                counts_as_rest BOOLEAN DEFAULT 1,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME,
                updated_at DATETIME
            )
        """)
        
        cursor.execute("""
            INSERT INTO leave_types_new (id, code, description, color_hex, counts_as_rest, is_active, created_at, updated_at)
            SELECT id, code, description, color_hex, counts_as_rest, is_active, created_at, updated_at
            FROM leave_types
        """)
        
        cursor.execute("DROP TABLE leave_types")
        cursor.execute("ALTER TABLE leave_types_new RENAME TO leave_types")
        
        # Recreate indexes
        cursor.execute("CREATE INDEX ix_leave_types_code ON leave_types(code)")
        cursor.execute("CREATE INDEX ix_leave_types_id ON leave_types(id)")
        
        print("✅ Dropped display_name from leave_types")
        
        # For shift_types
        print("🔄 Dropping display_name column from shift_types...")
        
        cursor.execute("""
            CREATE TABLE shift_types_new (
                id INTEGER PRIMARY KEY,
                code VARCHAR NOT NULL UNIQUE,
                description VARCHAR NOT NULL,
                color_hex VARCHAR DEFAULT '#E5E7EB',
                is_working_shift BOOLEAN DEFAULT 1,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME,
                updated_at DATETIME
            )
        """)
        
        cursor.execute("""
            INSERT INTO shift_types_new (id, code, description, color_hex, is_working_shift, is_active, created_at, updated_at)
            SELECT id, code, description, color_hex, is_working_shift, is_active, created_at, updated_at
            FROM shift_types
        """)
        
        cursor.execute("DROP TABLE shift_types")
        cursor.execute("ALTER TABLE shift_types_new RENAME TO shift_types")
        
        # Recreate indexes
        cursor.execute("CREATE INDEX ix_shift_types_code ON shift_types(code)")
        cursor.execute("CREATE INDEX ix_shift_types_id ON shift_types(id)")
        
        print("✅ Dropped display_name from shift_types")
        
        conn.commit()
        conn.close()
        
        print("✅ Migration completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Error during migration: {e}")
        import traceback
        traceback.print_exc()
        if conn:
            conn.rollback()
            conn.close()
        return False

if __name__ == "__main__":
    print("🔄 Starting migration: Dropping display_name column...")
    success = drop_display_name_column()
    if not success:
        sys.exit(1)

