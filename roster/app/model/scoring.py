"""Scoring functions for staff rostering optimization."""

from datetime import date
from typing import Dict, List, Tuple, Any
from ortools.sat.python import cp_model


class RosterScoring:
    """Handles scoring and objective function for roster optimization."""
    
    def __init__(self, weights: Dict[str, float]):
        self.weights = weights
    
    def add_objective(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date],
        demands: Dict[date, Dict[str, int]],
        skills: Dict[str, Dict[str, bool]]
    ) -> None:
        """Add objective function to minimize penalties."""
        objectives = []
        
        # 1. Unfilled coverage penalty
        unfilled_vars = self._add_unfilled_coverage_variables(
            model, x, employees, dates, demands
        )
        if unfilled_vars:
            objectives.append(sum(unfilled_vars) * self.weights.get("unfilled_coverage", 100.0))
        
        # 2. Over-staffing penalty (encourage exact requirements)
        overstaffing_vars = self._add_overstaffing_variables(
            model, x, employees, dates, demands
        )
        if overstaffing_vars:
            objectives.append(sum(overstaffing_vars) * self.weights.get("overstaffing", 10.0))
        
        # 2. Fairness penalty
        fairness_vars = self._add_fairness_variables(
            model, x, employees, dates
        )
        if fairness_vars:
            objectives.append(sum(fairness_vars) * self.weights.get("fairness", 5.0))
        
        # 3. Area switching penalty
        area_vars = self._add_area_switching_variables(
            model, x, employees, dates
        )
        if area_vars:
            objectives.append(sum(area_vars) * self.weights.get("area_switching", 1.0))
        
        # 4. DO after N preference (tie-breaker)
        do_after_n_vars = self._add_do_after_n_variables(
            model, x, employees, dates
        )
        if do_after_n_vars:
            objectives.append(sum(do_after_n_vars) * self.weights.get("do_after_n", 1.0))
        
        if objectives:
            model.Minimize(sum(objectives))
    
    def _add_unfilled_coverage_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date],
        demands: Dict[date, Dict[str, int]]
    ) -> List[cp_model.IntVar]:
        """Add variables to penalize unfilled coverage."""
        unfilled_vars = []
        
        for day in dates:
            if day not in demands:
                continue
                
            day_demand = demands[day]
            
            for shift_type in ["M", "IP", "A", "N", "M3", "M4", "H", "CL"]:
                if shift_type in day_demand and day_demand[shift_type] > 0:
                    # Count assigned employees
                    assigned_vars = [x[(emp, day, shift_type)] for emp in employees]
                    assigned_count = model.NewIntVar(0, len(employees), f"assigned_{day}_{shift_type}")
                    model.Add(assigned_count == sum(assigned_vars))
                    
                    # Calculate shortfall
                    shortfall = model.NewIntVar(0, day_demand[shift_type], f"shortfall_{day}_{shift_type}")
                    model.Add(shortfall >= day_demand[shift_type] - assigned_count)
                    
                    unfilled_vars.append(shortfall)
        
        return unfilled_vars
    
    def _add_overstaffing_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date],
        demands: Dict[date, Dict[str, int]]
    ) -> List[cp_model.IntVar]:
        """Add variables to penalize over-staffing."""
        overstaffing_vars = []
        
        for day in dates:
            if day not in demands:
                continue
                
            day_demand = demands[day]
            
            for shift_type in ["M", "IP", "A", "N", "M3", "M4", "H", "CL"]:
                if shift_type in day_demand and day_demand[shift_type] > 0:
                    # Count assigned employees
                    assigned_vars = [x[(emp, day, shift_type)] for emp in employees]
                    assigned_count = model.NewIntVar(0, len(employees), f"assigned_{day}_{shift_type}")
                    model.Add(assigned_count == sum(assigned_vars))
                    
                    # Calculate over-staffing
                    overstaffing = model.NewIntVar(0, len(employees), f"overstaffing_{day}_{shift_type}")
                    model.Add(overstaffing >= assigned_count - day_demand[shift_type])
                    
                    overstaffing_vars.append(overstaffing)
        
        return overstaffing_vars
    
    def _add_fairness_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date]
    ) -> List[cp_model.IntVar]:
        """Add variables to penalize unfair distribution of shifts."""
        fairness_vars = []
        
        # Count shifts per employee
        night_counts = []
        afternoon_counts = []
        
        for emp in employees:
            # Night shifts
            night_vars = [x[(emp, day, "N")] for day in dates]
            night_count = model.NewIntVar(0, len(dates), f"night_count_{emp}")
            model.Add(night_count == sum(night_vars))
            night_counts.append(night_count)
            
            # Afternoon shifts
            afternoon_vars = [x[(emp, day, "A")] for day in dates]
            afternoon_count = model.NewIntVar(0, len(dates), f"afternoon_count_{emp}")
            model.Add(afternoon_count == sum(afternoon_vars))
            afternoon_counts.append(afternoon_count)
        
        # Fairness penalties (minimize variance)
        if night_counts:
            max_nights = model.NewIntVar(0, len(dates), "max_nights")
            min_nights = model.NewIntVar(0, len(dates), "min_nights")
            for count in night_counts:
                model.Add(max_nights >= count)
                model.Add(min_nights <= count)
            night_fairness = model.NewIntVar(0, len(dates), "night_fairness")
            model.Add(night_fairness == max_nights - min_nights)
            fairness_vars.append(night_fairness)
            
        if afternoon_counts:
            max_afternoons = model.NewIntVar(0, len(dates), "max_afternoons")
            min_afternoons = model.NewIntVar(0, len(dates), "min_afternoons")
            for count in afternoon_counts:
                model.Add(max_afternoons >= count)
                model.Add(min_afternoons <= count)
            afternoon_fairness = model.NewIntVar(0, len(dates), "afternoon_fairness")
            model.Add(afternoon_fairness == max_afternoons - min_afternoons)
            fairness_vars.append(afternoon_fairness)
        
        return fairness_vars
    
    def _add_area_switching_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date]
    ) -> List[cp_model.IntVar]:
        """Add variables to penalize area switching."""
        switching_vars = []
        
        for emp in employees:
            for i in range(len(dates) - 1):
                day1, day2 = dates[i], dates[i + 1]
                
                # Penalize switching between different areas
                areas = {
                    "M": "main", "IP": "ip", "A": "main", "N": "main", 
                    "M3": "main", "M4": "main", "H": "harat", "CL": "clinic"
                }
                
                for shift1 in areas:
                    for shift2 in areas:
                        if areas[shift1] != areas[shift2]:
                            switch_var = model.NewBoolVar(f"switch_{emp}_{day1}_{shift1}_{day2}_{shift2}")
                            model.Add(switch_var >= x[(emp, day1, shift1)] + x[(emp, day2, shift2)] - 1)
                            switching_vars.append(switch_var)
        
        return switching_vars
    
    def _add_do_after_n_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date]
    ) -> List[cp_model.IntVar]:
        """Add variables to prefer DO after N shifts."""
        do_after_n_vars = []
        
        for emp in employees:
            for i in range(len(dates) - 1):
                day1, day2 = dates[i], dates[i + 1]
                
                # Prefer DO after N
                do_after_n = model.NewBoolVar(f"do_after_n_{emp}_{day1}_{day2}")
                model.Add(do_after_n >= x[(emp, day1, "N")] + x[(emp, day2, "DO")] - 1)
                do_after_n_vars.append(do_after_n)
        
        return do_after_n_vars


