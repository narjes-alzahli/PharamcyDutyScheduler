"""Constraint functions for staff rostering optimization."""

from datetime import date, timedelta
from typing import Dict, List, Set, Tuple, Optional, Any
from ortools.sat.python import cp_model
import numpy as np

# Default standard working shifts (fallback when working_shift_codes not provided)
# These should match what's in the database - updated when standard shifts change
# In practice, working_shift_codes should always be provided from the backend
_DEFAULT_STANDARD_SHIFTS = {"M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "IP+P", "P", "M+P"}
_DEFAULT_STANDARD_SHIFTS_LIST = ["M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "IP+P", "P", "M+P"]


def create_decision_variables(
    model: cp_model.CpModel,
    employees: List[str],
    dates: List[date],
    shifts: List[str],
    time_off: Dict[Tuple[str, date], str] = None,
    leave_codes: Optional[Set[str]] = None,
    working_shift_codes: Optional[List[str]] = None
) -> Dict[Tuple[str, date, str], cp_model.IntVar]:
    """Create binary decision variables for the optimization model."""
    x = {}
    
    # Base working shifts from database/config (standard shifts that can be optimized)
    # Default to standard shifts if not provided
    if working_shift_codes:
        working_shifts = set(working_shift_codes) | {"O"}  # Always include O (Off Duty)
    else:
        # Fallback to standard shifts (should not happen in practice - working_shift_codes should be provided)
        working_shifts = _DEFAULT_STANDARD_SHIFTS | {"O"}  # Always include O (Off Duty)
    
    # Leave codes that should only be created when explicitly requested
    # DO is now treated as a leave code - only assigned when requested in time_off
    # If leave_codes is provided, use it; otherwise infer from shifts list
    if leave_codes:
        # DO is no longer in working_shifts, so if it's in leave_codes, it will be in leave_only_codes
        leave_only_codes = leave_codes - working_shifts
    else:
        # Fallback: infer leave codes from shifts list (exclude working shifts)
        # This ensures we're not hardcoding specific leave types
        # DO will automatically be included if it's in shifts but not in working_shifts
        all_shifts_set = set(shifts)
        leave_only_codes = all_shifts_set - working_shifts
    
    for employee in employees:
        for day in dates:
            for shift in shifts:
                # Only create leave variables if explicitly requested
                if shift in leave_only_codes:
                    if time_off and (employee, day) in time_off and time_off[(employee, day)] == shift:
                        x[(employee, day, shift)] = model.NewBoolVar(
                            f"x_{employee}_{day}_{shift}"
                        )
                else:
                    # Create all other variables (working shifts, O)
                    # DO is now only created when requested in time_off (handled above)
                    x[(employee, day, shift)] = model.NewBoolVar(
                        f"x_{employee}_{day}_{shift}"
                    )
                
    return x


def add_one_per_day_constraint(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    shifts: List[str]
) -> None:
    """Add constraint: each employee works exactly one shift per day."""
    for employee in employees:
        for day in dates:
            # Sum of all available shifts for this employee on this day must equal 1
            shift_vars = [x[(employee, day, shift)] for shift in shifts if (employee, day, shift) in x]
            if shift_vars:  # Only add constraint if there are variables
                model.Add(sum(shift_vars) == 1)


def add_skill_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    skills: Dict[str, Dict[str, bool]],
    working_shift_codes: Optional[List[str]] = None
) -> None:
    """Add skill constraints: employees can only work shifts they're qualified for."""
    # Get working shifts from config or default to standard shifts
    if working_shift_codes:
        working_shifts = set(working_shift_codes)
    else:
        working_shifts = _DEFAULT_STANDARD_SHIFTS
    
    for employee in employees:
        if employee not in skills:
            continue
            
        employee_skills = skills[employee]
        
        for day in dates:
            # Check if employee is clinic-only (only has CL skill, all others False)
            has_cl_skill = employee_skills.get("CL", False)
            has_other_skills = any(
                employee_skills.get(shift, False)
                for shift in working_shifts
                if shift != "CL"
            )
            is_clinic_only = has_cl_skill and not has_other_skills
            
            if is_clinic_only:
                # Clinic-only employees can only work CL shifts
                # Forbid all working shifts except CL
                for shift_type in working_shifts:
                    if shift_type != "CL" and (employee, day, shift_type) in x:
                        model.Add(x[(employee, day, shift_type)] == 0)
                continue
            
            # Handle regular skill constraints
            for shift_type in working_shifts:
                if shift_type in employee_skills and not employee_skills[shift_type]:
                    # Employee cannot work this shift type
                    model.Add(x[(employee, day, shift_type)] == 0)


def add_coverage_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    demands: Dict[date, Dict[str, int]],
    working_shift_codes: Optional[List[str]] = None
) -> None:
    """Add coverage constraints: meet EXACT daily demand for each shift type."""
    # Get working shifts from config or default to standard shifts
    if working_shift_codes:
        working_shifts = working_shift_codes
    else:
        working_shifts = _DEFAULT_STANDARD_SHIFTS_LIST
    
    for day in dates:
        if day not in demands:
            continue
            
        day_demand = demands[day]
        
        # Individual shift coverage - prefer meeting requirements but allow under-staffing if necessary
        # Coverage is now handled via soft constraint (unfilled_coverage penalty) to allow flexibility
        # when not enough staff are available, while still preferring to meet full requirements
        # (Hard constraint removed - see scoring.py for unfilled_coverage penalty with weight 1000.0)


