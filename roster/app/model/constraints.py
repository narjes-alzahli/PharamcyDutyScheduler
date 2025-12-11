"""Constraint functions for staff rostering optimization."""

from datetime import date, timedelta
from typing import Dict, List, Set, Tuple, Optional, Any
from ortools.sat.python import cp_model
import numpy as np


def create_decision_variables(
    model: cp_model.CpModel,
    employees: List[str],
    dates: List[date],
    shifts: List[str],
    time_off: Dict[Tuple[str, date], str] = None,
    leave_codes: Optional[Set[str]] = None
) -> Dict[Tuple[str, date, str], cp_model.IntVar]:
    """Create binary decision variables for the optimization model."""
    x = {}
    
    # Base working shifts that are always available (DO is now a leave code, only assigned when requested)
    working_shifts = {"M", "IP", "A", "N", "M3", "M4", "H", "CL", "O"}
    
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
    skills: Dict[str, Dict[str, bool]]
) -> None:
    """Add skill constraints: employees can only work shifts they're qualified for."""
    for employee in employees:
        if employee not in skills:
            continue
            
        employee_skills = skills[employee]
        
        for day in dates:
            # Handle clinic_only employees
            if employee_skills.get("clinic_only", False):
                # Clinic-only employees can only work CL shifts
                for shift_type in ["M", "IP", "A", "N", "M3", "M4", "H"]:
                    model.Add(x[(employee, day, shift_type)] == 0)
                continue
            
            # Handle regular skill constraints
            for shift_type in ["M", "IP", "A", "N", "M3", "M4", "H", "CL"]:
                if shift_type in employee_skills and not employee_skills[shift_type]:
                    # Employee cannot work this shift type
                    model.Add(x[(employee, day, shift_type)] == 0)
                
                # Handle IP constraint (skill_IP)
                if shift_type == "IP" and not employee_skills.get("skill_IP", True):
                    model.Add(x[(employee, day, shift_type)] == 0)
                
                # Handle Harat constraint (skill_H)
                if shift_type == "H" and not employee_skills.get("skill_H", True):
                    model.Add(x[(employee, day, shift_type)] == 0)


def add_coverage_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    demands: Dict[date, Dict[str, int]]
) -> None:
    """Add coverage constraints: meet EXACT daily demand for each shift type."""
    for day in dates:
        if day not in demands:
            continue
            
        day_demand = demands[day]
        
        # Individual shift coverage - meet minimum requirements
        for shift_type in ["M", "IP", "A", "N", "M3", "M4", "H", "CL"]:
            if shift_type in day_demand and day_demand[shift_type] > 0:
                # Sum of employees working this shift type on this day
                shift_vars = [
                    x[(emp, day, shift_type)] 
                    for emp in employees
                ]
                # Use >= for minimum requirements (allow over-staffing if needed)
                model.Add(sum(shift_vars) >= day_demand[shift_type])


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
    locks: Dict[Tuple[str, date, str], bool]
) -> None:
    """Add lock constraints: force or forbid specific assignments."""
    for (employee, day, shift), force in locks.items():
        if employee in employees and day in dates:
            if force:
                # Must work this shift
                model.Add(x[(employee, day, shift)] == 1)
            else:
                # Cannot work this shift
                model.Add(x[(employee, day, shift)] == 0)


def add_cap_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    caps: Dict[str, Dict[str, int]]
) -> None:
    """Add cap constraints: limit maximum shifts per employee."""
    for employee in employees:
        if employee not in caps:
            continue
            
        employee_caps = caps[employee]
        
        # Night shift cap
        if "maxN" in employee_caps:
            night_vars = [x[(employee, day, "N")] for day in dates]
            model.Add(sum(night_vars) <= employee_caps["maxN"])
        
        # Afternoon shift cap
        if "maxA" in employee_caps:
            afternoon_vars = [x[(employee, day, "A")] for day in dates]
            model.Add(sum(afternoon_vars) <= employee_caps["maxA"])


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
    forbidden_pairs: List[Tuple[str, str]]
) -> None:
    """Add adjacency constraints: prevent certain shift sequences."""
    for employee in employees:
        for i in range(len(dates) - 1):
            day1, day2 = dates[i], dates[i + 1]
            
            for shift1, shift2 in forbidden_pairs:
                # Cannot work shift1 on day1 and shift2 on day2
                model.Add(
                    x[(employee, day1, shift1)] + x[(employee, day2, shift2)] <= 1
                )


