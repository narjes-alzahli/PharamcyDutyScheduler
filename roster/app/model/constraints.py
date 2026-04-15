"""Constraint functions for staff rostering optimization."""

from datetime import date, timedelta
from typing import Dict, List, Set, Tuple, Optional, Any
from ortools.sat.python import cp_model
import numpy as np

# Default standard working shifts (fallback when working_shift_codes not provided)
# These should match what's in the database - updated when standard shifts change
# In practice, working_shift_codes should always be provided from the backend
_DEFAULT_STANDARD_SHIFTS = {"M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "MS", "IP+P", "P", "M+P"}
_DEFAULT_STANDARD_SHIFTS_LIST = ["M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "MS", "IP+P", "P", "M+P"]


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
            # Restrict to CL-only: if CL is the only skill, employee can only work CL shifts
            if employee_skills.get("CL", False) and not any(
                employee_skills.get(shift, False)
                for shift in working_shifts
                if shift != "CL"
            ):
                # Can only work CL
                for shift_type in working_shifts:
                    if shift_type != "CL" and (employee, day, shift_type) in x:
                        model.Add(x[(employee, day, shift_type)] == 0)
                continue
            
            # Handle regular skill constraints
            for shift_type in working_shifts:
                if shift_type in employee_skills and not employee_skills[shift_type]:
                    # Employee cannot work this shift type
                    model.Add(x[(employee, day, shift_type)] == 0)


# Shifts with soft coverage only (can be under-staffed; penalized in scoring). All others are hard.
_SOFT_COVERAGE_SHIFTS = {"M", "IP"}


def add_coverage_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    demands: Dict[date, Dict[str, int]],
    working_shift_codes: Optional[List[str]] = None
) -> None:
    """Add coverage constraints: hard for all shifts except M and IP; M and IP are soft (see scoring)."""
    if working_shift_codes:
        working_shifts = set(working_shift_codes)
    else:
        working_shifts = set(_DEFAULT_STANDARD_SHIFTS_LIST)

    for day in dates:
        if day not in demands:
            continue
        day_demand = demands[day]

        for shift_type in working_shifts:
            if shift_type not in day_demand:
                continue
            if shift_type in _SOFT_COVERAGE_SHIFTS:
                continue
            demand = day_demand[shift_type]
            assigned_vars = [
                x[(emp, day, shift_type)] for emp in employees
                if (emp, day, shift_type) in x
            ]
            if not assigned_vars:
                continue
            assigned_count = sum(assigned_vars)
            model.Add(assigned_count == demand)


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
        working_shifts = {"M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "MS", "IP+P", "P", "M+P"}
    
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
    """Sequencing / rest-after-shift rules.
    
    Rest rules (e.g. 2 O after N, 1 O after M4, 1 O after A) are no longer enforced as hard
    constraints here. They are implemented as soft constraints with high priority in scoring
    (see scoring.py: _add_rest_after_shift_variables and weight rest_after_shift). This allows
    the solver to produce a schedule when strict rest would make the problem infeasible.
    
    Args:
        required_rest_after_shifts: List of dicts with keys:
            - shift: shift code that requires rest after
            - rest_days: number of rest days required
            - rest_code: code to use for rest (e.g., "O")
        working_shift_codes: List of working shift codes from database/config
        locks: Lock constraints (force/forbid specific assignments)
    """
    # Rest-after-shift is now soft (high-priority penalty in scoring.py), so no hard constraints added here.
    # Kept required_rest_after_shifts / working_shifts / leave_codes / locks for possible future use
    # (e.g. sanity checks or documentation). Parameter signature unchanged for callers.
    pass


def add_weekend_workload_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    shifts: List[str],
    locks: Dict[Tuple[str, date, str], bool],
    working_shift_codes: Optional[List[str]] = None
) -> None:
    """Weekend rules for Fri/Sat:
    1) In each weekend, employee can work only one of Fri/Sat, unless both days are explicitly requested.
    2) If employee works Fri/Sat in a weekend, next weekend should be O/O unless that next weekend day is explicitly requested.
    """
    if working_shift_codes:
        working_shifts = set(working_shift_codes)
    else:
        working_shifts = set(_DEFAULT_STANDARD_SHIFTS_LIST)

    date_set = set(dates)
    sorted_dates = sorted(dates)
    friday_dates = [d for d in sorted_dates if d.weekday() == 4]  # Friday

    for employee in employees:
        for friday in friday_dates:
            saturday = friday + timedelta(days=1)
            if saturday not in date_set:
                continue

            fri_work_vars = [
                x[(employee, friday, shift)]
                for shift in working_shifts
                if (employee, friday, shift) in x
            ]
            sat_work_vars = [
                x[(employee, saturday, shift)]
                for shift in working_shifts
                if (employee, saturday, shift) in x
            ]
            if not fri_work_vars or not sat_work_vars:
                continue

            fri_forced_work = any(locks.get((employee, friday, shift)) is True for shift in working_shifts)
            sat_forced_work = any(locks.get((employee, saturday, shift)) is True for shift in working_shifts)

            # Weekend at-most-one workday unless both days are explicitly requested.
            if not (fri_forced_work and sat_forced_work):
                model.Add(sum(fri_work_vars) + sum(sat_work_vars) <= 1)

            # works_this_weekend = 1 iff employee works Friday or Saturday in this weekend.
            works_this_weekend = model.NewBoolVar(f"works_weekend_{employee}_{friday}")
            weekend_work_sum = sum(fri_work_vars) + sum(sat_work_vars)
            model.Add(weekend_work_sum >= works_this_weekend)
            model.Add(weekend_work_sum <= 2 * works_this_weekend)

            next_friday = friday + timedelta(days=7)
            next_saturday = friday + timedelta(days=8)

            # If they worked this weekend, next Fri/Sat should be O unless explicit request forces work.
            for target_day in (next_friday, next_saturday):
                if target_day not in date_set:
                    continue
                if (employee, target_day, "O") not in x:
                    continue

                forced_work_next_day = any(
                    locks.get((employee, target_day, shift)) is True
                    for shift in working_shifts
                )
                if forced_work_next_day:
                    continue

                model.Add(x[(employee, target_day, "O")] == 1).OnlyEnforceIf(works_this_weekend)


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

    # Weekend rules:
    # - Fri/Sat at-most-one workday unless both are explicitly requested
    # - If worked this weekend, next weekend should be O/O unless explicitly requested otherwise
    add_weekend_workload_constraints(model, x, employees, dates, shifts, locks, working_shift_codes)
    
    # CL availability constraint
    add_cl_availability_constraints(model, x, employees, dates, time_off)
    
    # Single skill employees work their shift Sun-Thu and rest Fri-Sat
    add_single_skill_employee_constraints(
        model, x, employees, dates, shifts, skills, time_off, locks, working_shift_codes, demands
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
    working_shift_codes: Optional[List[str]] = None,
    demands: Optional[Dict[date, Dict[str, int]]] = None,
) -> None:
    """Force single-skill employees to work their skill Sun-Thu and rest Fri-Sat."""
    # Working shifts from database/config (standard shifts that can be optimized)
    if working_shift_codes:
        working_shifts = set(working_shift_codes)
    else:
        # Fallback to standard shifts
        working_shifts = {"M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "MS", "IP+P", "P", "M+P"}
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
        if demands is not None:
            total_shift_demand = sum(int((demands.get(day, {}) or {}).get(single_shift, 0) or 0) for day in dates)
            if total_shift_demand <= 0:
                # Avoid forcing impossible work for single-skill staff when a shift has zero
                # demand across the entire period (e.g., MS default rollout).
                continue
        
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
                # If this exact shift is explicitly forced, honor that request.
                if lock_value is True:
                    continue

                # Skip if another shift is explicitly locked in
                other_forced_shift = any(
                    locks.get((employee, day, shift)) is True
                    for shift in shifts
                    if shift != single_shift and (employee, day, shift) in x
                )
                if other_forced_shift:
                    continue

                # If this employee's only skill is not needed on this weekday,
                # assign O instead of forcing an unnecessary working shift.
                day_single_shift_demand = 0
                if demands is not None:
                    day_single_shift_demand = int((demands.get(day, {}) or {}).get(single_shift, 0) or 0)

                if day_single_shift_demand <= 0:
                    model.Add(x[key] == 0)
                    # Only force O when there is no explicit forced assignment for the day.
                    forced_any_shift = any(
                        locks.get((employee, day, shift)) is True
                        for shift in shifts
                        if (employee, day, shift) in x
                    )
                    if (employee, day, "O") in x and locks.get((employee, day, "O")) is not False:
                        if not forced_any_shift:
                            model.Add(x[(employee, day, "O")] == 1)
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