def add_time_off_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    time_off: Dict[Tuple[str, date], str]
) -> None:
    """Add time off constraints: force specific codes when employee is off."""
    for (employee, day), code in time_off.items():
        if employee in employees and day in dates:
            # Force the specific time off code
            model.Add(x[(employee, day, code)] == 1)


def add_lock_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    locks: Dict[Tuple[str, date, str], bool],
    working_shift_codes: Optional[List[str]] = None
) -> None:
    """Add lock constraints: force or forbid specific assignments.
    
    Args:
        working_shift_codes: List of working shift codes. If provided, working shift locks
                            will override O (Off Duty) locks when both exist on the same day.
    """
    # Determine working shifts
    if working_shift_codes:
        working_shifts = set(working_shift_codes)
    else:
        # Fallback to default working shifts
        working_shifts = {"M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "IP+P", "P", "M+P"}
    
    # Group locks by (employee, day) to detect conflicts
    locks_by_employee_day = {}
    for (employee, day, shift), force in locks.items():
        if employee in employees and day in dates and force:
            key = (employee, day)
            if key not in locks_by_employee_day:
                locks_by_employee_day[key] = []
            locks_by_employee_day[key].append(shift)
    
    # Process locks, prioritizing working shifts over O when both exist
    for (employee, day, shift), force in locks.items():
        if employee in employees and day in dates:
            if force:
                # Check if there's a conflict: both O and a working shift are forced
                key = (employee, day)
                forced_shifts = locks_by_employee_day.get(key, [])
                
                # If both O and a working shift are forced, prioritize the working shift
                if shift == "O" and len(forced_shifts) > 1:
                    # Check if any working shift is also forced
                    has_working_shift = any(s in working_shifts for s in forced_shifts if s != "O")
                    if has_working_shift:
                        # Skip the O lock - user request (working shift) overrides automatic rest
                        continue
                
                # Must work this shift
                if (employee, day, shift) in x:
                    model.Add(x[(employee, day, shift)] == 1)
            else:
                # Cannot work this shift
                if (employee, day, shift) in x:
                    model.Add(x[(employee, day, shift)] == 0)


def add_cap_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    caps: Dict[str, Dict[str, int]]
) -> None:
    """Add cap constraints: limit maximum shifts per employee. (maxN/maxA removed; kept for API compatibility.)"""
    pass


def add_minimum_days_off_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    min_days_off: Dict[str, int],
    rest_codes: Set[str]
) -> None:
    """Add minimum days off constraints per employee."""
    for employee in employees:
        if employee not in min_days_off:
            continue
            
        # Count total rest days for this employee
        rest_vars = []
        for day in dates:
            for code in rest_codes:
                if (employee, day, code) in x:
                    rest_vars.append(x[(employee, day, code)])
                
        # Must have at least min_days_off rest days
        if rest_vars:
            model.Add(sum(rest_vars) >= min_days_off[employee])


def add_weekly_rest_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    rest_codes: Set[str],
    weekly_rest_minimum: int = 1
) -> None:
    """Add weekly rest constraints: minimum rest days per week."""
    for employee in employees:
        # Group dates by week
        weeks = {}
        for day in dates:
            week_start = day - timedelta(days=day.weekday())
            if week_start not in weeks:
                weeks[week_start] = []
            weeks[week_start].append(day)
        
        # Add constraint for each week
        for week_dates in weeks.values():
            if len(week_dates) >= 5:  # Only for full weeks
                rest_vars = []
                for day in week_dates:
                    for code in rest_codes:
                        if (employee, day, code) in x:
                            rest_vars.append(x[(employee, day, code)])
                
                if rest_vars:
                    model.Add(sum(rest_vars) >= weekly_rest_minimum)


