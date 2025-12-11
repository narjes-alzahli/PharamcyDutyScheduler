"""Sanity checker for roster data before solving."""

from datetime import date
from typing import Dict, List, Tuple, Set, Optional
from .schema import RosterData


def check_roster_feasibility(data: RosterData) -> Tuple[bool, List[str]]:
    """
    Check if the roster data is feasible before solving.
    
    Returns:
        (is_feasible, list_of_issues)
    """
    issues = []
    
    employees = data.get_employee_names()
    dates = data.get_all_dates()
    demands = {day: data.get_daily_requirement(day) for day in dates}
    skills = {emp: data.get_employee_skills(emp) for emp in employees}
    
    # Get time_off and locks data
    time_off = {}
    for emp in employees:
        for day in dates:
            leave_code = data.get_leave_code(emp, day)
            if leave_code is not None:
                time_off[(emp, day)] = leave_code
    
    locks = {}
    shifts = data.get_shifts()
    for emp in employees:
        for day in dates:
            for shift in shifts:
                force = data.get_special_requirement_force(emp, day, shift)
                if force is not None:
                    locks[(emp, day, shift)] = force
    
    # Standard working shifts (skills-based)
    STANDARD_WORKING_SHIFTS = {"M", "IP", "A", "N", "M3", "M4", "H", "CL"}
    
    # Issue 1: Check coverage feasibility for each day/shift
    for day in dates:
        if day not in demands:
            continue
        
        day_demand = demands[day]
        
        for shift_type in STANDARD_WORKING_SHIFTS:
            if shift_type not in day_demand or day_demand[shift_type] <= 0:
                continue
            
            required_count = day_demand[shift_type]
            
            # Count available employees with the skill who can work this shift
            available_count = 0
            available_employees = []
            
            for emp in employees:
                emp_skills = skills.get(emp, {})
                
                # Check if employee has the skill
                # get_employee_skills returns dict with keys like "M", "IP", "A", etc.
                has_skill = False
                if shift_type in emp_skills and emp_skills.get(shift_type, False):
                    has_skill = True
                elif shift_type == "CL":
                    # CL can be worked by non-clinic-only employees
                    # get_employee_skills doesn't include clinic_only, so we need to check the employee data
                    # For now, we'll check this separately in Issue 5
                    # Assume CL is available if employee has skill_CL
                    has_skill = emp_skills.get("CL", False)
                
                if not has_skill:
                    continue
                
                # Check if employee is available (not on leave/time off)
                is_available = True
                
                # Check time_off
                if (emp, day) in time_off:
                    leave_code = time_off[(emp, day)]
                    # If it's a working shift, they're not available
                    if leave_code in STANDARD_WORKING_SHIFTS:
                        is_available = False
                    # If it's a leave code (not O), they're not available
                    elif leave_code != "O":
                        is_available = False
                
                # Check locks - if they're forced to work a different shift, they might still be available
                # But if they're forbidden from this shift, they're not available
                if (emp, day, shift_type) in locks:
                    if locks[(emp, day, shift_type)] is False:
                        is_available = False
                
                # Check if forced to work a different shift (conflict)
                for other_shift in STANDARD_WORKING_SHIFTS:
                    if other_shift != shift_type:
                        if (emp, day, other_shift) in locks and locks[(emp, day, other_shift)] is True:
                            is_available = False
                            break
                
                if is_available:
                    available_count += 1
                    available_employees.append(emp)
            
            if available_count < required_count:
                missing = required_count - available_count
                # Format date as "day month year" (e.g., "2 April 2025")
                date_str = day.strftime('%d %B %Y')
                issue = (
                    f"❌ Coverage shortfall on {date_str} for **{shift_type}**: "
                    f"Need {required_count} shifts, but only {available_count} capable employees available "
                    f"({', '.join(available_employees) if available_employees else 'none'}). "
                    f"Missing: {missing}"
                )
                issues.append(issue)
    
    # Issue 2: Check for conflicting requests (same employee, same day, multiple requests)
    employee_day_requests = {}
    for (emp, day), leave_code in time_off.items():
        if (emp, day) not in employee_day_requests:
            employee_day_requests[(emp, day)] = []
        employee_day_requests[(emp, day)].append(leave_code)
    
    for (emp, day), requests in employee_day_requests.items():
        if len(requests) > 1:
            unique_requests = list(set(requests))
            if len(unique_requests) > 1:
                date_str = day.strftime('%d %B %Y')
                issue = (
                    f"❌ Conflicting requests for {emp} on {date_str}: "
                    f"{', '.join(unique_requests)}"
                )
                issues.append(issue)
    
    # Also check locks for conflicts
    employee_day_locks = {}
    for (emp, day, shift), force in locks.items():
        if force is True:  # Only check forced assignments
            if (emp, day) not in employee_day_locks:
                employee_day_locks[(emp, day)] = []
            employee_day_locks[(emp, day)].append(shift)
    
    for (emp, day), locked_shifts in employee_day_locks.items():
        if len(locked_shifts) > 1:
            unique_shifts = list(set(locked_shifts))
            date_str = day.strftime('%d %B %Y')
            issue = (
                f"❌ Conflicting lock assignments for {emp} on {date_str}: "
                f"forced to work {', '.join(unique_shifts)}"
            )
            issues.append(issue)
    
    # Check time_off vs locks conflicts
    for (emp, day), leave_code in time_off.items():
        if leave_code not in STANDARD_WORKING_SHIFTS and leave_code != "O":
            # Employee has a leave type assigned, check if they're also forced to work
            for shift in STANDARD_WORKING_SHIFTS:
                if (emp, day, shift) in locks and locks[(emp, day, shift)] is True:
                    date_str = day.strftime('%d %B %Y')
                    issue = (
                        f"❌ Conflict for {emp} on {date_str}: "
                        f"has **{leave_code}** but also forced to work **{shift}**"
                    )
                    issues.append(issue)
        elif leave_code in STANDARD_WORKING_SHIFTS:
            # Non-standard shift (like MS, C) - not a leave type, just a shift assignment
            for shift in STANDARD_WORKING_SHIFTS:
                if shift != leave_code and (emp, day, shift) in locks and locks[(emp, day, shift)] is True:
                    date_str = day.strftime('%d %B %Y')
                    issue = (
                        f"❌ Conflict for {emp} on {date_str}: "
                        f"has **{leave_code}** but also forced to work **{shift}**"
                    )
                    issues.append(issue)
    
    # Issue 3: Check if employees request shifts they don't have skills for
    # Note: Non-standard shifts like MS, C are not skills, so they're OK
    for (emp, day), leave_code in time_off.items():
        # Only check if it's a standard working shift (not a leave code like AL, ML, etc.)
        if leave_code in STANDARD_WORKING_SHIFTS:
            emp_skills = skills.get(emp, {})
            # get_employee_skills returns dict with keys like "M", "IP", "A", etc.
            has_skill = emp_skills.get(leave_code, False)
            
            if not has_skill:
                date_str = day.strftime('%d %B %Y')
                issue = (
                    f"❌ Skill mismatch for {emp} on {date_str}: "
                    f"requested **{leave_code}** but doesn't have that skill"
                )
                issues.append(issue)
    
    # Check locks for skill mismatches
    for (emp, day, shift), force in locks.items():
        if force is True and shift in STANDARD_WORKING_SHIFTS:
            emp_skills = skills.get(emp, {})
            has_skill = False
            
            # get_employee_skills returns dict with keys like "M", "IP", "A", etc.
            has_skill = emp_skills.get(shift, False)
            
            if not has_skill:
                date_str = day.strftime('%d %B %Y')
                issue = (
                    f"❌ Skill mismatch for {emp} on {date_str}: "
                    f"forced to work **{shift}** but doesn't have that skill"
                )
                issues.append(issue)
    
    # Issue 4: Check for contradictory lock constraints
    # Check if employee is both forced and forbidden to work the same shift (shouldn't happen)
    lock_conflicts = {}
    for (emp, day, shift), force in locks.items():
        key = (emp, day, shift)
        if key not in lock_conflicts:
            lock_conflicts[key] = []
        lock_conflicts[key].append(force)
    
    for (emp, day, shift), force_values in lock_conflicts.items():
        if len(force_values) > 1:
            # Same shift has multiple lock entries - check if they conflict
            if True in force_values and False in force_values:
                date_str = day.strftime('%d %B %Y')
                issue = (
                    f"❌ Contradictory lock constraint for {emp} on {date_str} "
                    f"for **{shift}**: both forced and forbidden"
                )
                issues.append(issue)
    
    # Issue 5: Check if clinic-only employees are forced to work non-CL shifts
    # Note: clinic_only is not in skills dict, need to check employee data directly
    # For now, we'll skip this check as we don't have direct access to employee objects
    # This could be added if we pass employee data to the sanity checker
    
    # Issue 6: Check if single-skill employees are forced to work wrong shifts
    for emp in employees:
        emp_skills = skills.get(emp, {})
        qualified_shifts = [
            shift for shift in STANDARD_WORKING_SHIFTS
            if emp_skills.get(shift, False)
        ]
        
        if len(qualified_shifts) == 1:
            single_shift = qualified_shifts[0]
            # Check if they're forced to work a different shift
            for day in dates:
                for shift in STANDARD_WORKING_SHIFTS:
                    if shift != single_shift:
                        if (emp, day, shift) in locks and locks[(emp, day, shift)] is True:
                            date_str = day.strftime('%d %B %Y')
                            issue = (
                                f"❌ Single-skill employee {emp} on {date_str}: "
                                f"can only work **{single_shift}** but forced to work **{shift}**"
                            )
                            issues.append(issue)
    
    is_feasible = len(issues) == 0
    return is_feasible, issues

