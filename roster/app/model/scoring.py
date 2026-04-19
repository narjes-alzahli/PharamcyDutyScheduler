"""Scoring functions for staff rostering optimization."""

from datetime import date, timedelta
from typing import Dict, List, Tuple, Any, Optional, Set
from ortools.sat.python import cp_model

# Default standard working shifts (fallback when demands don't include all shifts)
# These should match what's in the database - updated when standard shifts change
_DEFAULT_STANDARD_SHIFTS_LIST = ["M", "IP", "A", "N", "M3", "M4", "H", "CL", "E", "MS", "IP+P", "P", "M+P"]
_AS_RANGE_SHIFTS = {"A", "N", "M4", "E"}
_AS_OUTSIDE_RANGE_SHIFTS = {"M", "M3", "IP"}


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
        time_off: Optional[Dict[Tuple[str, date], str]] = None,
        initial_pending_off: Optional[Dict[str, float]] = None,
        required_rest_after_shifts: Optional[List[Dict[str, Any]]] = None,
        leave_codes: Optional[Set[str]] = None,
        locks: Optional[Dict[Tuple[str, date, str], bool]] = None,
        working_shift_codes: Optional[List[str]] = None,
        previous_period_shifts: Optional[Dict[Tuple[str, date], str]] = None,
        as_preferences: Optional[List[Any]] = None,
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

        weekend_spacing_vars = self._add_weekend_spacing_variables(
            model, x, employees, dates, previous_period_shifts, locks, working_shift_codes
        )
        if weekend_spacing_vars:
            objectives.append(
                sum(weekend_spacing_vars) * self.weights.get("weekend_spacing", 1500.0)
            )

        pending_off_negative_vars = self._add_pending_off_negative_variables(
            model, x, employees, dates, skills, initial_pending_off
        )
        if pending_off_negative_vars:
            objectives.append(
                sum(pending_off_negative_vars) * self.weights.get("pending_off_negative", 500.0)
            )
        
        # 4. Fairness penalty (with history awareness)
        # [HISTORY_AWARE_FAIRNESS] Pass history_counts to fairness calculation
        fairness_vars = self._add_fairness_variables(
            model, x, employees, dates, demands, skills, history_counts, time_off
        )
        if fairness_vars:
            objectives.append(sum(fairness_vars) * self.weights.get("fairness", 5.0))

        as_preference_vars = self._add_as_preference_variables(
            model, x, dates, as_preferences
        )
        if as_preference_vars:
            objectives.append(sum(as_preference_vars) * self.weights.get("as_preference", 1000.0))
        
        # DO after N preference removed - DO is now only assigned when requested in time off
        # (No longer preferring DO after N shifts)
        
        if objectives:
            model.Minimize(sum(objectives))

    def _add_as_preference_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        dates: List[date],
        as_preferences: Optional[List[Any]] = None,
    ) -> List[cp_model.IntVar]:
        """Add penalty vars for AS preference ranges.

        Inside AS range -> prefer {A, N, M4, E}
        Outside AS range (same request month) -> prefer {M, M3, IP}
        """
        if not as_preferences:
            return []

        date_set = set(dates)
        emp_month_ranges: Dict[Tuple[str, int, int], Set[date]] = {}
        for pref in as_preferences:
            if isinstance(pref, dict):
                employee = pref.get("employee")
                from_date = pref.get("from_date")
                to_date = pref.get("to_date")
            else:
                employee = getattr(pref, "employee", None)
                from_date = getattr(pref, "from_date", None)
                to_date = getattr(pref, "to_date", None)
            if not employee or not from_date or not to_date:
                continue
            month_key = (employee, from_date.year, from_date.month)
            if month_key not in emp_month_ranges:
                emp_month_ranges[month_key] = set()
            current = from_date
            while current <= to_date:
                if current.year == from_date.year and current.month == from_date.month:
                    emp_month_ranges[month_key].add(current)
                current += timedelta(days=1)

        misses: List[cp_model.IntVar] = []
        for (emp, year, month), inside_range_days in emp_month_ranges.items():
            for day in dates:
                if day.year != year or day.month != month or day not in date_set:
                    continue

                preferred_shifts = _AS_RANGE_SHIFTS if day in inside_range_days else _AS_OUTSIDE_RANGE_SHIFTS
                preferred_vars = [x[(emp, day, s)] for s in preferred_shifts if (emp, day, s) in x]
                if not preferred_vars:
                    continue

                preferred_assigned = model.NewIntVar(0, 1, f"as_pref_assigned_{emp}_{day}")
                model.Add(preferred_assigned == sum(preferred_vars))
                miss = model.NewBoolVar(f"as_pref_miss_{emp}_{day}")
                model.Add(miss + preferred_assigned == 1)
                misses.append(miss)

        return misses
    
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

    def _add_weekend_spacing_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date],
        previous_period_shifts: Optional[Dict[Tuple[str, date], str]] = None,
        locks: Optional[Dict[Tuple[str, date, str], bool]] = None,
        working_shift_codes: Optional[List[str]] = None,
    ) -> List[cp_model.IntVar]:
        """Penalize back-to-back weekends softly, including across the period boundary."""
        if not dates:
            return []

        penalties: List[cp_model.IntVar] = []
        working_shifts = set(working_shift_codes) if working_shift_codes else set(_DEFAULT_STANDARD_SHIFTS_LIST)
        date_set = set(dates)
        sorted_dates = sorted(dates)
        friday_dates = [d for d in sorted_dates if d.weekday() == 4]

        for emp in employees:
            weekend_work_vars: Dict[date, cp_model.IntVar] = {}
            for friday in friday_dates:
                saturday = friday + timedelta(days=1)
                if saturday not in date_set:
                    continue

                fri_work_vars = [x[(emp, friday, shift)] for shift in working_shifts if (emp, friday, shift) in x]
                sat_work_vars = [x[(emp, saturday, shift)] for shift in working_shifts if (emp, saturday, shift) in x]
                if not fri_work_vars and not sat_work_vars:
                    continue

                works_this_weekend = model.NewBoolVar(f"weekend_spacing_work_{emp}_{friday}")
                weekend_work_sum = sum(fri_work_vars) + sum(sat_work_vars)
                model.Add(weekend_work_sum >= works_this_weekend)
                model.Add(weekend_work_sum <= 2 * works_this_weekend)
                weekend_work_vars[friday] = works_this_weekend

            for friday in friday_dates:
                next_friday = friday + timedelta(days=7)
                if friday in weekend_work_vars and next_friday in weekend_work_vars:
                    consecutive = self._link_and_var(
                        model,
                        [weekend_work_vars[friday], weekend_work_vars[next_friday]],
                        f"consecutive_weekend_{emp}_{friday}"
                    )
                    penalties.append(consecutive)

            if previous_period_shifts:
                prev_dates = sorted({d for (prev_emp, d) in previous_period_shifts.keys() if prev_emp == emp})
                if prev_dates and friday_dates:
                    first_friday = friday_dates[0]
                    prev_saturday = None
                    for delta in range(1, 8):
                        candidate = first_friday - timedelta(days=delta)
                        if candidate.weekday() == 5:
                            prev_saturday = candidate
                            break
                    if prev_saturday is not None:
                        prev_friday = prev_saturday - timedelta(days=1)
                        worked_prev_weekend = (
                            previous_period_shifts.get((emp, prev_friday)) in working_shifts
                            or previous_period_shifts.get((emp, prev_saturday)) in working_shifts
                        )
                        if worked_prev_weekend and first_friday in weekend_work_vars:
                            forced_first_weekend = False
                            if locks:
                                for target_day in (first_friday, first_friday + timedelta(days=1)):
                                    forced_first_weekend = forced_first_weekend or any(
                                        locks.get((emp, target_day, shift)) is True
                                        for shift in working_shifts
                                    )
                            if not forced_first_weekend:
                                penalties.append(weekend_work_vars[first_friday])

        return penalties

    def _add_pending_off_negative_variables(
        self,
        model: cp_model.CpModel,
        x: Dict[Tuple[str, date, str], cp_model.IntVar],
        employees: List[str],
        dates: List[date],
        skills: Dict[str, Dict[str, bool]],
        initial_pending_off: Optional[Dict[str, float]] = None,
    ) -> List[cp_model.IntVar]:
        """Penalize negative pending_off without incentivizing extra N shifts.

        We use a baseline pending_off that ignores N-credit, so the optimizer is pushed to
        reduce excess O assignments for people with low balances, instead of increasing N
        purely to raise pending_off.
        """
        if not dates:
            return []

        penalties: List[cp_model.IntVar] = []
        initial_pending_off = initial_pending_off or {}
        weekend_days_in_month = sum(1 for d in dates if d.weekday() in (4, 5))

        for emp in employees:
            emp_skills = skills.get(emp, {})
            enabled_skill_count = sum(1 for is_enabled in emp_skills.values() if bool(is_enabled))
            if enabled_skill_count == 1:
                continue

            o_vars = [x[(emp, day, "O")] for day in dates if (emp, day, "O") in x]
            os_given = model.NewIntVar(0, len(dates), f"po_os_{emp}")
            model.Add(os_given == sum(o_vars) if o_vars else 0)

            initial_po = int(round(float(initial_pending_off.get(emp, 0.0))))
            lower_bound = initial_po - len(dates)
            upper_bound = initial_po + weekend_days_in_month
            baseline_po = model.NewIntVar(lower_bound, upper_bound, f"po_baseline_{emp}")
            model.Add(baseline_po == initial_po + weekend_days_in_month - os_given)

            negative_po = model.NewIntVar(0, max(0, -lower_bound), f"po_negative_{emp}")
            model.AddMaxEquality(negative_po, [-baseline_po, 0])
            penalties.append(negative_po)

        return penalties

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
        demands: Dict[date, Dict[str, int]],
        skills: Dict[str, Dict[str, bool]],
        history_counts: Dict[str, Dict[str, int]] = None,  # [HISTORY_AWARE_FAIRNESS] Added parameter
        time_off: Optional[Dict[Tuple[str, date], str]] = None,
    ) -> List[cp_model.IntVar]:
        """Add variables to penalize unfair distribution of shifts.
        
        Args:
            history_counts: Dict mapping category name to dict mapping employee name to history count.
                          Categories: "nights", "afternoons", "m4", "thursdays", "weekends"
                          If None, uses current period only (no history).
                          [HISTORY_AWARE_FAIRNESS] This enables history-aware fairness across months
        """
        fairness_vars = []
        time_off = time_off or {}
        base_fairness_weight = max(float(self.weights.get("fairness", 5.0)), 1.0)
        quota_missing_weight = 200
        quota_excess_weight = 200
        quota_history_weight = 1
        a_m4_missing_weight = max(1, int(round(self.weights.get("a_m4_zero_priority", 3000.0) / base_fairness_weight)))
        a_m4_excess_weight = max(1, int(round(self.weights.get("a_m4_cap_priority", 5000.0) / base_fairness_weight)))
        a_m4_flip_weight = max(1, int(round(self.weights.get("a_m4_flip_priority", 300.0) / base_fairness_weight)))
        priority_weights = {
            "night": (
                max(1, int(round(self.weights.get("night_zero_priority", 2500.0) / base_fairness_weight))),
                max(1, int(round(self.weights.get("night_cap_priority", 4000.0) / base_fairness_weight))),
            ),
            "thursday": (
                max(1, int(round(self.weights.get("thursday_zero_priority", 2500.0) / base_fairness_weight))),
                max(1, int(round(self.weights.get("thursday_cap_priority", 4000.0) / base_fairness_weight))),
            ),
            "weekend": (
                max(1, int(round(self.weights.get("weekend_zero_priority", 2500.0) / base_fairness_weight))),
                max(1, int(round(self.weights.get("weekend_cap_priority", 4000.0) / base_fairness_weight))),
            ),
        }
        
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
        
        # Fairness model:
        # - A/M4 are handled as one interacting family with a month-to-month flip preference.
        # - N / Thursday / Weekend are independent history-aware burden-sharing buckets.
        # - IP and M+M3 keep quota-style current-period balancing.
        # Leave handling is included by excluding leave days from category opportunity counts.
        e_total_loads = []
        m_plus_p_total_loads = []
        p_total_loads = []
        total_working_counts = []
        history_bias_terms = []

        def is_single_skill_employee(emp: str) -> bool:
            emp_skills = skills.get(emp, {})
            qualified_shifts = [
                shift for shift in _DEFAULT_STANDARD_SHIFTS_LIST
                if emp_skills.get(shift, False)
            ]
            return len(qualified_shifts) == 1

        def employee_on_leave(emp: str, day: date) -> bool:
            return (emp, day) in time_off

        def employee_has_any_skill(emp: str, shift_codes: List[str]) -> bool:
            emp_skills = skills.get(emp, {})
            return any(emp_skills.get(code, False) for code in shift_codes)

        def count_opportunities(emp: str, category_days: List[date], shift_codes: List[str]) -> int:
            if not employee_has_any_skill(emp, shift_codes):
                return 0
            opportunities = 0
            for day in category_days:
                if employee_on_leave(emp, day):
                    continue
                if any((emp, day, shift) in x for shift in shift_codes):
                    opportunities += 1
            return opportunities

        def sum_assignments(emp: str, category_days: List[date], shift_codes: List[str], var_name: str, upper_bound: int) -> Optional[cp_model.IntVar]:
            vars_for_category = [
                x[(emp, day, shift)]
                for day in category_days
                for shift in shift_codes
                if (emp, day, shift) in x
            ]
            if not vars_for_category:
                return None
            count_var = model.NewIntVar(0, upper_bound, var_name)
            model.Add(count_var == sum(vars_for_category))
            return count_var

        def add_quota_category(
            category_name: str,
            category_days: List[date],
            shift_codes: List[str],
            total_required: int,
            history_key: Optional[str] = None,
            exclude_shifts: Optional[Set[str]] = None,
        ) -> None:
            if total_required <= 0 or not category_days:
                return

            eligible_counts: Dict[str, cp_model.IntVar] = {}
            opportunity_counts: Dict[str, int] = {}
            active_employees: List[str] = []

            for emp in non_clinicians:
                if is_single_skill_employee(emp):
                    continue

                if exclude_shifts:
                    allowed_codes = [
                        code for code in _DEFAULT_STANDARD_SHIFTS_LIST
                        if code not in exclude_shifts and skills.get(emp, {}).get(code, False)
                    ]
                else:
                    allowed_codes = [code for code in shift_codes if skills.get(emp, {}).get(code, False)]

                if not allowed_codes:
                    continue

                opportunities = count_opportunities(emp, category_days, allowed_codes)
                if opportunities <= 0:
                    continue

                upper_bound = len(category_days) * max(1, len(allowed_codes))
                count_var = sum_assignments(
                    emp,
                    category_days,
                    allowed_codes,
                    f"{category_name}_count_{emp}",
                    upper_bound,
                )
                if count_var is None:
                    continue

                eligible_counts[emp] = count_var
                opportunity_counts[emp] = opportunities
                active_employees.append(emp)

            if len(active_employees) < 2:
                return

            missing_weight, excess_weight = priority_weights.get(
                category_name,
                (quota_missing_weight, quota_excess_weight),
            )
            max_opportunity = max(opportunity_counts.values()) if opportunity_counts else 0
            fair_max = max_opportunity
            for candidate in range(max_opportunity + 1):
                capped_capacity = sum(min(opportunity_counts[emp], candidate) for emp in active_employees)
                if capped_capacity >= total_required:
                    fair_max = candidate
                    break

            for emp in active_employees:
                count_var = eligible_counts[emp]

                has_assignment = model.NewBoolVar(f"{category_name}_has_assignment_{emp}")
                missing_assignment = model.NewBoolVar(f"{category_name}_missing_assignment_{emp}")
                model.Add(count_var >= 1).OnlyEnforceIf(has_assignment)
                model.Add(count_var == 0).OnlyEnforceIf(has_assignment.Not())
                model.Add(has_assignment + missing_assignment == 1)
                fairness_vars.append(missing_assignment * missing_weight)

                excess_upper = max(0, opportunity_counts[emp] - fair_max)
                if excess_upper > 0:
                    excess_var = model.NewIntVar(0, excess_upper, f"{category_name}_excess_{emp}")
                    model.Add(excess_var >= count_var - fair_max)
                    fairness_vars.append(excess_var * excess_weight)

                if history_key:
                    history_value = history_counts.get(history_key, {}).get(emp, 0)
                    history_bias_terms.append(count_var * history_value * quota_history_weight)

        def compute_fair_cap(active_employees: List[str], opportunity_counts: Dict[str, int], total_required: int) -> int:
            max_opportunity = max(opportunity_counts.values()) if opportunity_counts else 0
            fair_max = max_opportunity
            for candidate in range(max_opportunity + 1):
                capped_capacity = sum(min(opportunity_counts[emp], candidate) for emp in active_employees)
                if capped_capacity >= total_required:
                    fair_max = candidate
                    break
            return fair_max

        def add_a_m4_family() -> None:
            a_days = dates
            m4_days = dates
            total_a_required = sum((demands.get(day, {}) or {}).get("A", 0) for day in a_days)
            total_m4_required = sum((demands.get(day, {}) or {}).get("M4", 0) for day in m4_days)
            if total_a_required <= 0 and total_m4_required <= 0:
                return

            a_counts: Dict[str, cp_model.IntVar] = {}
            m4_counts: Dict[str, cp_model.IntVar] = {}
            a_opportunities: Dict[str, int] = {}
            m4_opportunities: Dict[str, int] = {}
            active_employees: List[str] = []

            for emp in non_clinicians:
                if is_single_skill_employee(emp):
                    continue
                emp_skills = skills.get(emp, {})
                can_a = bool(emp_skills.get("A", False))
                can_m4 = bool(emp_skills.get("M4", False))
                if not can_a and not can_m4:
                    continue

                opp_a = count_opportunities(emp, a_days, ["A"]) if can_a else 0
                opp_m4 = count_opportunities(emp, m4_days, ["M4"]) if can_m4 else 0
                if opp_a <= 0 and opp_m4 <= 0:
                    continue

                active_employees.append(emp)
                a_opportunities[emp] = opp_a
                m4_opportunities[emp] = opp_m4

                if opp_a > 0:
                    a_count = sum_assignments(emp, a_days, ["A"], f"a_family_count_{emp}", len(a_days))
                    if a_count is not None:
                        a_counts[emp] = a_count
                        has_a = model.NewBoolVar(f"a_family_has_{emp}")
                        missing_a = model.NewBoolVar(f"a_family_missing_{emp}")
                        model.Add(a_count >= 1).OnlyEnforceIf(has_a)
                        model.Add(a_count == 0).OnlyEnforceIf(has_a.Not())
                        model.Add(has_a + missing_a == 1)
                        fairness_vars.append(missing_a * a_m4_missing_weight)

                if opp_m4 > 0:
                    m4_count = sum_assignments(emp, m4_days, ["M4"], f"m4_family_count_{emp}", len(m4_days))
                    if m4_count is not None:
                        m4_counts[emp] = m4_count
                        has_m4 = model.NewBoolVar(f"m4_family_has_{emp}")
                        missing_m4 = model.NewBoolVar(f"m4_family_missing_{emp}")
                        model.Add(m4_count >= 1).OnlyEnforceIf(has_m4)
                        model.Add(m4_count == 0).OnlyEnforceIf(has_m4.Not())
                        model.Add(has_m4 + missing_m4 == 1)
                        fairness_vars.append(missing_m4 * a_m4_missing_weight)

            if len(active_employees) < 2:
                return

            a_active = [emp for emp in active_employees if a_opportunities.get(emp, 0) > 0 and emp in a_counts]
            m4_active = [emp for emp in active_employees if m4_opportunities.get(emp, 0) > 0 and emp in m4_counts]
            a_fair_cap = compute_fair_cap(a_active, a_opportunities, total_a_required) if a_active and total_a_required > 0 else 0
            m4_fair_cap = compute_fair_cap(m4_active, m4_opportunities, total_m4_required) if m4_active and total_m4_required > 0 else 0

            for emp in a_active:
                a_count = a_counts[emp]
                excess_upper = max(0, a_opportunities[emp] - a_fair_cap)
                if excess_upper > 0:
                    a_excess = model.NewIntVar(0, excess_upper, f"a_family_excess_{emp}")
                    model.Add(a_excess >= a_count - a_fair_cap)
                    fairness_vars.append(a_excess * a_m4_excess_weight)

            for emp in m4_active:
                m4_count = m4_counts[emp]
                excess_upper = max(0, m4_opportunities[emp] - m4_fair_cap)
                if excess_upper > 0:
                    m4_excess = model.NewIntVar(0, excess_upper, f"m4_family_excess_{emp}")
                    model.Add(m4_excess >= m4_count - m4_fair_cap)
                    fairness_vars.append(m4_excess * a_m4_excess_weight)

            # Flip effect: if someone had more A last period, prefer more M4 now, and vice versa.
            for emp in active_employees:
                if emp not in a_counts and emp not in m4_counts:
                    continue
                a_count = a_counts.get(emp)
                m4_count = m4_counts.get(emp)
                current_a = a_count if a_count is not None else 0
                current_m4 = m4_count if m4_count is not None else 0
                prev_a = history_counts.get("afternoons", {}).get(emp, 0)
                prev_m4 = history_counts.get("m4", {}).get(emp, 0)
                prev_balance = prev_a - prev_m4

                delta_bound = len(dates) + abs(prev_balance)
                balance_delta = model.NewIntVar(-delta_bound, delta_bound, f"a_m4_balance_delta_{emp}")
                model.Add(balance_delta == current_a - current_m4 + prev_balance)
                flip_penalty = model.NewIntVar(0, delta_bound, f"a_m4_flip_penalty_{emp}")
                model.AddAbsEquality(flip_penalty, balance_delta)
                fairness_vars.append(flip_penalty * a_m4_flip_weight)
        
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
            
            # Total working days (all shifts) - only for multi-skill employees
            # Note: This category doesn't use history (as per requirements)
            working_vars = []
            for day in dates:
                for shift in _DEFAULT_STANDARD_SHIFTS_LIST:
                    working_vars.append(x[(emp, day, shift)])
            total_working = model.NewIntVar(0, len(dates) * len(_DEFAULT_STANDARD_SHIFTS_LIST), f"total_working_{emp}")
            model.Add(total_working == sum(working_vars))
            total_working_counts.append(total_working)
        
        thursday_days = [day for day in dates if day.weekday() == 3]
        weekend_days = [day for day in dates if day.weekday() in [4, 5]]

        add_quota_category(
            "night",
            dates,
            ["N"],
            sum((demands.get(day, {}) or {}).get("N", 0) for day in dates),
            history_key="nights",
        )
        add_quota_category(
            "ip",
            dates,
            ["IP"],
            sum((demands.get(day, {}) or {}).get("IP", 0) for day in dates),
            history_key=None,
        )
        add_quota_category(
            "m_m3",
            dates,
            ["M", "M3"],
            sum(((demands.get(day, {}) or {}).get("M", 0) + (demands.get(day, {}) or {}).get("M3", 0)) for day in dates),
            history_key=None,
        )
        add_a_m4_family()
        add_quota_category(
            "thursday",
            thursday_days,
            ["A", "M4", "N", "E"],
            sum(
                (demands.get(day, {}) or {}).get(shift, 0)
                for day in thursday_days
                for shift in ["A", "M4", "N", "E"]
            ),
            history_key="thursdays",
        )
        add_quota_category(
            "weekend",
            weekend_days,
            ["A", "M3", "N", "E"],
            sum(
                (demands.get(day, {}) or {}).get(shift, 0)
                for day in weekend_days
                for shift in ["A", "M3", "N", "E"]
            ),
            history_key="weekends",
        )

        if history_bias_terms:
            fairness_vars.append(sum(history_bias_terms))
        
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
            
        if total_working_counts:
            max_working = model.NewIntVar(0, len(dates) * len(_DEFAULT_STANDARD_SHIFTS_LIST), "max_working")
            min_working = model.NewIntVar(0, len(dates) * len(_DEFAULT_STANDARD_SHIFTS_LIST), "min_working")
            for count in total_working_counts:
                model.Add(max_working >= count)
                model.Add(min_working <= count)
            working_fairness = model.NewIntVar(0, len(dates) * len(_DEFAULT_STANDARD_SHIFTS_LIST), "working_fairness")
            model.Add(working_fairness == max_working - min_working)
            fairness_vars.append(working_fairness)
            
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