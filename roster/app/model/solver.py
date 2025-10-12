"""Main solver for staff rostering optimization."""

from datetime import date, timedelta
from typing import Dict, List, Tuple, Optional, Any
from ortools.sat.python import cp_model
import pandas as pd
import time

from .schema import RosterData, RosterConfig
from .constraints import add_all_constraints, create_decision_variables
from .scoring import RosterScoring, calculate_roster_metrics


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
            
        # Create decision variables
        x = create_decision_variables(model, employees, dates, shifts)
        
        # Prepare constraint data
        demands = {day: data.get_daily_requirement(day) for day in dates}
        skills = {emp: data.get_employee_skills(emp) for emp in employees}
        time_off = {
            (emp, day): data.get_leave_code(emp, day)
            for emp in employees
            for day in dates
            if data.get_leave_code(emp, day) is not None
        }
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
            self.config.weekly_rest_minimum
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
        dates: List[date]
    ) -> pd.DataFrame:
        """Create schedule DataFrame from assignments."""
        rows = []
        
        for emp in employees:
            for day in dates:
                # Find which shift this employee works on this day
                for shift in ["M", "O", "IP", "A", "N", "DO", "CL", "ML", "W", "UL"]:
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
        """Create coverage report showing met/shortfall per area/day."""
        rows = []
        
        for day in dates:
            if day not in demands:
                continue
                
            day_demand = demands[day]
            
            for shift_type in ["M", "O", "IP", "A", "N"]:
                if shift_type in day_demand:
                    assigned = sum(
                        assignments.get((emp, day, shift_type), 0)
                        for emp in employees
                    )
                    shortfall = max(0, day_demand[shift_type] - assigned)
                    
                    rows.append({
                        "date": day,
                        "shift": shift_type,
                        "needed": day_demand[shift_type],
                        "assigned": assigned,
                        "shortfall": shortfall,
                        "met": shortfall == 0
                    })
                    
        return pd.DataFrame(rows)
    
    def create_employee_report(
        self,
        assignments: Dict[Tuple[str, date, str], int],
        employees: List[str],
        dates: List[date]
    ) -> pd.DataFrame:
        """Create per-employee report with counts of shifts."""
        rows = []
        
        for emp in employees:
            stats = {
                "employee": emp,
                "nights": sum(assignments.get((emp, day, "N"), 0) for day in dates),
                "evenings": sum(assignments.get((emp, day, "A"), 0) for day in dates),
                "days_off": sum(assignments.get((emp, day, "DO"), 0) for day in dates),
                "main_shifts": sum(assignments.get((emp, day, "M"), 0) for day in dates),
                "outpatient_shifts": sum(assignments.get((emp, day, "O"), 0) for day in dates),
                "inpatient_shifts": sum(assignments.get((emp, day, "IP"), 0) for day in dates),
                "total_working_days": sum(
                    assignments.get((emp, day, shift), 0)
                    for day in dates
                    for shift in ["M", "O", "IP", "A", "N"]
                )
            }
            rows.append(stats)
            
        return pd.DataFrame(rows)


def solve_roster(
    data_dir: str,
    month: str,
    output_dir: str,
    config_file: Optional[str] = None,
    time_limit: int = 300
) -> bool:
    """
    Solve roster for a given month and save results.
    
    Args:
        data_dir: Path to directory containing CSV files
        month: Month to solve (YYYY-MM format)
        output_dir: Directory to save output files
        config_file: Optional path to configuration file
        time_limit: Time limit in seconds
        
    Returns:
        True if successful, False otherwise
    """
    from pathlib import Path
    
    # Load data
    data = RosterData(Path(data_dir))
    data.load_data()
    
    # Load config
    config = RosterConfig(Path(config_file) if config_file else None)
    
    # Create solver
    solver = RosterSolver(config)
    
    # Solve
    success, assignments, metrics = solver.solve(data, time_limit)
    
    if not success:
        print(f"Failed to solve roster for {month}")
        return False
        
    # Create output directory
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Save results
    employees = data.get_employee_names()
    dates = data.get_all_dates()
    
    # Schedule CSV
    schedule_df = solver.create_schedule_dataframe(assignments, employees, dates)
    schedule_df.to_csv(output_path / "schedule.csv", index=False)
    
    # Coverage report
    demands = {day: data.get_daily_demand(day) for day in dates}
    coverage_df = solver.create_coverage_report(assignments, employees, dates, demands)
    coverage_df.to_csv(output_path / "coverage_report.csv", index=False)
    
    # Employee report
    employee_df = solver.create_employee_report(assignments, employees, dates)
    employee_df.to_csv(output_path / "per_employee_report.csv", index=False)
    
    # Metrics summary
    metrics_df = pd.DataFrame([{
        "metric": "solve_time",
        "value": metrics.get("solve_time", 0),
        "unit": "seconds"
    }, {
        "metric": "status", 
        "value": metrics.get("status", "unknown"),
        "unit": "text"
    }, {
        "metric": "night_variance",
        "value": metrics.get("fairness", {}).get("night_variance", 0),
        "unit": "variance"
    }, {
        "metric": "evening_variance", 
        "value": metrics.get("fairness", {}).get("evening_variance", 0),
        "unit": "variance"
    }])
    metrics_df.to_csv(output_path / "metrics.csv", index=False)
    
    print(f"Successfully solved roster for {month}")
    print(f"Solve time: {metrics.get('solve_time', 0):.2f} seconds")
    print(f"Status: {metrics.get('status', 'unknown')}")
    
    return True
