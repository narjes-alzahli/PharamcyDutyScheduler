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
            model, x, employees, dates, skills
        )
        if fairness_vars:
            objectives.append(sum(fairness_vars) * self.weights.get("fairness", 5.0))
        
        # 3. Area switching penalty
        area_vars = self._add_area_switching_variables(
            model, x, employees, dates
        )
        if area_vars:
            objectives.append(sum(area_vars) * self.weights.get("area_switching", 1.0))
        
        # 4. DO after N preference removed - DO is now only assigned when requested in time off
        # (No longer preferring DO after N shifts)
        
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
                if shift_type in day_demand:
                    # Count assigned employees
                    assigned_vars = [x[(emp, day, shift_type)] for emp in employees]
                    assigned_count = model.NewIntVar(0, len(employees), f"assigned_{day}_{shift_type}")
                    model.Add(assigned_count == sum(assigned_vars))
                    
                    if day_demand[shift_type] > 0:
                        # Calculate shortfall for positive demand
                        shortfall = model.NewIntVar(0, day_demand[shift_type], f"shortfall_{day}_{shift_type}")
                        model.Add(shortfall >= day_demand[shift_type] - assigned_count)
                        unfilled_vars.append(shortfall)
                    else:
                        # Penalize any assignment when demand is 0
                        unfilled_vars.append(assigned_count)
        
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
                if shift_type in day_demand:
                    # Count assigned employees
                    assigned_vars = [x[(emp, day, shift_type)] for emp in employees]
                    assigned_count = model.NewIntVar(0, len(employees), f"assigned_{day}_{shift_type}")
                    model.Add(assigned_count == sum(assigned_vars))
                    
                    if day_demand[shift_type] > 0:
                        # Calculate over-staffing for positive demand
                        overstaffing = model.NewIntVar(0, len(employees), f"overstaffing_{day}_{shift_type}")
                        model.Add(overstaffing >= assigned_count - day_demand[shift_type])
                        overstaffing_vars.append(overstaffing)
                    else:
                        # Penalize any assignment when demand is 0
                        overstaffing_vars.append(assigned_count)
        
        return overstaffing_vars
    
    def _add_fairness_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date],
        skills: Dict[str, Dict[str, bool]]
    ) -> List[cp_model.IntVar]:
        """Add variables to penalize unfair distribution of shifts."""
        fairness_vars = []
        
        # Filter out clinicians (clinic_only employees)
        non_clinicians = [emp for emp in employees if not skills.get(emp, {}).get("clinic_only", False)]
        
        if len(non_clinicians) < 2:
            return fairness_vars  # Need at least 2 non-clinicians for fairness
        
        # Count shifts per non-clinician employee
        night_counts = []
        afternoon_counts = []
        m4_counts = []
        total_working_counts = []
        weekend_counts = []
        
        for emp in non_clinicians:
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
            
            # M4 shifts
            m4_vars = [x[(emp, day, "M4")] for day in dates]
            m4_count = model.NewIntVar(0, len(dates), f"m4_count_{emp}")
            model.Add(m4_count == sum(m4_vars))
            m4_counts.append(m4_count)
            
            # Total working days (all shifts except DO)
            working_shifts = ["M", "IP", "A", "N", "M3", "M4", "H", "CL"]
            working_vars = []
            for day in dates:
                for shift in working_shifts:
                    working_vars.append(x[(emp, day, shift)])
            total_working = model.NewIntVar(0, len(dates) * len(working_shifts), f"total_working_{emp}")
            model.Add(total_working == sum(working_vars))
            total_working_counts.append(total_working)
            
            # Weekend shifts (Friday=4, Saturday=5)
            weekend_vars = []
            for day in dates:
                if day.weekday() in [4, 5]:  # Friday or Saturday
                    for shift in working_shifts:
                        weekend_vars.append(x[(emp, day, shift)])
            weekend_count = model.NewIntVar(0, len(dates) * len(working_shifts), f"weekend_count_{emp}")
            model.Add(weekend_count == sum(weekend_vars))
            weekend_counts.append(weekend_count)
        
        # Fairness penalties (minimize variance between non-clinicians)
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
            
        if m4_counts:
            max_m4 = model.NewIntVar(0, len(dates), "max_m4")
            min_m4 = model.NewIntVar(0, len(dates), "min_m4")
            for count in m4_counts:
                model.Add(max_m4 >= count)
                model.Add(min_m4 <= count)
            m4_fairness = model.NewIntVar(0, len(dates), "m4_fairness")
            model.Add(m4_fairness == max_m4 - min_m4)
            fairness_vars.append(m4_fairness)
            
        if total_working_counts:
            max_working = model.NewIntVar(0, len(dates) * 8, "max_working")
            min_working = model.NewIntVar(0, len(dates) * 8, "min_working")
            for count in total_working_counts:
                model.Add(max_working >= count)
                model.Add(min_working <= count)
            working_fairness = model.NewIntVar(0, len(dates) * 8, "working_fairness")
            model.Add(working_fairness == max_working - min_working)
            fairness_vars.append(working_fairness)
            
        if weekend_counts:
            max_weekends = model.NewIntVar(0, len(dates) * 8, "max_weekends")
            min_weekends = model.NewIntVar(0, len(dates) * 8, "min_weekends")
            for count in weekend_counts:
                model.Add(max_weekends >= count)
                model.Add(min_weekends <= count)
            weekend_fairness = model.NewIntVar(0, len(dates) * 8, "weekend_fairness")
            model.Add(weekend_fairness == max_weekends - min_weekends)
            fairness_vars.append(weekend_fairness)
        
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
        """Deprecated: DO is now only assigned when requested in time off, not automatically after N shifts."""
        # This function is no longer used - DO preference after N has been removed
        return []


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