def add_adjacency_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    forbidden_pairs: List[Tuple[str, str]],
    locks: Dict[Tuple[str, date, str], bool] = None
) -> None:
    """Add adjacency constraints: prevent certain shift sequences.
    
    Args:
        locks: Lock constraints (force/forbid specific assignments).
               If either shift in a forbidden pair is forced via locks, the constraint is skipped.
    """
    for employee in employees:
        for i in range(len(dates) - 1):
            day1, day2 = dates[i], dates[i + 1]
            
            for shift1, shift2 in forbidden_pairs:
                # Cannot work shift1 on day1 and shift2 on day2
                if (employee, day1, shift1) in x and (employee, day2, shift2) in x:
                    # Skip constraint if either shift is forced via locks (employee request)
                    # This allows employees to override forbidden adjacency pairs
                    if locks:
                        lock1 = locks.get((employee, day1, shift1))
                        lock2 = locks.get((employee, day2, shift2))
                        # If either shift is forced (True), skip the adjacency constraint
                        if lock1 is True or lock2 is True:
                            continue
                    
                    model.Add(
                        x[(employee, day1, shift1)] + x[(employee, day2, shift2)] <= 1
                    )


def add_sequencing_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    time_off: Dict[Tuple[str, date], str] = None,
    leave_codes: Set[str] = None,
    required_rest_after_shifts: List[Dict[str, Any]] = None,
    working_shift_codes: Optional[List[str]] = None,
    locks: Dict[Tuple[str, date, str], bool] = None
) -> None:
    """Add sequencing constraints for shift patterns.
    
    Args:
        required_rest_after_shifts: List of dicts with keys:
            - shift: shift code that requires rest after
            - rest_days: number of rest days required
            - rest_code: code to use for rest (e.g., "O")
        working_shift_codes: List of working shift codes from database/config
        locks: Lock constraints (force/forbid specific assignments)
    """
    if not required_rest_after_shifts:
        # Default to hardcoded rules if not provided
        required_rest_after_shifts = [
            {"shift": "N", "rest_days": 2, "rest_code": "O"},
            {"shift": "M4", "rest_days": 1, "rest_code": "O"},
            {"shift": "A", "rest_days": 1, "rest_code": "O"}
        ]
    
    # Working shifts from database/config (standard shifts that can be optimized)
    if working_shift_codes:
        working_shifts = set(working_shift_codes)
    else:
        # Fallback to standard shifts
        working_shifts = {"M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "IP+P", "P", "M+P"}
    
    # Determine leave codes (exclude working shifts)
    if leave_codes:
        leave_only_codes = leave_codes - working_shifts
    else:
        leave_only_codes = set()
    
    for emp in employees:
        for i, day in enumerate(dates):
            # Process each required rest rule
            for rule in required_rest_after_shifts:
                shift_code = rule["shift"]
                rest_days = rule["rest_days"]
                rest_code = rule["rest_code"]
                
                # Check if employee worked this shift today
                if (emp, day, shift_code) not in x:
                    continue
                
                # Check if this shift was requested (forced) by the employee
                # Only apply exception if the shift itself was requested, not if solver-assigned
                shift_is_requested = False
                if locks:
                    lock_key = (emp, day, shift_code)
                    if locks.get(lock_key) is True:
                        shift_is_requested = True
                
                # Check if employee already has a leave type assigned (skip rest requirement if so)
                # A leave type is any code in time_off that is not a working shift
                def has_leave_on_day(target_day):
                    if time_off and (emp, target_day) in time_off:
                        leave_code = time_off[(emp, target_day)]
                        if leave_code not in working_shifts and leave_code != rest_code:
                            return True
                    return False
                
                # Check if employee has a lock forcing them to work a working shift on target day
                def has_forced_work_on_day(target_day):
                    if locks:
                        # Check if any working shift is forced (locked to True) on this day
                        for shift in working_shifts:
                            lock_key = (emp, target_day, shift)
                            if locks.get(lock_key) is True:
                                return True
                    return False
                
                # Add rest day constraints for each required rest day
                for rest_day_offset in range(1, rest_days + 1):
                    if i + rest_day_offset >= len(dates):
                        break  # Not enough days remaining
                    
                    rest_day = dates[i + rest_day_offset]
                    
                    # Skip if employee has leave type on this rest day
                    if has_leave_on_day(rest_day):
                        continue
                    
                    # Skip if employee has a lock forcing them to work a working shift on this day
                    # BUT only if the shift itself was requested (not solver-assigned)
                    # This applies to N (2 rest days), M4 (1 rest day), and A (1 rest day)
                    # (e.g., if they requested N/M4/A and then requested another shift, respect their wishes)
                    # If solver assigned N/M4/A, it must still respect the O requirement
                    if shift_is_requested and has_forced_work_on_day(rest_day):
                        continue
                    
                    # Add constraint: shift_today <= rest_code_rest_day
                    if (emp, day, shift_code) in x and (emp, rest_day, rest_code) in x:
                        model.Add(x[(emp, day, shift_code)] <= x[(emp, rest_day, rest_code)])


def add_all_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    shifts: List[str],
    demands: Dict[date, Dict[str, int]],
    skills: Dict[str, Dict[str, bool]],
    time_off: Dict[Tuple[str, date], str],
    locks: Dict[Tuple[str, date, str], bool],
    caps: Dict[str, Dict[str, int]],
    min_days_off: Dict[str, int],
    rest_codes: Set[str],
    forbidden_pairs: List[Tuple[str, str]],
    weekly_rest_minimum: int = 1,
    leave_codes: Set[str] = None,
    required_rest_after_shifts: List[Dict[str, Any]] = None,
    working_shift_codes: Optional[List[str]] = None
) -> None:
    """Add all constraints to the model."""
    
    # Core constraints
    add_one_per_day_constraint(model, x, employees, dates, shifts)
    add_skill_constraints(model, x, employees, dates, skills, working_shift_codes)
    add_coverage_constraints(model, x, employees, dates, demands, working_shift_codes)
    
    # Time off and locks
    add_time_off_constraints(model, x, employees, dates, time_off)
    add_lock_constraints(model, x, employees, dates, locks, working_shift_codes)
    
    # Caps and rest
    add_cap_constraints(model, x, employees, dates, caps)
    add_minimum_days_off_constraints(model, x, employees, dates, min_days_off, rest_codes)
    add_weekly_rest_constraints(model, x, employees, dates, rest_codes, weekly_rest_minimum)
    
    # Adjacency rules (pass locks to allow employee requests to override forbidden pairs)
    add_adjacency_constraints(model, x, employees, dates, forbidden_pairs, locks)
    
    # Sequencing rules (pass time_off, leave_codes, and locks to check for existing leave types and forced work)
    add_sequencing_constraints(model, x, employees, dates, time_off, leave_codes, required_rest_after_shifts, working_shift_codes, locks)
    
    # CL availability constraint
    add_cl_availability_constraints(model, x, employees, dates, time_off)
    
    # Single skill employees work their shift Sun-Thu and rest Fri-Sat
    add_single_skill_employee_constraints(
        model, x, employees, dates, shifts, skills, time_off, locks, working_shift_codes
    )


