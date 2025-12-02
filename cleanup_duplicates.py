#!/usr/bin/env python3
"""Cleanup script to remove duplicate shift requests from database."""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from backend.database import SessionLocal
from backend.models import ShiftRequest, RequestStatus
from collections import defaultdict

def cleanup_duplicate_shift_requests(dry_run=True):
    """Remove duplicate shift requests, keeping only the first (lowest ID) one."""
    db = SessionLocal()
    try:
        # Get all approved shift requests
        approved_shifts = db.query(ShiftRequest).filter(
            ShiftRequest.status == RequestStatus.APPROVED
        ).all()
        
        print(f'Total approved shift requests: {len(approved_shifts)}')
        
        # Group by employee, from_date, to_date, shift_type_id, force, reason
        groups = defaultdict(list)
        for shift in approved_shifts:
            if shift.user and shift.shift_type:
                key = (
                    shift.user.employee_name,
                    shift.from_date,
                    shift.to_date,
                    shift.shift_type.code,
                    shift.force,
                    shift.reason or ''
                )
                groups[key].append(shift)
        
        # Find duplicates
        duplicates = {k: sorted(v, key=lambda x: x.id) for k, v in groups.items() if len(v) > 1}
        
        if not duplicates:
            print('No duplicates found!')
            return
        
        print(f'\nFound {len(duplicates)} duplicate groups')
        
        total_to_delete = 0
        ids_to_delete = []
        
        for key, shifts in duplicates.items():
            # Keep the first one (lowest ID), delete the rest
            keep = shifts[0]
            delete = shifts[1:]
            total_to_delete += len(delete)
            ids_to_delete.extend([s.id for s in delete])
            
            if not dry_run:
                print(f'  {key[0]} - {key[1]} to {key[2]}, Shift: {key[3]}: Keeping ID {keep.id}, deleting IDs {[s.id for s in delete]}')
            else:
                print(f'  {key[0]} - {key[1]} to {key[2]}, Shift: {key[3]}: Would keep ID {keep.id}, would delete IDs {[s.id for s in delete]}')
        
        print(f'\nTotal duplicate records: {total_to_delete}')
        
        if not dry_run:
            # Delete duplicates
            deleted = db.query(ShiftRequest).filter(ShiftRequest.id.in_(ids_to_delete)).delete(synchronize_session=False)
            db.commit()
            print(f'\n✅ Deleted {deleted} duplicate shift requests')
        else:
            print(f'\n⚠️  DRY RUN - No records deleted. Run with dry_run=False to actually delete.')
            
    except Exception as e:
        db.rollback()
        print(f'❌ Error: {e}')
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Cleanup duplicate shift requests')
    parser.add_argument('--execute', action='store_true', help='Actually delete duplicates (default is dry run)')
    args = parser.parse_args()
    
    cleanup_duplicate_shift_requests(dry_run=not args.execute)

