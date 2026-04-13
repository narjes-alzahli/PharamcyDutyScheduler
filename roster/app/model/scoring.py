"""Scoring functions for staff rostering optimization."""

from datetime import date, timedelta
from typing import Dict, List, Tuple, Any, Optional, Set
from ortools.sat.python import cp_model

# Default standard working shifts (fallback when demands don't include all shifts)
# These should match what's in the database - updated when standard shifts change
_DEFAULT_STANDARD_SHIFTS_LIST = ["M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "IP+P", "P", "M+P"]


class RosterScoring:
    """Handles scoring and objective function for roster optimization."""
    
    def __init__(self, weights: Dict[str, float]):
        self.weights = weights
    
    # [HISTORY_AWARE_FAIRNESS] Modified to accept history_counts parameter
    def add_objective(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date],
        demands: Dict[date, Dict[str, int]],
        skills: Dict[str, Dict[str, bool]],
        history_counts: Dict[str, Dict[str, int]] = None,  # [HISTORY_AWARE_FAIRNESS] Added parameter
        required_rest_after_shifts: Optional[List[Dict[str, Any]]] = None,
        leave_codes: Optional[Set[str]] = None,
        locks: Optional[Dict[Tuple[str, date, str], bool]] = None,
        working_shift_codes: Optional[List[str]] = None,
        previous_period_shifts: Optional[Dict[Tuple[str, date], str]] = None
    ) -> None:
        """Add objective function to minimize penalties.
        
        Args:
            history_counts: Dict mapping category name to dict mapping employee name to history count.
                          Categories: "nights", "afternoons", "m4", "thursdays", "weekends"
                          [HISTORY_AWARE_FAIRNESS] This parameter enables history-aware fairness
            required_rest_after_shifts: Rules for rest after N/M4/A (soft constraint penalty).
            leave_codes: Leave codes that count as rest when checking rest-after-shift.
            locks: Force/forbid assignments; used to skip penalty when employee requested both shift and work on rest day.
            working_shift_codes: Working shift codes from config.
        """
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
        
        # 3. Rest-after-shift soft penalty (2 O after N, 1 O after M4, 1 O after A) - high priority
        rest_after_vars = self._add_rest_after_shift_variables(
            model, x, employees, dates,
            required_rest_after_shifts, leave_codes, locks, working_shift_codes
        )
        if rest_after_vars:
            objectives.append(sum(rest_after_vars) * self.weights.get("rest_after_shift", 4000.0))

        # 3b. Preferred sequence hierarchy penalties (A/N/M4 follow-up patterns).
        sequence_pref_vars, sequence_allowed_vars = self._add_sequence_hierarchy_variables(
            model, x, employees, dates
        )
        if sequence_pref_vars:
            objectives.append(
                sum(sequence_pref_vars) * self.weights.get("sequence_preference_miss", 1500.0)
            )
        if sequence_allowed_vars:
            objectives.append(
                sum(sequence_allowed_vars) * self.weights.get("sequence_fallback_miss", 4000.0)
            )

        # 3c. Boundary sequence penalties from previous committed period into this solve window.
        boundary_pref_vars, boundary_allowed_vars = self._add_boundary_sequence_hierarchy_variables(
            model, x, employees, dates, previous_period_shifts, locks, working_shift_codes
        )
        if boundary_pref_vars:
            objectives.append(
                sum(boundary_pref_vars) * self.weights.get("sequence_preference_miss", 1500.0)
            )
        if boundary_allowed_vars:
            objectives.append(
                sum(boundary_allowed_vars) * self.weights.get("sequence_fallback_miss", 4000.0)
            )
        
        # 4. Fairness penalty (with history awareness)
        # [HISTORY_AWARE_FAIRNESS] Pass history_counts to fairness calculation
        fairness_vars = self._add_fairness_variables(
            model, x, employees, dates, skills, history_counts
        )
        if fairness_vars:
            objectives.append(sum(fairness_vars) * self.weights.get("fairness", 5.0))
        
        # DO after N preference removed - DO is now only assigned when requested in time off
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
        """Add variables to penalize unfilled coverage. Only for soft-coverage shifts (M, IP)."""
        unfilled_vars = []
        soft_coverage_shifts = {"M", "IP"}

        for day in dates:
            if day not in demands:
                continue
            day_demand = demands[day]

            for shift_type in _DEFAULT_STANDARD_SHIFTS_LIST:
                if shift_type not in day_demand or shift_type not in soft_coverage_shifts:
                    continue
                assigned_vars = [x[(emp, day, shift_type)] for emp in employees]
                assigned_count = model.NewIntVar(0, len(employees), f"assigned_{day}_{shift_type}")
                model.Add(assigned_count == sum(assigned_vars))

                if day_demand[shift_type] > 0:
                    shortfall = model.NewIntVar(0, day_demand[shift_type], f"shortfall_{day}_{shift_type}")
                    model.Add(shortfall >= day_demand[shift_type] - assigned_count)
                    unfilled_vars.append(shortfall)
                else:
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
            
            for shift_type in _DEFAULT_STANDARD_SHIFTS_LIST:
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
    
    def _add_rest_after_shift_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date],
        required_rest_after_shifts: Optional[List[Dict[str, Any]]] = None,
        leave_codes: Optional[Set[str]] = None,
        locks: Optional[Dict[Tuple[str, date, str], bool]] = None,
        working_shift_codes: Optional[List[str]] = None
    ) -> List[cp_model.IntVar]:
        """Add variables to penalize missing rest after N/M4/A (soft constraint, high weight)."""
        violation_vars = []
        if not required_rest_after_shifts:
            required_rest_after_shifts = [
                {"shift": "N", "rest_days": 2, "rest_code": "O"},
                {"shift": "M4", "rest_days": 1, "rest_code": "O"},
                {"shift": "A", "rest_days": 1, "rest_code": "O"}
            ]
        # A/N/M4 now use explicit sequence hierarchy penalties in _add_sequence_hierarchy_variables.
        # Keep this function for any other configurable rest-after-shift rules.
        sequence_managed_shifts = {"A", "N", "M4"}
        working_shifts = set(working_shift_codes) if working_shift_codes else set(_DEFAULT_STANDARD_SHIFTS_LIST)
        rest_or_leave_codes = (leave_codes or set()) | {"O"}

        for emp in employees:
            for i, day in enumerate(dates):
                for rule in required_rest_after_shifts:
                    shift_code = rule["shift"]
                    if shift_code in sequence_managed_shifts:
                        continue
                    rest_days = rule["rest_days"]
                    rest_code = rule["rest_code"]

                    if (emp, day, shift_code) not in x:
                        continue

                    shift_is_requested = bool(locks and locks.get((emp, day, shift_code)) is True)

                    def has_forced_work_on_day(target_day: date) -> bool:
                        if not locks:
                            return False
                        for shift in working_shifts:
                            if locks.get((emp, target_day, shift)) is True:
                                return True
                        return False

                    for rest_day_offset in range(1, rest_days + 1):
                        if i + rest_day_offset >= len(dates):
                            break
                        rest_day = dates[i + rest_day_offset]

                        if shift_is_requested and has_forced_work_on_day(rest_day):
                            continue

                        if (emp, rest_day, rest_code) not in x:
                            continue

                        # rest_or_leave = 1 iff employee has O or any leave on rest_day (must be 0 when working)
                        rest_or_leave = model.NewBoolVar(
                            f"rest_or_leave_{emp}_{day!s}_{rest_day!s}_{shift_code}_{rest_day_offset}"
                        )
                        rest_leave_vars = []
                        for code in rest_or_leave_codes:
                            if (emp, rest_day, code) in x:
                                rest_leave_vars.append(x[(emp, rest_day, code)])
                                model.Add(rest_or_leave >= x[(emp, rest_day, code)])
                        if rest_leave_vars:
                            model.Add(rest_or_leave <= sum(rest_leave_vars))

                        # violation = 1 when they worked shift but did not have rest/leave on rest_day
                        violation = model.NewBoolVar(
                            f"rest_viol_{emp}_{day!s}_{shift_code}_{rest_day!s}_{rest_day_offset}"
                        )
                        model.Add(violation >= x[(emp, day, shift_code)] - rest_or_leave)
                        violation_vars.append(violation)

        return violation_vars

    def _link_and_var(
        self,
        model: cp_model.CpModel,
        literals: List[cp_model.IntVar],
        name: str
    ) -> cp_model.IntVar:
        """Create bool var equal to logical AND of literals."""
        and_var = model.NewBoolVar(name)
        for lit in literals:
            model.Add(and_var <= lit)
        model.Add(and_var >= sum(literals) - (len(literals) - 1))
        return and_var

    def _add_sequence_hierarchy_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date]
    ) -> Tuple[List[cp_model.IntVar], List[cp_model.IntVar]]:
        """Penalty vars for hierarchy:
        A: prefer A->O, fallback A->N->O->O
        N: prefer N->O->O, fallback N->O->M
        M4: prefer M4->O, fallbacks M4->A->O then M4->A->N->O->O
        """
        preference_miss_vars: List[cp_model.IntVar] = []
        fallback_miss_vars: List[cp_model.IntVar] = []

        date_to_idx = {d: i for i, d in enumerate(dates)}

        for emp in employees:
            for day in dates:
                i = date_to_idx[day]

                # A hierarchy
                if i + 1 < len(dates) and (emp, day, "A") in x:
                    next_day = dates[i + 1]
                    if (emp, next_day, "O") in x:
                        a_pref_miss = model.NewBoolVar(f"a_pref_miss_{emp}_{day}")
                        model.Add(a_pref_miss >= x[(emp, day, "A")] - x[(emp, next_day, "O")])
                        preference_miss_vars.append(a_pref_miss)

                    if i + 3 < len(dates):
                        d1, d2, d3 = dates[i + 1], dates[i + 2], dates[i + 3]
                        if all((emp, d, s) in x for d, s in [(d1, "N"), (d2, "O"), (d3, "O"), (d1, "O")]):
                            a_next_best = self._link_and_var(
                                model,
                                [x[(emp, d1, "N")], x[(emp, d2, "O")], x[(emp, d3, "O")]],
                                f"a_next_best_{emp}_{day}"
                            )
                            a_allowed = model.NewBoolVar(f"a_allowed_{emp}_{day}")
                            model.Add(a_allowed >= x[(emp, d1, "O")])
                            model.Add(a_allowed >= a_next_best)
                            model.Add(a_allowed <= x[(emp, d1, "O")] + a_next_best)
                            a_fallback_miss = model.NewBoolVar(f"a_fallback_miss_{emp}_{day}")
                            model.Add(a_fallback_miss >= x[(emp, day, "A")] - a_allowed)
                            fallback_miss_vars.append(a_fallback_miss)

                # N hierarchy
                if i + 1 < len(dates) and (emp, day, "N") in x:
                    d1 = dates[i + 1]
                    if (emp, d1, "O") in x and i + 2 < len(dates):
                        d2 = dates[i + 2]
                        if (emp, d2, "O") in x:
                            n_pref = self._link_and_var(
                                model,
                                [x[(emp, d1, "O")], x[(emp, d2, "O")]],
                                f"n_pref_{emp}_{day}"
                            )
                            n_pref_miss = model.NewBoolVar(f"n_pref_miss_{emp}_{day}")
                            model.Add(n_pref_miss >= x[(emp, day, "N")] - n_pref)
                            preference_miss_vars.append(n_pref_miss)
                        if (emp, d2, "M") in x and (emp, d2, "O") in x:
                            n_next_best = self._link_and_var(
                                model,
                                [x[(emp, d1, "O")], x[(emp, d2, "M")]],
                                f"n_next_best_{emp}_{day}"
                            )
                            n_allowed = model.NewBoolVar(f"n_allowed_{emp}_{day}")
                            if (emp, d2, "O") in x:
                                n_pref = self._link_and_var(
                                    model,
                                    [x[(emp, d1, "O")], x[(emp, d2, "O")]],
                                    f"n_pref_reuse_{emp}_{day}"
                                )
                                model.Add(n_allowed >= n_pref)
                                model.Add(n_allowed >= n_next_best)
                                model.Add(n_allowed <= n_pref + n_next_best)
                                n_fallback_miss = model.NewBoolVar(f"n_fallback_miss_{emp}_{day}")
                                model.Add(n_fallback_miss >= x[(emp, day, "N")] - n_allowed)
                                fallback_miss_vars.append(n_fallback_miss)

                # M4 hierarchy
                if i + 1 < len(dates) and (emp, day, "M4") in x:
                    d1 = dates[i + 1]
                    if (emp, d1, "O") in x:
                        m4_pref_miss = model.NewBoolVar(f"m4_pref_miss_{emp}_{day}")
                        model.Add(m4_pref_miss >= x[(emp, day, "M4")] - x[(emp, d1, "O")])
                        preference_miss_vars.append(m4_pref_miss)

                    if i + 4 < len(dates):
                        d2, d3, d4 = dates[i + 2], dates[i + 3], dates[i + 4]
                        if all((emp, d, s) in x for d, s in [(d1, "O"), (d1, "A"), (d2, "O"), (d2, "N"), (d3, "O"), (d4, "O")]):
                            m4_next_1 = self._link_and_var(
                                model,
                                [x[(emp, d1, "A")], x[(emp, d2, "O")]],
                                f"m4_next1_{emp}_{day}"
                            )
                            m4_next_2 = self._link_and_var(
                                model,
                                [x[(emp, d1, "A")], x[(emp, d2, "N")], x[(emp, d3, "O")], x[(emp, d4, "O")]],
                                f"m4_next2_{emp}_{day}"
                            )
                            m4_allowed = model.NewBoolVar(f"m4_allowed_{emp}_{day}")
                            model.Add(m4_allowed >= x[(emp, d1, "O")])
                            model.Add(m4_allowed >= m4_next_1)
                            model.Add(m4_allowed >= m4_next_2)
                            model.Add(m4_allowed <= x[(emp, d1, "O")] + m4_next_1 + m4_next_2)
                            m4_fallback_miss = model.NewBoolVar(f"m4_fallback_miss_{emp}_{day}")
                            model.Add(m4_fallback_miss >= x[(emp, day, "M4")] - m4_allowed)
                            fallback_miss_vars.append(m4_fallback_miss)

        return preference_miss_vars, fallback_miss_vars

    def _add_boundary_sequence_hierarchy_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date],
        previous_period_shifts: Optional[Dict[Tuple[str, date], str]],
        locks: Optional[Dict[Tuple[str, date, str], bool]] = None,
        working_shift_codes: Optional[List[str]] = None
    ) -> Tuple[List[cp_model.IntVar], List[cp_model.IntVar]]:
        """Apply A/N/M4 sequence hierarchy from previous-period last day to period start."""
        if not previous_period_shifts or not dates:
            return [], []

        preference_miss_vars: List[cp_model.IntVar] = []
        fallback_miss_vars: List[cp_model.IntVar] = []
        date_set = set(dates)
        first_day = min(dates)
        working_shifts = set(working_shift_codes) if working_shift_codes else set(_DEFAULT_STANDARD_SHIFTS_LIST)

        # Keep only each employee's latest previous-period shift.
        last_shift_by_emp: Dict[str, Tuple[date, str]] = {}
        for (emp, prev_day), shift in previous_period_shifts.items():
            prev = last_shift_by_emp.get(emp)
            if prev is None or prev_day > prev[0]:
                last_shift_by_emp[emp] = (prev_day, shift)

        for emp in employees:
            if emp not in last_shift_by_emp:
                continue
            prev_day, prev_shift = last_shift_by_emp[emp]
            if prev_shift not in {"A", "N", "M4"}:
                continue

            d1 = first_day
            d2 = first_day + timedelta(days=1)
            d3 = first_day + timedelta(days=2)
            d4 = first_day + timedelta(days=3)
            d2_exists = d2 in date_set
            d3_exists = d3 in date_set
            d4_exists = d4 in date_set

            def has_forced_work(day_val: date) -> bool:
                if not locks:
                    return False
                return any(locks.get((emp, day_val, s)) is True for s in working_shifts)

            if prev_shift == "A":
                # Respect explicit employee requests on boundary horizon.
                if has_forced_work(d1) or (d2_exists and has_forced_work(d2)) or (d3_exists and has_forced_work(d3)):
                    continue
                if (emp, d1, "O") in x:
                    a_pref_miss = model.NewBoolVar(f"boundary_a_pref_miss_{emp}_{prev_day}")
                    model.Add(a_pref_miss >= 1 - x[(emp, d1, "O")])
                    preference_miss_vars.append(a_pref_miss)

                if d2_exists and d3_exists and all((emp, d, s) in x for d, s in [(d1, "O"), (d1, "N"), (d2, "O"), (d3, "O")]):
                    a_next_best = self._link_and_var(
                        model,
                        [x[(emp, d1, "N")], x[(emp, d2, "O")], x[(emp, d3, "O")]],
                        f"boundary_a_next_best_{emp}_{prev_day}"
                    )
                    a_allowed = model.NewBoolVar(f"boundary_a_allowed_{emp}_{prev_day}")
                    model.Add(a_allowed >= x[(emp, d1, "O")])
                    model.Add(a_allowed >= a_next_best)
                    model.Add(a_allowed <= x[(emp, d1, "O")] + a_next_best)
                    a_fallback_miss = model.NewBoolVar(f"boundary_a_fallback_miss_{emp}_{prev_day}")
                    model.Add(a_fallback_miss >= 1 - a_allowed)
                    fallback_miss_vars.append(a_fallback_miss)

            elif prev_shift == "N":
                # Respect explicit employee requests on boundary horizon.
                if has_forced_work(d1) or (d2_exists and has_forced_work(d2)):
                    continue
                if d2_exists and all((emp, d, "O") in x for d in [d1, d2]):
                    n_pref = self._link_and_var(
                        model,
                        [x[(emp, d1, "O")], x[(emp, d2, "O")]],
                        f"boundary_n_pref_{emp}_{prev_day}"
                    )
                    n_pref_miss = model.NewBoolVar(f"boundary_n_pref_miss_{emp}_{prev_day}")
                    model.Add(n_pref_miss >= 1 - n_pref)
                    preference_miss_vars.append(n_pref_miss)

                    if (emp, d2, "M") in x:
                        n_next_best = self._link_and_var(
                            model,
                            [x[(emp, d1, "O")], x[(emp, d2, "M")]],
                            f"boundary_n_next_best_{emp}_{prev_day}"
                        )
                        n_allowed = model.NewBoolVar(f"boundary_n_allowed_{emp}_{prev_day}")
                        model.Add(n_allowed >= n_pref)
                        model.Add(n_allowed >= n_next_best)
                        model.Add(n_allowed <= n_pref + n_next_best)
                        n_fallback_miss = model.NewBoolVar(f"boundary_n_fallback_miss_{emp}_{prev_day}")
                        model.Add(n_fallback_miss >= 1 - n_allowed)
                        fallback_miss_vars.append(n_fallback_miss)

            elif prev_shift == "M4":
                # Respect explicit employee requests on boundary horizon.
                if (
                    has_forced_work(d1) or
                    (d2_exists and has_forced_work(d2)) or
                    (d3_exists and has_forced_work(d3)) or
                    (d4_exists and has_forced_work(d4))
                ):
                    continue
                if (emp, d1, "O") in x:
                    m4_pref_miss = model.NewBoolVar(f"boundary_m4_pref_miss_{emp}_{prev_day}")
                    model.Add(m4_pref_miss >= 1 - x[(emp, d1, "O")])
                    preference_miss_vars.append(m4_pref_miss)

                if d2_exists and d3_exists and d4_exists and all((emp, d, s) in x for d, s in [(d1, "O"), (d1, "A"), (d2, "O"), (d2, "N"), (d3, "O"), (d4, "O")]):
                    m4_next_1 = self._link_and_var(
                        model,
                        [x[(emp, d1, "A")], x[(emp, d2, "O")]],
                        f"boundary_m4_next1_{emp}_{prev_day}"
                    )
                    m4_next_2 = self._link_and_var(
                        model,
                        [x[(emp, d1, "A")], x[(emp, d2, "N")], x[(emp, d3, "O")], x[(emp, d4, "O")]],
                        f"boundary_m4_next2_{emp}_{prev_day}"
                    )
                    m4_allowed = model.NewBoolVar(f"boundary_m4_allowed_{emp}_{prev_day}")
                    model.Add(m4_allowed >= x[(emp, d1, "O")])
                    model.Add(m4_allowed >= m4_next_1)
                    model.Add(m4_allowed >= m4_next_2)
                    model.Add(m4_allowed <= x[(emp, d1, "O")] + m4_next_1 + m4_next_2)
                    m4_fallback_miss = model.NewBoolVar(f"boundary_m4_fallback_miss_{emp}_{prev_day}")
                    model.Add(m4_fallback_miss >= 1 - m4_allowed)
                    fallback_miss_vars.append(m4_fallback_miss)

        return preference_miss_vars, fallback_miss_vars

    # [HISTORY_AWARE_FAIRNESS] Modified to use history_counts in fairness calculations
    def _add_fairness_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date],
        skills: Dict[str, Dict[str, bool]],
        history_counts: Dict[str, Dict[str, int]] = None  # [HISTORY_AWARE_FAIRNESS] Added parameter
    ) -> List[cp_model.IntVar]:
        """Add variables to penalize unfair distribution of shifts.
        
        Args:
            history_counts: Dict mapping category name to dict mapping employee name to history count.
                          Categories: "nights", "afternoons", "m4", "thursdays", "weekends"
                          If None, uses current period only (no history).
                          [HISTORY_AWARE_FAIRNESS] This enables history-aware fairness across months
        """
        fairness_vars = []
        
        # [HISTORY_AWARE_FAIRNESS] Default to empty history if not provided
        if history_counts is None:
            history_counts = {
                "nights": {},
                "afternoons": {},
                "m4": {},
                "e": {},
                "thursdays": {},
                "weekends": {},
                "M+P": {},
                "P": {}
            }
        
        # Filter out employees who have only CL skill (they are not included in fairness balance)
        non_clinicians = []
        for emp in employees:
            emp_skills = skills.get(emp, {})
            if not emp_skills.get("CL", False) or any(
                emp_skills.get(shift, False)
                for shift in _DEFAULT_STANDARD_SHIFTS_LIST
                if shift != "CL"
            ):
                non_clinicians.append(emp)
        
        if len(non_clinicians) < 2:
            return fairness_vars  # Need at least 2 non-clinicians for fairness
        
        # Count shifts per non-clinician employee (filtered by specific skills)
        night_total_loads = []
        afternoon_total_loads = []
        m4_total_loads = []
        e_total_loads = []
        thursday_total_loads = []
        weekend_total_loads = []
        m_plus_p_total_loads = []
        p_total_loads = []
        total_working_counts = []
        
        for emp in non_clinicians:
            emp_skills = skills.get(emp, {})
            
            # Check if employee is single-skill (they work Sun-Thu, rest Fri-Sat)
            qualified_shifts = [
                shift for shift in _DEFAULT_STANDARD_SHIFTS_LIST
                if emp_skills.get(shift, False)
            ]
            is_single_skill = len(qualified_shifts) == 1
            
            # Skip single-skill employees from all fairness calculations
            # (they have fixed schedules: work Sun-Thu, rest Fri-Sat)
            if is_single_skill:
                continue
            
            # Night shifts - only for employees with skill_N
            if emp_skills.get("N", False):
                night_vars = [x[(emp, day, "N")] for day in dates]
                new_night_count = model.NewIntVar(0, len(dates), f"new_night_count_{emp}")
                model.Add(new_night_count == sum(night_vars))
                
                # [HISTORY_AWARE_FAIRNESS] Total load = history + new assignments
                history_nights = history_counts.get("nights", {}).get(emp, 0)
                total_night_load = model.NewIntVar(history_nights, history_nights + len(dates), f"total_night_load_{emp}")
                model.Add(total_night_load == history_nights + new_night_count)
                night_total_loads.append(total_night_load)
            
            # Afternoon shifts - only for employees with skill_A
            if emp_skills.get("A", False):
                afternoon_vars = [x[(emp, day, "A")] for day in dates]
                new_afternoon_count = model.NewIntVar(0, len(dates), f"new_afternoon_count_{emp}")
                model.Add(new_afternoon_count == sum(afternoon_vars))
                
                # [HISTORY_AWARE_FAIRNESS] Total load = history + new assignments
                history_afternoons = history_counts.get("afternoons", {}).get(emp, 0)
                total_afternoon_load = model.NewIntVar(history_afternoons, history_afternoons + len(dates), f"total_afternoon_load_{emp}")
                model.Add(total_afternoon_load == history_afternoons + new_afternoon_count)
                afternoon_total_loads.append(total_afternoon_load)
            
            # M4 shifts - only for employees with skill_M4
            if emp_skills.get("M4", False):
                m4_vars = [x[(emp, day, "M4")] for day in dates]
                new_m4_count = model.NewIntVar(0, len(dates), f"new_m4_count_{emp}")
                model.Add(new_m4_count == sum(m4_vars))
                
                # [HISTORY_AWARE_FAIRNESS] Total load = history + new assignments
                history_m4 = history_counts.get("m4", {}).get(emp, 0)
                total_m4_load = model.NewIntVar(history_m4, history_m4 + len(dates), f"total_m4_load_{emp}")
                model.Add(total_m4_load == history_m4 + new_m4_count)
                m4_total_loads.append(total_m4_load)
            
            # E shifts - only for employees with skill_E (fairness when E is assigned)
            if emp_skills.get("E", False):
                e_vars = [x[(emp, day, "E")] for day in dates]
                new_e_count = model.NewIntVar(0, len(dates), f"new_e_count_{emp}")
                model.Add(new_e_count == sum(e_vars))
                history_e = history_counts.get("e", {}).get(emp, 0)
                total_e_load = model.NewIntVar(history_e, history_e + len(dates), f"total_e_load_{emp}")
                model.Add(total_e_load == history_e + new_e_count)
                e_total_loads.append(total_e_load)
            
            # M+P and P rotation: prefer employees who haven't done these in recent months
            if emp_skills.get("M+P", False):
                m_plus_p_vars = [x[(emp, day, "M+P")] for day in dates]
                new_m_plus_p_count = model.NewIntVar(0, len(dates), f"new_m_plus_p_count_{emp}")
                model.Add(new_m_plus_p_count == sum(m_plus_p_vars))
                history_m_plus_p = history_counts.get("M+P", {}).get(emp, 0)
                total_m_plus_p_load = model.NewIntVar(history_m_plus_p, history_m_plus_p + len(dates), f"total_m_plus_p_load_{emp}")
                model.Add(total_m_plus_p_load == history_m_plus_p + new_m_plus_p_count)
                m_plus_p_total_loads.append(total_m_plus_p_load)
            if emp_skills.get("P", False):
                p_vars = [x[(emp, day, "P")] for day in dates]
                new_p_count = model.NewIntVar(0, len(dates), f"new_p_count_{emp}")
                model.Add(new_p_count == sum(p_vars))
                history_p = history_counts.get("P", {}).get(emp, 0)
                total_p_load = model.NewIntVar(history_p, history_p + len(dates), f"total_p_load_{emp}")
                model.Add(total_p_load == history_p + new_p_count)
                p_total_loads.append(total_p_load)
            
            # Thursday shifts (excluding M and M3) - only for multi-skill employees
            # Note: is_single_skill check above ensures we only process multi-skill employees here
            thursday_vars = []
            for day in dates:
                if day.weekday() == 3:  # Thursday
                    for shift in _DEFAULT_STANDARD_SHIFTS_LIST:
                        if shift not in ["M", "M3"]:  # Exclude M and M3
                            thursday_vars.append(x[(emp, day, shift)])
            new_thursday_count = model.NewIntVar(0, len(dates), f"new_thursday_count_{emp}")
            model.Add(new_thursday_count == sum(thursday_vars))
            
            # [HISTORY_AWARE_FAIRNESS] Total load = history + new assignments
            history_thursdays = history_counts.get("thursdays", {}).get(emp, 0)
            total_thursday_load = model.NewIntVar(history_thursdays, history_thursdays + len(dates), f"total_thursday_load_{emp}")
            model.Add(total_thursday_load == history_thursdays + new_thursday_count)
            thursday_total_loads.append(total_thursday_load)
            
            # Weekend shifts (Friday=4, Saturday=5) - only for multi-skill employees
            # Note: is_single_skill check above ensures we only process multi-skill employees here
            weekend_vars = []
            for day in dates:
                if day.weekday() in [4, 5]:  # Friday or Saturday
                    for shift in _DEFAULT_STANDARD_SHIFTS_LIST:
                        weekend_vars.append(x[(emp, day, shift)])
            new_weekend_count = model.NewIntVar(0, len(dates) * len(_DEFAULT_STANDARD_SHIFTS_LIST), f"new_weekend_count_{emp}")
            model.Add(new_weekend_count == sum(weekend_vars))
            
            # [HISTORY_AWARE_FAIRNESS] Total load = history + new assignments
            history_weekends = history_counts.get("weekends", {}).get(emp, 0)
            max_weekend_possible = len(dates) * len(_DEFAULT_STANDARD_SHIFTS_LIST)
            total_weekend_load = model.NewIntVar(history_weekends, history_weekends + max_weekend_possible, f"total_weekend_load_{emp}")
            model.Add(total_weekend_load == history_weekends + new_weekend_count)
            weekend_total_loads.append(total_weekend_load)
            
            # Total working days (all shifts) - only for multi-skill employees
            # Note: This category doesn't use history (as per requirements)
            working_vars = []
            for day in dates:
                for shift in _DEFAULT_STANDARD_SHIFTS_LIST:
                    working_vars.append(x[(emp, day, shift)])
            total_working = model.NewIntVar(0, len(dates) * len(_DEFAULT_STANDARD_SHIFTS_LIST), f"total_working_{emp}")
            model.Add(total_working == sum(working_vars))
            total_working_counts.append(total_working)
        
        # [HISTORY_AWARE_FAIRNESS] Fairness penalties (minimize variance between non-clinicians)
        # Use total_load (history + new) for history-aware categories
        if night_total_loads:
            max_nights = model.NewIntVar(0, len(dates) * 10, "max_nights")  # Increased upper bound to account for history
            min_nights = model.NewIntVar(0, len(dates) * 10, "min_nights")
            for load in night_total_loads:
                model.Add(max_nights >= load)
                model.Add(min_nights <= load)
            night_fairness = model.NewIntVar(0, len(dates) * 10, "night_fairness")
            model.Add(night_fairness == max_nights - min_nights)
            fairness_vars.append(night_fairness)
            
        if afternoon_total_loads:
            max_afternoons = model.NewIntVar(0, len(dates) * 10, "max_afternoons")
            min_afternoons = model.NewIntVar(0, len(dates) * 10, "min_afternoons")
            for load in afternoon_total_loads:
                model.Add(max_afternoons >= load)
                model.Add(min_afternoons <= load)
            afternoon_fairness = model.NewIntVar(0, len(dates) * 10, "afternoon_fairness")
            model.Add(afternoon_fairness == max_afternoons - min_afternoons)
            fairness_vars.append(afternoon_fairness)
            
        if m4_total_loads:
            max_m4 = model.NewIntVar(0, len(dates) * 10, "max_m4")
            min_m4 = model.NewIntVar(0, len(dates) * 10, "min_m4")
            for load in m4_total_loads:
                model.Add(max_m4 >= load)
                model.Add(min_m4 <= load)
            m4_fairness = model.NewIntVar(0, len(dates) * 10, "m4_fairness")
            model.Add(m4_fairness == max_m4 - min_m4)
            fairness_vars.append(m4_fairness)
        
        if e_total_loads:
            max_e = model.NewIntVar(0, len(dates) * 10, "max_e")
            min_e = model.NewIntVar(0, len(dates) * 10, "min_e")
            for load in e_total_loads:
                model.Add(max_e >= load)
                model.Add(min_e <= load)
            e_fairness = model.NewIntVar(0, len(dates) * 10, "e_fairness")
            model.Add(e_fairness == max_e - min_e)
            fairness_vars.append(e_fairness)
        
        if m_plus_p_total_loads:
            max_m_plus_p = model.NewIntVar(0, len(dates) * 10, "max_m_plus_p")
            min_m_plus_p = model.NewIntVar(0, len(dates) * 10, "min_m_plus_p")
            for load in m_plus_p_total_loads:
                model.Add(max_m_plus_p >= load)
                model.Add(min_m_plus_p <= load)
            m_plus_p_fairness = model.NewIntVar(0, len(dates) * 10, "m_plus_p_fairness")
            model.Add(m_plus_p_fairness == max_m_plus_p - min_m_plus_p)
            fairness_vars.append(m_plus_p_fairness)
        
        if p_total_loads:
            max_p = model.NewIntVar(0, len(dates) * 10, "max_p")
            min_p = model.NewIntVar(0, len(dates) * 10, "min_p")
            for load in p_total_loads:
                model.Add(max_p >= load)
                model.Add(min_p <= load)
            p_fairness = model.NewIntVar(0, len(dates) * 10, "p_fairness")
            model.Add(p_fairness == max_p - min_p)
            fairness_vars.append(p_fairness)
            
        if thursday_total_loads:
            max_thursday = model.NewIntVar(0, len(dates) * 10, "max_thursday")
            min_thursday = model.NewIntVar(0, len(dates) * 10, "min_thursday")
            for load in thursday_total_loads:
                model.Add(max_thursday >= load)
                model.Add(min_thursday <= load)
            thursday_fairness = model.NewIntVar(0, len(dates) * 10, "thursday_fairness")
            model.Add(thursday_fairness == max_thursday - min_thursday)
            fairness_vars.append(thursday_fairness)
            
        if total_working_counts:
            max_working = model.NewIntVar(0, len(dates) * len(_DEFAULT_STANDARD_SHIFTS_LIST), "max_working")
            min_working = model.NewIntVar(0, len(dates) * len(_DEFAULT_STANDARD_SHIFTS_LIST), "min_working")
            for count in total_working_counts:
                model.Add(max_working >= count)
                model.Add(min_working <= count)
            working_fairness = model.NewIntVar(0, len(dates) * len(_DEFAULT_STANDARD_SHIFTS_LIST), "working_fairness")
            model.Add(working_fairness == max_working - min_working)
            fairness_vars.append(working_fairness)
            
        if weekend_total_loads:
            max_weekends = model.NewIntVar(0, len(dates) * 20, "max_weekends")  # Increased upper bound
            min_weekends = model.NewIntVar(0, len(dates) * 20, "min_weekends")
            for load in weekend_total_loads:
                model.Add(max_weekends >= load)
                model.Add(min_weekends <= load)
            weekend_fairness = model.NewIntVar(0, len(dates) * 20, "weekend_fairness")
            model.Add(weekend_fairness == max_weekends - min_weekends)
            fairness_vars.append(weekend_fairness)
        
        return fairness_vars
    
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
        
        for shift_type in _DEFAULT_STANDARD_SHIFTS_LIST:
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
            working_shifts = _DEFAULT_STANDARD_SHIFTS_LIST
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