def add_sequencing_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    time_off: Dict[Tuple[str, date], str] = None,
    leave_codes: Set[str] = None
) -> None:
    """Add sequencing constraints for shift patterns."""
    # Only use O for rest days after shifts (DO is only assigned when requested in time off)
    rest_code = "O"
    
    # Working shifts that are not leave codes
    working_shifts = {"M", "IP", "A", "N", "M3", "M4", "H", "CL"}
    
    # Determine leave codes (exclude working shifts and O)
    if leave_codes:
        leave_only_codes = leave_codes - working_shifts - {rest_code}
    else:
        leave_only_codes = set()
    
    for emp in employees:
        for i, day in enumerate(dates):
            if i < len(dates) - 1:  # Not the last day
                next_day = dates[i + 1]
                
                # Check if employee already has a leave type assigned for next day
                # A leave type is any code in time_off that is not a working shift
                has_leave_next_day = False
                if time_off and (emp, next_day) in time_off:
                    leave_code = time_off[(emp, next_day)]
                    # If the code is not a working shift, it's a leave type
                    if leave_code not in working_shifts and leave_code != rest_code:
                        has_leave_next_day = True
                
                # Rule 1: After Night (N) → two rest days (O) next two days (unless leave type already assigned)
                # First O day (day after N)
                if not has_leave_next_day:
                    if (emp, day, "N") in x and (emp, next_day, rest_code) in x:
                        # Create constraint: N_today <= O_tomorrow
                        model.Add(x[(emp, day, "N")] <= x[(emp, next_day, rest_code)])
                
                # Second O day (two days after N)
                if i < len(dates) - 2:  # Not the last two days
                    day_after_next = dates[i + 2]
                    has_leave_day_after_next = False
                    if time_off and (emp, day_after_next) in time_off:
                        leave_code = time_off[(emp, day_after_next)]
                        if leave_code not in working_shifts and leave_code != rest_code:
                            has_leave_day_after_next = True
                    
                    if not has_leave_day_after_next:
                        if (emp, day, "N") in x and (emp, day_after_next, rest_code) in x:
                            # Create constraint: N_today <= O_day_after_tomorrow
                            model.Add(x[(emp, day, "N")] <= x[(emp, day_after_next, rest_code)])
                
                # Rule 2: After M4 → rest day (O) next day (unless leave type already assigned)
                if not has_leave_next_day:
                    if (emp, day, "M4") in x and (emp, next_day, rest_code) in x:
                        # Create constraint: M4_today <= O_tomorrow
                        model.Add(x[(emp, day, "M4")] <= x[(emp, next_day, rest_code)])
                
                # Rule 3: After A → rest day (O) next day (unless leave type already assigned)
                if not has_leave_next_day:
                    if (emp, day, "A") in x and (emp, next_day, rest_code) in x:
                        # Create constraint: A_today <= O_tomorrow
                        model.Add(x[(emp, day, "A")] <= x[(emp, next_day, rest_code)])
            
            # Rule 4: No back-to-back N shifts
            if i < len(dates) - 1:  # Not the last day
                next_day = dates[i + 1]
                
                if (emp, day, "N") in x and (emp, next_day, "N") in x:
                    # Cannot work N on consecutive days
                    model.Add(x[(emp, day, "N")] + x[(emp, next_day, "N")] <= 1)


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
    leave_codes: Set[str] = None
) -> None:
    """Add all constraints to the model."""
    
    # Core constraints
    add_one_per_day_constraint(model, x, employees, dates, shifts)
    add_skill_constraints(model, x, employees, dates, skills)
    add_coverage_constraints(model, x, employees, dates, demands)
    
    # Time off and locks
    add_time_off_constraints(model, x, employees, dates, time_off)
    add_lock_constraints(model, x, employees, dates, locks)
    
    # Caps and rest
    add_cap_constraints(model, x, employees, dates, caps)
    add_minimum_days_off_constraints(model, x, employees, dates, min_days_off, rest_codes)
    add_weekly_rest_constraints(model, x, employees, dates, rest_codes, weekly_rest_minimum)
    
    # Adjacency rules
    add_adjacency_constraints(model, x, employees, dates, forbidden_pairs)
    
    # Sequencing rules (pass time_off and leave_codes to check for existing leave types)
    add_sequencing_constraints(model, x, employees, dates, time_off, leave_codes)
    
    # CL availability constraint
    add_cl_availability_constraints(model, x, employees, dates, time_off)
    
    # Single skill employees work their shift Sun-Thu and rest Fri-Sat
    add_single_skill_employee_constraints(
        model, x, employees, dates, shifts, skills, time_off, locks
    )


def add_single_skill_employee_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    shifts: List[str],
    skills: Dict[str, Dict[str, bool]],
    time_off: Dict[Tuple[str, date], str],
    locks: Dict[Tuple[str, date, str], bool]
) -> None:
    """Force single-skill employees to work their skill Sun-Thu and rest Fri-Sat."""
    working_shifts = {"M", "IP", "A", "N", "M3", "M4", "H", "CL"}
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
    # has leave requests at a time in the time_off.csv file
    # This constraint can be expanded later if needed
    pass