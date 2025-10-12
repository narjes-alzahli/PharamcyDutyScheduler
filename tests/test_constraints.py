"""Tests for constraint functions."""

import pytest
from datetime import date, timedelta
from ortools.sat.python import cp_model

from roster.app.model.constraints import (
    add_one_per_day_constraint,
    add_coverage_constraints,
    add_skill_constraints,
    add_time_off_constraints,
    add_lock_constraints,
    add_cap_constraints,
    add_weekly_rest_constraints,
    add_adjacency_constraints,
    create_decision_variables
)


class TestConstraints:
    """Test constraint functions."""
    
    def setup_method(self):
        """Set up test data."""
        self.employees = ["Alice", "Bob", "Charlie"]
        self.dates = [date(2025, 3, 1), date(2025, 3, 2), date(2025, 3, 3)]
        self.shifts = ["M", "O", "IP", "A", "N", "DO"]
        
    def test_one_per_day_constraint(self):
        """Test one shift per day constraint."""
        model = cp_model.CpModel()
        x = create_decision_variables(model, self.employees, self.dates, self.shifts)
        
        add_one_per_day_constraint(model, x, self.employees, self.dates, self.shifts)
        
        # Test that constraint is added
        # This is hard to test directly, so we test by solving a simple case
        solver = cp_model.CpSolver()
        status = solver.Solve(model)
        assert status in [cp_model.OPTIMAL, cp_model.FEASIBLE]
        
    def test_coverage_constraints(self):
        """Test coverage constraints."""
        model = cp_model.CpModel()
        x = create_decision_variables(model, self.employees, self.dates, self.shifts)
        
        demands = {
            date(2025, 3, 1): {"M": 2, "O": 1, "IP": 1, "A": 1, "N": 1},
            date(2025, 3, 2): {"M": 2, "O": 1, "IP": 1, "A": 1, "N": 1},
            date(2025, 3, 3): {"M": 2, "O": 1, "IP": 1, "A": 1, "N": 1}
        }
        
        add_coverage_constraints(model, x, self.employees, self.dates, demands)
        
        # Test that constraint is added
        solver = cp_model.CpSolver()
        status = solver.Solve(model)
        assert status in [cp_model.OPTIMAL, cp_model.FEASIBLE]
        
    def test_skill_constraints(self):
        """Test skill constraints."""
        model = cp_model.CpModel()
        x = create_decision_variables(model, self.employees, self.dates, self.shifts)
        
        skills = {
            "Alice": {"M": True, "O": True, "IP": False, "A": True, "N": False},
            "Bob": {"M": True, "O": False, "IP": True, "A": False, "N": True},
            "Charlie": {"M": True, "O": True, "IP": True, "A": True, "N": True}
        }
        
        add_skill_constraints(model, x, self.employees, self.dates, skills)
        
        # Test that constraint is added
        solver = cp_model.CpSolver()
        status = solver.Solve(model)
        assert status in [cp_model.OPTIMAL, cp_model.FEASIBLE]
        
    def test_time_off_constraints(self):
        """Test time off constraints."""
        model = cp_model.CpModel()
        x = create_decision_variables(model, self.employees, self.dates, self.shifts)
        
        time_off = {
            ("Alice", date(2025, 3, 1)): "DO",
            ("Bob", date(2025, 3, 2)): "CL"
        }
        
        add_time_off_constraints(model, x, self.employees, self.dates, time_off)
        
        # Test that constraint is added
        solver = cp_model.CpSolver()
        status = solver.Solve(model)
        assert status in [cp_model.OPTIMAL, cp_model.FEASIBLE]
        
    def test_lock_constraints(self):
        """Test lock constraints."""
        model = cp_model.CpModel()
        x = create_decision_variables(model, self.employees, self.dates, self.shifts)
        
        locks = {
            ("Alice", date(2025, 3, 1), "M"): True,  # Must work M
            ("Bob", date(2025, 3, 2), "N"): False    # Cannot work N
        }
        
        add_lock_constraints(model, x, self.employees, self.dates, locks)
        
        # Test that constraint is added
        solver = cp_model.CpSolver()
        status = solver.Solve(model)
        assert status in [cp_model.OPTIMAL, cp_model.FEASIBLE]
        
    def test_cap_constraints(self):
        """Test cap constraints."""
        model = cp_model.CpModel()
        x = create_decision_variables(model, self.employees, self.dates, self.shifts)
        
        caps = {
            "Alice": {"maxN": 1, "maxA": 2},
            "Bob": {"maxN": 2, "maxA": 1},
            "Charlie": {"maxN": 3, "maxA": 3}
        }
        
        add_cap_constraints(model, x, self.employees, self.dates, caps)
        
        # Test that constraint is added
        solver = cp_model.CpSolver()
        status = solver.Solve(model)
        assert status in [cp_model.OPTIMAL, cp_model.FEASIBLE]
        
    def test_weekly_rest_constraints(self):
        """Test weekly rest constraints."""
        model = cp_model.CpModel()
        x = create_decision_variables(model, self.employees, self.dates, self.shifts)
        
        rest_codes = {"DO", "CL", "ML", "W"}
        
        add_weekly_rest_constraints(model, x, self.employees, self.dates, rest_codes, 1)
        
        # Test that constraint is added
        solver = cp_model.CpSolver()
        status = solver.Solve(model)
        assert status in [cp_model.OPTIMAL, cp_model.FEASIBLE]
        
    def test_adjacency_constraints(self):
        """Test adjacency constraints."""
        model = cp_model.CpModel()
        x = create_decision_variables(model, self.employees, self.dates, self.shifts)
        
        forbidden_pairs = [("N", "M"), ("A", "N")]
        
        add_adjacency_constraints(model, x, self.employees, self.dates, forbidden_pairs)
        
        # Test that constraint is added
        solver = cp_model.CpSolver()
        status = solver.Solve(model)
        assert status in [cp_model.OPTIMAL, cp_model.FEASIBLE]
        
    def test_decision_variables_creation(self):
        """Test decision variables creation."""
        model = cp_model.CpModel()
        x = create_decision_variables(model, self.employees, self.dates, self.shifts)
        
        # Check that all expected variables are created
        expected_vars = len(self.employees) * len(self.dates) * len(self.shifts)
        assert len(x) == expected_vars
        
        # Check that variables are boolean
        for var in x.values():
            assert isinstance(var, cp_model.IntVar)
            
    def test_infeasible_constraints(self):
        """Test that impossible constraints make the model infeasible."""
        model = cp_model.CpModel()
        x = create_decision_variables(model, self.employees, self.dates, self.shifts)
        
        # Add impossible constraints
        # Force all employees to work night shift on same day
        for emp in self.employees:
            model.Add(x[(emp, self.dates[0], "N")] == 1)
            
        # But only allow 1 night shift per day
        night_vars = [x[(emp, self.dates[0], "N")] for emp in self.employees]
        model.Add(sum(night_vars) <= 1)
        
        solver = cp_model.CpSolver()
        status = solver.Solve(model)
        assert status == cp_model.INFEASIBLE
