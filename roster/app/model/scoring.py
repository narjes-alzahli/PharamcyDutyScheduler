"""Scoring system for staff rostering optimization."""

from datetime import date
from typing import Dict, List, Tuple, Optional, Any
from ortools.sat.python import cp_model
import numpy as np


class RosterScoring:
    """Scoring system for roster optimization with multiple objectives."""
    
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
        """Add lexicographic objective function to the model."""
        
        # Create auxiliary variables for scoring
        unfilled_vars = self._add_unfilled_coverage_variables(
            model, x, employees, dates, demands
        )
        
        fairness_vars = self._add_fairness_variables(
            model, x, employees, dates
        )
        
        switching_vars = self._add_area_switching_variables(
            model, x, employees, dates
        )
        
        do_after_n_vars = self._add_do_after_n_variables(
            model, x, employees, dates
        )
        
        # Lexicographic objective: minimize in order of importance
        objectives = []
        
        # 1. Unfilled coverage (highest priority)
        if unfilled_vars:
            objectives.append(sum(unfilled_vars) * self.weights["unfilled_coverage"])
            
        # 2. Fairness (variance in night/evening assignments)
        if fairness_vars:
            objectives.append(sum(fairness_vars) * self.weights["fairness"])
            
        # 3. Area switching penalties
        if switching_vars:
            objectives.append(sum(switching_vars) * self.weights["area_switching"])
            
        # 4. DO after N preference (tie-breaker)
        if do_after_n_vars:
            objectives.append(sum(do_after_n_vars) * self.weights["do_after_n"])
            
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
        """Add variables to track unfilled coverage."""
        unfilled_vars = []
        
        for day in dates:
            if day not in demands:
                continue
                
            day_demand = demands[day]
            
            for shift_type in ["M", "O", "IP", "A", "N"]:
                if shift_type in day_demand and day_demand[shift_type] > 0:
                    # Count actual assignments
                    assigned = model.NewIntVar(0, len(employees), f"assigned_{day}_{shift_type}")
                    shift_vars = [
                        x[(emp, day, shift_type)] 
                        for emp in employees
                    ]
                    model.Add(assigned == sum(shift_vars))
                    
                    # Track shortfall
                    shortfall = model.NewIntVar(0, day_demand[shift_type], f"shortfall_{day}_{shift_type}")
                    model.Add(shortfall >= day_demand[shift_type] - assigned)
                    unfilled_vars.append(shortfall)
                    
        return unfilled_vars
    
    def _add_fairness_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date]
    ) -> List[cp_model.IntVar]:
        """Add variables to penalize unfair distribution of night/evening shifts."""
        fairness_vars = []
        
        # Count night shifts per employee
        night_counts = []
        for emp in employees:
            night_vars = [x[(emp, day, "N")] for day in dates]
            night_count = model.NewIntVar(0, len(dates), f"night_count_{emp}")
            model.Add(night_count == sum(night_vars))
            night_counts.append(night_count)
            
        # Count evening shifts per employee
        evening_counts = []
        for emp in employees:
            evening_vars = [x[(emp, day, "A")] for day in dates]
            evening_count = model.NewIntVar(0, len(dates), f"evening_count_{emp}")
            model.Add(evening_count == sum(evening_vars))
            evening_counts.append(evening_count)
            
        # Add fairness penalties (simplified - minimize max - min)
        if night_counts:
            max_nights = model.NewIntVar(0, len(dates), "max_nights")
            min_nights = model.NewIntVar(0, len(dates), "min_nights")
            
            for count in night_counts:
                model.Add(max_nights >= count)
                model.Add(min_nights <= count)
                
            night_fairness = model.NewIntVar(0, len(dates), "night_fairness")
            model.Add(night_fairness == max_nights - min_nights)
            fairness_vars.append(night_fairness)
            
        if evening_counts:
            max_evenings = model.NewIntVar(0, len(dates), "max_evenings")
            min_evenings = model.NewIntVar(0, len(dates), "min_evenings")
            
            for count in evening_counts:
                model.Add(max_evenings >= count)
                model.Add(min_evenings <= count)
                
            evening_fairness = model.NewIntVar(0, len(dates), "evening_fairness")
            model.Add(evening_fairness == max_evenings - min_evenings)
            fairness_vars.append(evening_fairness)
            
        return fairness_vars
    
    def _add_area_switching_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date]
    ) -> List[cp_model.IntVar]:
        """Add variables to penalize switching between different areas."""
        switching_vars = []
        
        # Define area groups
        areas = {
            "M": "main",
            "O": "outpatient", 
            "IP": "inpatient",
            "A": "evening",
            "N": "night"
        }
        
        for emp in employees:
            for i in range(len(dates) - 1):
                day1, day2 = dates[i], dates[i+1]
                
                # Check for switches between different areas
                for area1, group1 in areas.items():
                    for area2, group2 in areas.items():
                        if group1 != group2:
                            # Penalty for switching from area1 to area2
                            switch = model.NewBoolVar(f"switch_{emp}_{day1}_{area1}_{area2}")
                            model.Add(
                                switch >= x[(emp, day1, area1)] + x[(emp, day2, area2)] - 1
                            )
                            switching_vars.append(switch)
                            
        return switching_vars
    
    def _add_do_after_n_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date]
    ) -> List[cp_model.IntVar]:
        """Add variables to reward DO (day off) after night shifts."""
        do_after_n_vars = []
        
        for emp in employees:
            for i in range(len(dates) - 1):
                day1, day2 = dates[i], dates[i+1]
                
                # Reward DO after N (negative penalty = positive reward)
                do_after_n = model.NewBoolVar(f"do_after_n_{emp}_{day1}")
                model.Add(
                    do_after_n >= x[(emp, day1, "N")] + x[(emp, day2, "DO")] - 1
                )
                # Use negative to make it a reward
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
        
        for shift_type in ["M", "O", "IP", "A", "N"]:
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
    employee_stats = {}
    for emp in employees:
        stats = {
            "nights": sum(assignments.get((emp, day, "N"), 0) for day in dates),
            "evenings": sum(assignments.get((emp, day, "A"), 0) for day in dates),
            "days_off": sum(assignments.get((emp, day, "DO"), 0) for day in dates),
            "main_shifts": sum(assignments.get((emp, day, "M"), 0) for day in dates),
            "outpatient_shifts": sum(assignments.get((emp, day, "O"), 0) for day in dates),
            "inpatient_shifts": sum(assignments.get((emp, day, "IP"), 0) for day in dates),
        }
        employee_stats[emp] = stats
        
    metrics["employee_stats"] = employee_stats
    
    # Fairness metrics
    night_counts = [stats["nights"] for stats in employee_stats.values()]
    evening_counts = [stats["evenings"] for stats in employee_stats.values()]
    
    metrics["fairness"] = {
        "night_variance": np.var(night_counts) if night_counts else 0,
        "evening_variance": np.var(evening_counts) if evening_counts else 0,
        "night_range": max(night_counts) - min(night_counts) if night_counts else 0,
        "evening_range": max(evening_counts) - min(evening_counts) if evening_counts else 0,
    }
    
    return metrics
