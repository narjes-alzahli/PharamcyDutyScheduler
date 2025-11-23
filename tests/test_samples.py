"""Tests for sample data and end-to-end functionality."""

import pytest
import pandas as pd
from datetime import date, timedelta
from pathlib import Path
import tempfile
import shutil

from roster.app.model.schema import RosterData, RosterConfig
from roster.app.model.solver import RosterSolver


class TestSampleData:
    """Test sample data functionality."""
    
    def setup_method(self):
        """Set up test data directory."""
        self.temp_dir = tempfile.mkdtemp()
        self.data_dir = Path(self.temp_dir)
        
        # Copy sample data
        sample_dir = Path(__file__).parent.parent / "roster" / "app" / "data"
        for file in ["employees.csv", "demands.csv", "time_off.csv", "locks.csv", "config.yaml"]:
            if (sample_dir / file).exists():
                shutil.copy2(sample_dir / file, self.data_dir / file)
                
    def teardown_method(self):
        """Clean up test data."""
        shutil.rmtree(self.temp_dir)
        
    def test_load_sample_data(self):
        """Test loading sample data."""
        data = RosterData(self.data_dir)
        data.load_data()
        
        # Check employees
        assert len(data.employees) > 0
        assert "Idris" in [emp.employee for emp in data.employees]
        
        # Check demands
        assert len(data.demands) > 0
        assert date(2025, 3, 1) in [dem.date for dem in data.demands]
        
        # Check time off
        assert len(data.time_off) > 0
        
        # Check locks
        assert len(data.locks) > 0
        
    def test_data_validation(self):
        """Test data validation."""
        data = RosterData(self.data_dir)
        data.load_data()
        
        # Test employee skills
        skills = data.get_employee_skills("Idris")
        assert "M" in skills
        assert "O" in skills
        assert "IP" in skills
        
        # Test daily demand
        demand = data.get_daily_demand(date(2025, 3, 1))
        assert "M" in demand
        assert "O" in demand
        assert "IP" in demand
        assert "A" in demand
        assert "N" in demand
        
        # Test time off code
        time_off_code = data.get_time_off_code("Rasha", date(2025, 3, 5))
        assert time_off_code == "CL"
        
        # Test lock force
        lock_force = data.get_lock_force("Ameera", date(2025, 3, 12), "APP")
        assert lock_force is True
        
    def test_solve_sample_roster(self):
        """Test solving sample roster."""
        data = RosterData(self.data_dir)
        data.load_data()
        
        config = RosterConfig(self.data_dir / "config.yaml")
        solver = RosterSolver(config)
        
        # Solve with short time limit for testing
        success, assignments, metrics = solver.solve(data, time_limit_seconds=30)
        
        if success:
            # Check that we got assignments
            assert len(assignments) > 0
            
            # Check that metrics were calculated
            assert "solve_time" in metrics
            assert "status" in metrics
            
            # Test creating dataframes
            employees = data.get_employee_names()
            dates = data.get_all_dates()
            
            schedule_df = solver.create_schedule_dataframe(assignments, employees, dates, data)
            assert len(schedule_df) > 0
            assert "date" in schedule_df.columns
            assert "employee" in schedule_df.columns
            assert "shift" in schedule_df.columns
            
            coverage_df = solver.create_coverage_report(
                assignments, employees, dates, 
                {day: data.get_daily_demand(day) for day in dates}
            )
            assert len(coverage_df) > 0
            assert "date" in coverage_df.columns
            assert "shift" in coverage_df.columns
            assert "needed" in coverage_df.columns
            assert "assigned" in coverage_df.columns
            assert "shortfall" in coverage_df.columns
            
            employee_df = solver.create_employee_report(assignments, employees, dates)
            assert len(employee_df) > 0
            assert "employee" in employee_df.columns
            assert "nights" in employee_df.columns
            assert "evenings" in employee_df.columns
            assert "days_off" in employee_df.columns
            
    def test_constraint_satisfaction(self):
        """Test that constraints are satisfied in the solution."""
        data = RosterData(self.data_dir)
        data.load_data()
        
        config = RosterConfig(self.data_dir / "config.yaml")
        solver = RosterSolver(config)
        
        success, assignments, metrics = solver.solve(data, time_limit_seconds=30)
        
        if success:
            employees = data.get_employee_names()
            dates = data.get_all_dates()
            
            # Test one assignment per day
            for emp in employees:
                for day in dates:
                    assigned_shifts = [
                        shift for shift in ["M", "O", "IP", "A", "N", "DO", "CL", "ML", "W", "UL"]
                        if assignments.get((emp, day, shift), 0) == 1
                    ]
                    assert len(assigned_shifts) == 1, f"Employee {emp} has {len(assigned_shifts)} assignments on {day}"
                    
            # Test coverage requirements
            for day in dates:
                demand = data.get_daily_demand(day)
                for shift_type in ["M", "O", "IP", "A", "N"]:
                    if shift_type in demand and demand[shift_type] > 0:
                        assigned = sum(
                            assignments.get((emp, day, shift_type), 0)
                            for emp in employees
                        )
                        assert assigned >= demand[shift_type], f"Coverage not met for {shift_type} on {day}"
                        
            # Test skill constraints
            for emp in employees:
                skills = data.get_employee_skills(emp)
                for day in dates:
                    for shift_type in ["M", "O", "IP", "A", "N"]:
                        if shift_type in skills and not skills[shift_type]:
                            assert assignments.get((emp, day, shift_type), 0) == 0, f"Employee {emp} assigned to {shift_type} without skill"
                            
            # Test time off constraints
            for (emp, day), code in data.time_off_dict.items():
                if emp in employees and day in dates:
                    assert assignments.get((emp, day, code), 0) == 1, f"Time off constraint not satisfied for {emp} on {day}"
                    
            # Test lock constraints
            for (emp, day, shift), force in data.locks_dict.items():
                if emp in employees and day in dates:
                    if force:
                        assert assignments.get((emp, day, shift), 0) == 1, f"Lock constraint not satisfied for {emp} on {day} shift {shift}"
                    else:
                        assert assignments.get((emp, day, shift), 0) == 0, f"Lock constraint not satisfied for {emp} on {day} shift {shift}"
                        
    def test_weekly_rest_constraint(self):
        """Test weekly rest constraint."""
        data = RosterData(self.data_dir)
        data.load_data()
        
        config = RosterConfig(self.data_dir / "config.yaml")
        solver = RosterSolver(config)
        
        success, assignments, metrics = solver.solve(data, time_limit_seconds=30)
        
        if success:
            employees = data.get_employee_names()
            dates = data.get_all_dates()
            rest_codes = config.rest_codes
            
            # Test weekly rest for each employee
            for emp in employees:
                for i in range(len(dates) - 6):
                    window_dates = dates[i:i+7]
                    rest_days = sum(
                        assignments.get((emp, day, code), 0)
                        for day in window_dates
                        for code in rest_codes
                    )
                    assert rest_days >= config.weekly_rest_minimum, f"Weekly rest not satisfied for {emp} in window {window_dates[0]} to {window_dates[-1]}"
                    
    def test_adjacency_constraints(self):
        """Test adjacency constraints."""
        data = RosterData(self.data_dir)
        data.load_data()
        
        config = RosterConfig(self.data_dir / "config.yaml")
        solver = RosterSolver(config)
        
        success, assignments, metrics = solver.solve(data, time_limit_seconds=30)
        
        if success:
            employees = data.get_employee_names()
            dates = data.get_all_dates()
            
            # Test forbidden adjacencies
            for emp in employees:
                for i in range(len(dates) - 1):
                    day1, day2 = dates[i], dates[i+1]
                    
                    for shift1, shift2 in config.forbidden_adjacencies:
                        # Check that we don't have both shifts
                        has_shift1 = assignments.get((emp, day1, shift1), 0) == 1
                        has_shift2 = assignments.get((emp, day2, shift2), 0) == 1
                        
                        assert not (has_shift1 and has_shift2), f"Forbidden adjacency {shift1}->{shift2} found for {emp} on {day1}->{day2}"
                        
    def test_cap_constraints(self):
        """Test cap constraints."""
        data = RosterData(self.data_dir)
        data.load_data()
        
        config = RosterConfig(self.data_dir / "config.yaml")
        solver = RosterSolver(config)
        
        success, assignments, metrics = solver.solve(data, time_limit_seconds=30)
        
        if success:
            employees = data.get_employee_names()
            dates = data.get_all_dates()
            
            # Test caps for each employee
            for emp_data in data.employees:
                emp = emp_data.employee
                nights = sum(assignments.get((emp, day, "N"), 0) for day in dates)
                evenings = sum(assignments.get((emp, day, "A"), 0) for day in dates)
                
                assert nights <= emp_data.maxN, f"Night cap exceeded for {emp}: {nights} > {emp_data.maxN}"
                assert evenings <= emp_data.maxA, f"Evening cap exceeded for {emp}: {evenings} > {emp_data.maxA}"
