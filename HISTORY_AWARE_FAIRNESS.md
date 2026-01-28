# History-Aware Fairness Feature Documentation

## Overview

This feature extends the existing fairness logic to account for recent assignment history from committed schedules. Instead of only balancing assignments within the current scheduling period, the solver now considers past assignments when distributing shifts, ensuring fairness across months.

**Status**: Active  
**Added**: 2025-01-XX  
**Feature Tag**: `[HISTORY_AWARE_FAIRNESS]`

---

## Feature Description

### What It Does

- Extracts past assignments from `CommittedSchedule` table for each employee
- Computes history counts per shift category (nights, afternoons, M4, thursdays, weekends)
- Applies fairness on `total_load = history_count + new_assignments` instead of just new assignments
- Ensures employees with lower recent load get preference for new assignments

### Categories Balanced Separately

1. **Night shifts** - Among employees with `skill_N`
2. **Afternoon shifts** - Among employees with `skill_A`
3. **M4 shifts** - Among employees with `skill_M4`
4. **Thursday shifts** - Excluding M and M3, among multi-skill employees
5. **Weekend shifts** - Among multi-skill employees

### History Calculation Methods

- **Rolling Window** (default): Counts assignments in last N months (default: 3)
- **Decayed Carryover**: Uses exponential decay with configurable alpha (default: 0.7)

---

## Quick Find

Search for `[HISTORY_AWARE_FAIRNESS]` in all files to find all related code:

```bash
grep -r "\[HISTORY_AWARE_FAIRNESS\]" .
```

---

## Files Modified

### 1. `backend/roster_data_loader.py`

**Changes:**
- Added `load_assignment_history()` function (lines ~489-690)

**Function Signature:**
```python
def load_assignment_history(
    year: int,
    month: int,
    employees: List[str],
    skills: Dict[str, Dict[str, bool]],
    db: Session = None,
    method: str = "rolling_window",
    window_months: int = 3,
    alpha: float = 0.7
) -> Dict[str, Dict[str, int]]
```

**What It Does:**
- Queries `CommittedSchedule` table for past assignments
- Counts assignments per category per employee
- Supports rolling window and decayed carryover methods
- Returns history counts dictionary

**Code Marker:** `# [HISTORY_AWARE_FAIRNESS] START - History extraction function`

**Revert:** Remove entire function (approximately lines 489-690)

---

### 2. `roster/app/model/scoring.py`

**Changes:**
- Modified `add_objective()` method to accept `history_counts` parameter
- Modified `_add_fairness_variables()` method to use history in fairness calculations

**Key Modifications:**

1. **`add_objective()` method** (line ~26):
   - Added parameter: `history_counts: Dict[str, Dict[str, int]] = None`
   - Passes history_counts to `_add_fairness_variables()`

2. **`_add_fairness_variables()` method** (lines ~127-340):
   - Added parameter: `history_counts: Dict[str, Dict[str, int]] = None`
   - Changed from counting only new assignments to `total_load = history + new_assignments`
   - Modified fairness variables to use `total_load` instead of just new counts

**Code Markers:** Multiple `# [HISTORY_AWARE_FAIRNESS]` comments throughout

**Revert:**
- Remove `history_counts` parameter from both methods
- Restore original fairness calculation (only new assignments)
- Remove all `total_load` calculations and use original `*_count` variables

---

### 3. `roster/app/model/solver.py`

**Changes:**
- Modified `solve()` method to extract and pass history_counts to scoring

**Key Modifications:**

Lines ~104-107:
```python
# [HISTORY_AWARE_FAIRNESS] Extract assignment history for fairness calculations
history_counts = None
if hasattr(data, 'history_counts'):
    history_counts = data.history_counts

# Add objective
# [HISTORY_AWARE_FAIRNESS] Pass history_counts to scoring
self.scoring.add_objective(model, x, employees, dates, demands, skills, history_counts)
```

**Revert:**
- Remove history extraction code
- Change back to: `self.scoring.add_objective(model, x, employees, dates, demands, skills)`

