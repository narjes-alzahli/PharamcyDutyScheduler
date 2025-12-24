"""Main solver for staff rostering optimization."""

from datetime import date, timedelta
from typing import Dict, List, Tuple, Optional, Any
from ortools.sat.python import cp_model
import pandas as pd
import time

from .schema import RosterData, RosterConfig
from .constraints import add_all_constraints, create_decision_variables
from .scoring import RosterScoring, calculate_roster_metrics
from .sanity_check import check_roster_feasibility


class RosterSolver:
    """Main solver for staff rostering optimization."""
    
    def __init__(self, config: RosterConfig):
        self.config = config
        self.scoring = RosterScoring(config.weights)
        
    def solve(
        self,
        data: RosterData,
        time_limit_seconds: int = 300
    ) -> Tuple[bool, Dict[str, Any], Dict[str, Any]]:
        """
        Solve the roster optimization problem.
        
        Returns:
            (success, assignments, metrics)
        """
        # Create the model
        model = cp_model.CpModel()
        
        # Get data
        employees = data.get_employee_names()
        dates = data.get_all_dates()
        shifts = data.get_shifts()
        
        if not employees or not dates:
            return False, {}, {}
        
        # Run sanity check before solving
        is_feasible, issues = check_roster_feasibility(data)
        if not is_feasible:
            error_details = "\n".join(issues)
            return False, {}, {
                "status": "INFEASIBLE",
                "solve_time": 0,
                "sanity_check_failed": True,
                "issues": issues,
                "error_message": f"Sanity check failed. Found {len(issues)} issue(s):\n{error_details}"
            }
            
        # Prepare constraint data first
        demands = {day: data.get_daily_requirement(day) for day in dates}
        skills = {emp: data.get_employee_skills(emp) for emp in employees}
        time_off = {
            (emp, day): data.get_leave_code(emp, day)
            for emp in employees
            for day in dates
            if data.get_leave_code(emp, day) is not None
        }
        
        # Create decision variables with time_off data
        # Pass leave_codes from config so all active leave types are recognized
        leave_codes_set = set(self.config.leave_codes) if hasattr(self.config, 'leave_codes') and self.config.leave_codes else None
        working_shift_codes = getattr(self.config, 'working_shift_codes', None)
        x = create_decision_variables(model, employees, dates, shifts, time_off, leave_codes_set, working_shift_codes)
        locks = {
            (emp, day, shift): data.get_special_requirement_force(emp, day, shift)
            for emp in employees
            for day in dates
            for shift in shifts
            if data.get_special_requirement_force(emp, day, shift) is not None
        }
        
        # Prepare caps and min days off
        caps = {}
        min_days_off = {}
        for emp_data in data.employees:
            caps[emp_data.employee] = {
                "maxN": emp_data.maxN,
                "maxA": emp_data.maxA
            }
            min_days_off[emp_data.employee] = emp_data.min_days_off
        
        # Add all constraints
        add_all_constraints(
            model, x, employees, dates, shifts,
            demands, skills, time_off, locks, caps, min_days_off,
            self.config.rest_codes, self.config.forbidden_adjacencies,
            self.config.weekly_rest_minimum,
            leave_codes_set,  # Pass leave_codes to check for existing leave types in sequencing constraints
            getattr(self.config, 'required_rest_after_shifts', None),  # Pass configurable rest requirements
            working_shift_codes  # Pass working shift codes from database/config
        )
        
        # Add objective
        self.scoring.add_objective(model, x, employees, dates, demands, skills)
        
        # Solve
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = time_limit_seconds
        
        start_time = time.time()
        status = solver.Solve(model)
        solve_time = time.time() - start_time
        
        if status in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
            # Extract solution
            assignments = {}
            for (emp, day, shift), var in x.items():
                if solver.Value(var) == 1:
                    assignments[(emp, day, shift)] = 1
                    
            # Calculate metrics
            metrics = calculate_roster_metrics(assignments, employees, dates, demands)
            metrics["solve_time"] = solve_time
            metrics["status"] = "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE"
            
            return True, assignments, metrics
        else:
            return False, {}, {"status": "INFEASIBLE", "solve_time": solve_time}
    
    def create_schedule_dataframe(
        self,
        assignments: Dict[Tuple[str, date, str], int],
        employees: List[str],
        dates: List[date],
        data: RosterData
    ) -> pd.DataFrame:
        """Create schedule DataFrame from assignments.
        
        Args:
            assignments: Dictionary mapping (employee, date, shift) to 1 if assigned
            employees: List of employee names
            dates: List of dates in the schedule
            data: RosterData object to get dynamic shifts (including leave types like CS)
        """
        rows = []
        
        # Get all possible shifts dynamically (includes leave codes like CS)
        shifts = data.get_shifts()
        
        for emp in employees:
            for day in dates:
                # Find which shift this employee works on this day
                for shift in shifts:
                    if assignments.get((emp, day, shift), 0) == 1:
                        rows.append({
                            "date": day,
                            "employee": emp,
                            "shift": shift
                        })
                        break
                        
        return pd.DataFrame(rows)
    
    def create_coverage_report(
        self,
        assignments: Dict[Tuple[str, date, str], int],
        employees: List[str],
        dates: List[date],
        demands: Dict[date, Dict[str, int]]
    ) -> pd.DataFrame:
        """Create coverage report showing daily staffing levels."""
        rows = []
        
        for day in dates:
            if day not in demands:
                continue
                
            day_demand = demands[day]
            row = {"date": day}
            
            for shift_type in ["M", "IP", "A", "N", "M3", "M4", "H", "CL"]:
                if shift_type in day_demand:
                    assigned = sum(
                        assignments.get((emp, day, shift_type), 0)
                        for emp in employees
                    )
                    row[f"{shift_type}_assigned"] = assigned
                    row[f"{shift_type}_required"] = day_demand[shift_type]
                    row[f"{shift_type}_shortfall"] = max(0, day_demand[shift_type] - assigned)
            
            rows.append(row)
        
        return pd.DataFrame(rows)
    
    def create_employee_report(
        self,
        assignments: Dict[Tuple[str, date, str], int],
        employees: List[str],
        dates: List[date],
        demands: Dict[date, Dict[str, int]] = None,
        initial_pending_off: Dict[str, float] = None,
        roster_data: 'RosterData' = None
    ) -> pd.DataFrame:
        """Create employee workload report with pending_off calculation."""
        rows = []
        
        for emp in employees:
            total_working_days = 0
            night_shifts = 0
            afternoon_shifts = 0
            weekend_shifts = 0
            DOs_given = 0  # Only count "DO" (Day Off) codes
            
            for day in dates:
                # Count working shifts
                working_shifts = ["M", "IP", "A", "N", "M3", "M4", "H", "CL"]
                for shift in working_shifts:
                    if assignments.get((emp, day, shift), 0) == 1:
                        total_working_days += 1
                        
                        if shift == "N":
                            # Night shift counting logic: Friday/Saturday/vacation counts as 2
                            is_weekend = day.weekday() in [4, 5]  # Friday=4, Saturday=5
                            # Check for holiday using roster_data.get_holiday() instead of demands dict
                            is_vacation = roster_data and roster_data.get_holiday(day) is not None
                            
                            if is_weekend or is_vacation:
                                night_shifts += 2  # Count as 2 for pending_off calculation
                            else:
                                night_shifts += 1
                        elif shift == "A":
                            afternoon_shifts += 1
                        
                        # Weekend shifts (Friday=4, Saturday=5) - any shift on weekend
                        if day.weekday() in [4, 5]:
                            weekend_shifts += 1
                
                # Count only "DO" (Day Off) codes for pending_off calculation
                if assignments.get((emp, day, "DO"), 0) == 1:
                    DOs_given += 1
            
            # Calculate pending_off: (weekend_shifts + night_shifts + previous_pending_off) - (DOs_given + previous_DOs)
            previous_pending_off = initial_pending_off.get(emp, 0.0) if initial_pending_off else 0.0
            previous_DOs = 0.0  # Set to 0 for now as requested
            pending_off = weekend_shifts + night_shifts + previous_pending_off - DOs_given - previous_DOs
            
            rows.append({
                "employee": emp,
                "total_working_days": total_working_days,
                "night_shifts": night_shifts,
                "afternoon_shifts": afternoon_shifts,
                "weekend_shifts": weekend_shifts,
                "DOs_given": DOs_given,
                "pending_off": pending_off
            })
        
        return pd.DataFrame(rows)