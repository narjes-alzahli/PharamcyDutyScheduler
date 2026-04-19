"""Main solver for staff rostering optimization."""

from datetime import date, timedelta
from typing import Dict, List, Tuple, Any
from ortools.sat.python import cp_model
import pandas as pd
import time

from .schema import RosterData, RosterConfig
from .constraints import add_all_constraints, create_decision_variables
from .scoring import RosterScoring, calculate_roster_metrics
from .sanity_check import check_roster_feasibility

# Default standard working shifts (fallback when generating coverage reports)
# These should match what's in the database - updated when standard shifts change
_DEFAULT_STANDARD_SHIFTS_LIST = ["M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "IP+P", "P", "M+P"]


def replace_holiday_rest_o_with_ph(
    assignments: Dict[Tuple[str, date, str], int],
    employees: List[str],
    dates: List[date],
    data: RosterData,
) -> None:
    """After solve: on calendar holidays, rest day ``O`` becomes ``PH`` (public holiday off).

    Mutates ``assignments`` in place. The CP model still assigns ``O``; this is display/storage
    normalization only.
    """
    for emp in employees:
        for day in dates:
            if not data.get_holiday(day):
                continue
            key_o = (emp, day, "O")
            if assignments.get(key_o) != 1:
                continue
            del assignments[key_o]
            assignments[(emp, day, "PH")] = 1


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
        
        # Run sanity check before solving (❌ = blocking; ⚠️ = warning only)
        is_feasible, sanity_messages = check_roster_feasibility(data)
        sanity_errors = [m for m in sanity_messages if m.startswith("❌")]
        sanity_warnings = [m for m in sanity_messages if m.startswith("⚠️")]
        if sanity_errors:
            error_details = "\n".join(sanity_errors)
            return False, {}, {
                "status": "INFEASIBLE",
                "solve_time": 0,
                "sanity_check_failed": True,
                "issues": sanity_errors + sanity_warnings,
                "error_message": f"Sanity check failed. Found {len(sanity_errors)} issue(s):\n{error_details}"
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
        
        # Prepare min days off
        min_days_off = {}
        for emp_data in data.employees:
            min_days_off[emp_data.employee] = emp_data.min_days_off
        
        # Add all constraints
        add_all_constraints(
            model, x, employees, dates, shifts,
            demands, skills, time_off, locks, min_days_off,
            self.config.rest_codes, self.config.forbidden_adjacencies,
            self.config.weekly_rest_minimum,
            leave_codes_set,  # Pass leave_codes to check for existing leave types in sequencing constraints
            getattr(self.config, 'required_rest_after_shifts', None),  # Pass configurable rest requirements
            working_shift_codes  # Pass working shift codes from database/config
        )
        
        # [HISTORY_AWARE_FAIRNESS] Extract assignment history for fairness calculations
        history_counts = None
        if hasattr(data, 'history_counts'):
            history_counts = data.history_counts
        
        # Add objective (rest-after-shift is soft, high-priority penalty)
        required_rest = getattr(self.config, "required_rest_after_shifts", None)
        leave_codes_set = set(self.config.leave_codes) if getattr(self.config, "leave_codes", None) else None
        working_shift_codes = getattr(self.config, "working_shift_codes", None)
        self.scoring.add_objective(
            model, x, employees, dates, demands, skills, history_counts,
            time_off=time_off,
            initial_pending_off={emp.employee: float(emp.pending_off or 0.0) for emp in data.employees},
            required_rest_after_shifts=required_rest,
            leave_codes=leave_codes_set,
            locks=locks,
            working_shift_codes=working_shift_codes,
            previous_period_shifts=getattr(data, "previous_period_shifts", None),
            as_preferences=getattr(data, "as_preferences", None),
        )
        
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

            replace_holiday_rest_o_with_ph(assignments, employees, dates, data)
                    
            # Calculate metrics
            metrics = calculate_roster_metrics(assignments, employees, dates, demands)
            metrics["solve_time"] = solve_time
            metrics["status"] = "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE"
            if sanity_warnings:
                metrics["sanity_warnings"] = sanity_warnings
            
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
            
            for shift_type in _DEFAULT_STANDARD_SHIFTS_LIST:
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
        roster_data: 'RosterData' = None,
    ) -> pd.DataFrame:
        """Create employee workload report with pending_off calculation.

        pending_off = (
            weekend_days_in_scope_not_on_leave
            + (1 per N shift on a normal weekday, 2 per N on Fri/Sat or holiday)
            + previous_pending_off
        ) - (count of DO + non-holiday O shifts in the period)

        Weekend days are Fri/Sat (weekday() 4,5). ``dates`` should cover the roster period
        (typically full month) so weekend_days matches calendar Fri/Sat in that range.
        """
        rows = []
        weekend_dates = [d for d in dates if d.weekday() in (4, 5)]

        leave_codes = set()
        rest_codes = {"O"}
        if roster_data and hasattr(roster_data, "config") and roster_data.config:
            leave_codes = set(getattr(roster_data.config, "leave_codes", None) or [])
            rest_codes = set(getattr(roster_data.config, "rest_codes", None) or ["O"])
        off_deduction_codes = {"O", "DO"}

        for emp in employees:
            total_working_days = 0
            night_shifts = 0  # weighted N credit: +1 normal weekday, +2 Fri/Sat or holiday
            afternoon_shifts = 0
            Os_given = 0  # "DO" and non-holiday "O" reduce pending off
            weekend_days_in_month = 0

            for day in dates:
                # Count working shifts
                working_shifts = ["M", "IP", "A", "N", "M3", "M4", "H", "CL"]
                for shift in working_shifts:
                    if assignments.get((emp, day, shift), 0) == 1:
                        total_working_days += 1

                        if shift == "N":
                            is_weekend = day.weekday() in (4, 5)  # Friday, Saturday
                            is_holiday = bool(roster_data.get_holiday(day)) if roster_data else False
                            night_shifts += 2 if (is_weekend or is_holiday) else 1
                        elif shift == "A":
                            afternoon_shifts += 1

                is_holiday = bool(roster_data.get_holiday(day)) if roster_data else False
                for off_code in off_deduction_codes:
                    if assignments.get((emp, day, off_code), 0) != 1:
                        continue
                    if off_code == "O" and is_holiday:
                        continue
                    Os_given += 1

            # Leave weekends do not add pending-off weekend credit.
            for weekend_day in weekend_dates:
                assigned_leave = any(
                    assignments.get((emp, weekend_day, leave_code), 0) == 1
                    for leave_code in leave_codes
                    if leave_code not in rest_codes
                )
                # PH is typically in rest_codes; still treat assigned PH as "not a working weekend" for P/O.
                if assignments.get((emp, weekend_day, "PH"), 0) == 1:
                    assigned_leave = True
                if not assigned_leave:
                    weekend_days_in_month += 1

            previous_pending_off_raw = initial_pending_off.get(emp, 0.0) if initial_pending_off else 0.0
            previous_pending_off_numeric = (
                float(previous_pending_off_raw) if previous_pending_off_raw is not None else 0.0
            )
            pending_off = weekend_days_in_month + night_shifts + previous_pending_off_numeric - Os_given

            # For single-skill employees, preserve previous month's value.
            if roster_data and hasattr(roster_data, "get_employee_skills"):
                emp_skills = roster_data.get_employee_skills(emp) or {}
                # Count enabled skill flags directly from employee skills so non-default
                # standard skills (e.g. MS) are also treated correctly.
                enabled_skill_count = sum(1 for is_enabled in emp_skills.values() if bool(is_enabled))
                if enabled_skill_count == 1:
                    pending_off = previous_pending_off_raw

            rows.append({
                "employee": emp,
                "total_working_days": total_working_days,
                "night_shifts": night_shifts,
                "afternoon_shifts": afternoon_shifts,
                "weekend_days_in_month": weekend_days_in_month,
                "Os_given": Os_given,
                "pending_off": pending_off
            })
        
        return pd.DataFrame(rows)