def calculate_roster_metrics(
    assignments: Dict[Tuple[str, date, str], int],
    employees: List[str],
    dates: List[date],
    demands: Dict[date, Dict[str, int]]
) -> Dict[str, Any]:
    """Calculate various metrics for the roster."""
    metrics = {}
    
    # Coverage metrics
    coverage_shortfalls = {}
    for day in dates:
        if day not in demands:
            continue
        day_demand = demands[day]
        day_shortfalls = {}
        
        for shift_type in ["M", "IP", "A", "N", "M3", "M4", "H", "CL"]:
            if shift_type in day_demand:
                assigned = sum(
                    assignments.get((emp, day, shift_type), 0)
                    for emp in employees
                )
                shortfall = max(0, day_demand[shift_type] - assigned)
                day_shortfalls[shift_type] = shortfall
                
        coverage_shortfalls[day] = day_shortfalls
    
    metrics["coverage_shortfalls"] = coverage_shortfalls
    
    # Employee metrics
    employee_metrics = {}
    for emp in employees:
        emp_metrics = {
            "total_working_days": 0,
            "night_shifts": 0,
            "afternoon_shifts": 0,
            "weekend_shifts": 0
        }
        
        for day in dates:
            # Count working shifts
            working_shifts = ["M", "IP", "A", "N", "M3", "M4", "H", "CL"]
            for shift in working_shifts:
                if assignments.get((emp, day, shift), 0) == 1:
                    emp_metrics["total_working_days"] += 1
                    
                    if shift == "N":
                        emp_metrics["night_shifts"] += 1
                    elif shift == "A":
                        emp_metrics["afternoon_shifts"] += 1
                    
                    # Weekend shifts (Friday=4, Saturday=5)
                    if day.weekday() in [4, 5]:
                        emp_metrics["weekend_shifts"] += 1
        
        employee_metrics[emp] = emp_metrics
    
    metrics["employee_metrics"] = employee_metrics
    
    return metrics