"""Script to update all existing demand CSV files to set H=2 on Monday and Wednesday."""

import sys
from pathlib import Path
import pandas as pd
from datetime import date

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

def update_h_shifts_in_file(file_path: Path):
    """Update H shifts in a demand CSV file: 1 on Monday, 1 on Wednesday, 0 otherwise."""
    try:
        df = pd.read_csv(file_path)
        
        # Ensure date column is datetime
        if 'date' in df.columns:
            df['date'] = pd.to_datetime(df['date']).dt.date
        
        # Update H shifts
        updated_count = 0
        for idx, row in df.iterrows():
            d = row['date']
            if isinstance(d, str):
                d = pd.to_datetime(d).date()
            
            weekday = d.weekday()  # 0 = Monday, 2 = Wednesday
            
            if weekday == 0:  # Monday
                df.at[idx, 'need_H'] = 1
                updated_count += 1
            elif weekday == 2:  # Wednesday
                df.at[idx, 'need_H'] = 1
                updated_count += 1
            else:
                df.at[idx, 'need_H'] = 0
                updated_count += 1
        
        # Save back to file
        df.to_csv(file_path, index=False)
        print(f"✅ Updated {file_path.name}: {updated_count} rows")
        return True
    except Exception as e:
        print(f"❌ Error updating {file_path.name}: {e}")
        return False

def main():
    """Update all demand CSV files."""
    demands_dir = project_root / "roster" / "app" / "data" / "demands"
    
    if not demands_dir.exists():
        print(f"❌ Demands directory not found: {demands_dir}")
        return
    
    csv_files = list(demands_dir.glob("demands_*.csv"))
    
    if not csv_files:
        print("⚠️  No demand CSV files found")
        return
    
    print(f"🔄 Found {len(csv_files)} demand CSV files")
    print("Updating H shifts: 1 on Monday, 1 on Wednesday, 0 otherwise...\n")
    
    success_count = 0
    for csv_file in sorted(csv_files):
        if update_h_shifts_in_file(csv_file):
            success_count += 1
    
    print(f"\n🎉 Updated {success_count}/{len(csv_files)} files successfully")

if __name__ == "__main__":
    main()