---

### 4. `roster/app/model/schema.py`

**Changes:**
- Added `history_counts` attribute to `RosterData` class

**Key Modifications:**

Line ~104:
```python
# [HISTORY_AWARE_FAIRNESS] Assignment history for fairness calculations
self.history_counts: Dict[str, Dict[str, int]] = None
```

**Revert:**
- Remove this line

---

### 5. `backend/routers/solver.py`

**Changes:**
- Added history extraction before solving

**Key Modifications:**

Lines ~332-348:
```python
# [HISTORY_AWARE_FAIRNESS] Extract assignment history for fairness calculations
# Build skills dict from employees data
skills_dict = {}
for emp_data in data.employees:
    skills_dict[emp_data.employee] = data.get_employee_skills(emp_data.employee)

# Extract history using rolling window method (default: 3 months)
from backend.roster_data_loader import load_assignment_history
history_counts = load_assignment_history(
    request.year,
    request.month,
    data.get_employee_names(),
    skills_dict,
    db=db,
    method="rolling_window",
    window_months=3
)
data.history_counts = history_counts
```

**Revert:**
- Remove entire block (lines ~332-348)

---

## Complete Revert Instructions

### Step 1: Remove History Extraction Function

**File:** `backend/roster_data_loader.py`

- Find: `# [HISTORY_AWARE_FAIRNESS] START - History extraction function`
- Remove: Lines ~489-690 (entire `load_assignment_history()` function)

### Step 2: Revert Scoring Changes

**File:** `roster/app/model/scoring.py`

1. In `add_objective()` method:
   - Remove `history_counts` parameter (line ~26)
   - Change call to: `self._add_fairness_variables(model, x, employees, dates, skills)`

2. In `_add_fairness_variables()` method:
   - Remove `history_counts` parameter
   - Remove history initialization code (lines ~140-145)
   - Change all `*_total_load` variables back to `*_count` variables
   - Remove all `total_load = history + new_assignments` calculations
   - Restore original fairness calculation using only new assignments

### Step 3: Revert Solver Changes

**File:** `roster/app/model/solver.py`

- Find: `# [HISTORY_AWARE_FAIRNESS] Extract assignment history`
- Remove: Lines ~104-107
- Change to: `self.scoring.add_objective(model, x, employees, dates, demands, skills)`

### Step 4: Revert Schema Changes

**File:** `roster/app/model/schema.py`

- Find: `# [HISTORY_AWARE_FAIRNESS] Assignment history`
- Remove: Line ~104 (`self.history_counts = None`)

### Step 5: Revert Router Changes

**File:** `backend/routers/solver.py`

- Find: `# [HISTORY_AWARE_FAIRNESS] Extract assignment history`
- Remove: Lines ~332-348 (entire block)

---

## Verification After Revert

After reverting, verify:

1. No `[HISTORY_AWARE_FAIRNESS]` tags remain (except in this doc)
2. Solver runs without errors
3. No references to `history_counts` or `load_assignment_history`
4. Fairness calculations work (but only consider current period)
5. No database queries to `CommittedSchedule` for history extraction

---

## Dependencies

- Requires `CommittedSchedule` table to exist (already exists)
- No database migrations needed (uses existing table)
- No frontend changes required

---

## Configuration

Currently hardcoded:
- Method: `"rolling_window"`
- Window: `3` months
- Alpha: `0.7` (for decayed carryover, not currently used)

To change these, modify the call in `backend/routers/solver.py` (line ~340).

---

## Notes

- If no committed schedules exist, history_counts will be empty dicts (all zeros)
- Feature gracefully degrades - if history extraction fails, solver continues without history
- History is computed per category independently
- Only includes eligible employees per category (e.g., only skill_N employees for nights)

---

## Related Files

- `backend/models.py` - `CommittedSchedule` model definition
- `backend/routers/schedules.py` - Schedule commit endpoint (creates committed schedules)

---

## Version History

- **v1.0** (2025-01-XX): Initial implementation with rolling window method
