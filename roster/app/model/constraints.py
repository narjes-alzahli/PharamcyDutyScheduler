"""Constraint functions for staff rostering optimization."""

from datetime import date, timedelta
from typing import Dict, List, Set, Tuple, Optional, Any
from ortools.sat.python import cp_model
import numpy as np


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
            # Sum of all shifts for this employee on this day must equal 1
            shift_vars = [x[(employee, day, shift)] for shift in shifts]
            model.Add(sum(shift_vars) == 1)


def add_coverage_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    demands: Dict[date, Dict[str, int]]
) -> None:
    """Add coverage constraints: meet daily demand for each shift type."""
    for day in dates:
        if day not in demands:
            continue
            
        day_demand = demands[day]
        
        # Coverage for each shift type
        for shift_type in ["M", "O", "IP", "A", "N"]:
            if shift_type in day_demand and day_demand[shift_type] > 0:
                # Sum of employees working this shift type on this day
                shift_vars = [
                    x[(emp, day, shift_type)] 
                    for emp in employees
                ]
                model.Add(sum(shift_vars) >= day_demand[shift_type])


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
            for shift_type in ["M", "O", "IP", "A", "N"]:
                if shift_type in employee_skills and not employee_skills[shift_type]:
                    # Employee cannot work this shift type
                    model.Add(x[(employee, day, shift_type)] == 0)


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
    """Add cap constraints: limit nights and evenings per employee per month."""
    for employee in employees:
        if employee not in caps:
            continue
            
        emp_caps = caps[employee]
        
        # Night shift cap
        if "maxN" in emp_caps:
            night_vars = [
                x[(employee, day, "N")] 
                for day in dates
            ]
            model.Add(sum(night_vars) <= emp_caps["maxN"])
            
        # Evening shift cap  
        if "maxA" in emp_caps:
            evening_vars = [
                x[(employee, day, "A")] 
                for day in dates
            ]
            model.Add(sum(evening_vars) <= emp_caps["maxA"])


def add_weekly_rest_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    rest_codes: Set[str],
    min_rest_days: int = 1
) -> None:
    """Add weekly rest constraints: each employee must have at least min_rest_days off per 7-day window."""
    for employee in employees:
        # For each 7-day window
        for i in range(len(dates) - 6):
            window_dates = dates[i:i+7]
            
            # Count rest days in this window
            rest_vars = []
            for day in window_dates:
                for code in rest_codes:
                    rest_vars.append(x[(employee, day, code)])
                    
            # Must have at least min_rest_days off in this window
            model.Add(sum(rest_vars) >= min_rest_days)


def add_adjacency_constraints(
    model: cp_model.CpModel,
    x: Dict[Tuple[str, date, str], cp_model.IntVar],
    employees: List[str],
    dates: List[date],
    forbidden_pairs: List[Tuple[str, str]]
) -> None:
    """Add adjacency constraints: prevent forbidden shift sequences."""
    for employee in employees:
        for i in range(len(dates) - 1):
            day1, day2 = dates[i], dates[i+1]
            
            for shift1, shift2 in forbidden_pairs:
                # Cannot work shift1 on day1 AND shift2 on day2
                model.Add(
                    x[(employee, day1, shift1)] + x[(employee, day2, shift2)] <= 1
                )


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
                rest_vars.append(x[(employee, day, code)])
                
        # Must have at least min_days_off rest days
        model.Add(sum(rest_vars) >= min_days_off[employee])


def create_decision_variables(
    model: cp_model.CpModel,
    employees: List[str],
    dates: List[date],
    shifts: List[str]
) -> Dict[Tuple[str, date, str], cp_model.IntVar]:
    """Create binary decision variables for the optimization model."""
    x = {}
    
    for employee in employees:
        for day in dates:
            for shift in shifts:
                x[(employee, day, shift)] = model.NewBoolVar(
                    f"x_{employee}_{day}_{shift}"
                )
                
    return x


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
    weekly_rest_minimum: int = 1
) -> None:
    """Add all constraints to the model."""
    
    # Core constraints
    add_one_per_day_constraint(model, x, employees, dates, shifts)
    add_coverage_constraints(model, x, employees, dates, demands)
    add_skill_constraints(model, x, employees, dates, skills)
    
    # Time off and locks
    add_time_off_constraints(model, x, employees, dates, time_off)
    add_lock_constraints(model, x, employees, dates, locks)
    
    # Caps and rest
    add_cap_constraints(model, x, employees, dates, caps)
    add_minimum_days_off_constraints(model, x, employees, dates, min_days_off, rest_codes)
    add_weekly_rest_constraints(model, x, employees, dates, rest_codes, weekly_rest_minimum)
    
    # Adjacency rules
    add_adjacency_constraints(model, x, employees, dates, forbidden_pairs)