def add_single_skill_employee_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    shifts: List[str],
    skills: Dict[str, Dict[str, bool]],
    time_off: Dict[Tuple[str, date], str],
    locks: Dict[Tuple[str, date, str], bool],
    working_shift_codes: Optional[List[str]] = None
) -> None:
    """Force single-skill employees to work their skill Sun-Thu and rest Fri-Sat."""
    # Working shifts from database/config (standard shifts that can be optimized)
    if working_shift_codes:
        working_shifts = set(working_shift_codes)
    else:
        # Fallback to standard shifts
        working_shifts = {"M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "IP+P", "P", "M+P"}
    weekend_days = {4, 5}  # Friday=4, Saturday=5
    
    for employee in employees:
        employee_skills = skills.get(employee, {})
        qualified_shifts = [
            shift for shift in working_shifts
            if employee_skills.get(shift, False)
        ]
        
        if len(qualified_shifts) != 1:
            continue
        
        single_shift = qualified_shifts[0]
        
        for day in dates:
            key = (employee, day, single_shift)
            if key not in x:
                continue
            
            if time_off and (employee, day) in time_off:
                continue
            
            lock_value = locks.get(key)
            if lock_value is False:
                continue
            
            if day.weekday() in weekend_days:
                # Skip if there is an explicit lock forcing work on weekend
                if lock_value is True:
                    continue
                model.Add(x[key] == 0)
            else:
                # Skip if another shift is explicitly locked in
                other_forced_shift = any(
                    locks.get((employee, day, shift)) is True
                    for shift in shifts
                    if shift != single_shift and (employee, day, shift) in x
                )
                if other_forced_shift:
                    continue
                
                model.Add(x[key] == 1)


def add_cl_availability_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    time_off: Dict[Tuple[str, date], str]
) -> None:
    """Ensure at most 1 CL person is on leave at any time."""
    # For now, this is handled by the data - we'll ensure only 1 CL person
    # has leave requests at a time in the database
    # This constraint can be expanded later if needed
    pass