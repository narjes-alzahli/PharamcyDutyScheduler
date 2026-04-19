"""Sanity checker for roster data before solving."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

from .schema import RosterData

# Match roster/app/model/constraints.py (soft coverage = penalized, not hard equality)
from .constraints import (
    _DEFAULT_STANDARD_SHIFTS as STANDARD_WORKING_SHIFTS_SET,
    _SOFT_COVERAGE_SHIFTS,
)

def _split_messages(messages: List[str]) -> Tuple[List[str], List[str]]:
    errors = [m for m in messages if m.startswith("❌")]
    warnings = [m for m in messages if m.startswith("⚠️")]
    return errors, warnings


def _max_bipartite_matching_size(adj: List[List[int]], n_left: int, n_right: int) -> int:
    """Maximum matching where each left node matches at most one right, each right at most one left."""
    match_r = [-1] * n_right

    def dfs(u: int, seen: List[bool]) -> bool:
        for v in adj[u]:
            if seen[v]:
                continue
            seen[v] = True
            if match_r[v] == -1 or dfs(match_r[v], seen):
                match_r[v] = u
                return True
        return False

    result = 0
    for u in range(n_left):
        seen = [False] * n_right
        if dfs(u, seen):
            result += 1
    return result


def _hard_shifts_for_coverage() -> Set[str]:
    return set(STANDARD_WORKING_SHIFTS_SET) - _SOFT_COVERAGE_SHIFTS


def _employee_can_fill_shift(
    emp: str,
    day: date,
    shift_type: str,
    skills: Dict[str, Dict[str, bool]],
    time_off: Dict[Tuple[str, date], str],
    locks: Dict[Tuple[str, date, str], bool],
    standard: Set[str],
) -> bool:
    """True if this employee could be assigned shift_type on day (skill + availability + locks)."""
    emp_skills = skills.get(emp, {})
    has_skill = bool(emp_skills.get(shift_type, False)) if shift_type != "CL" else bool(emp_skills.get("CL", False))
    if not has_skill:
        return False

    if (emp, day) in time_off:
        leave_code = time_off[(emp, day)]
        if leave_code in standard:
            return False
        if leave_code != "O":
            return False

    if (emp, day, shift_type) in locks and locks[(emp, day, shift_type)] is False:
        return False

    for other_shift in standard:
        if other_shift != shift_type and locks.get((emp, day, other_shift)) is True:
            return False

    return True


def _forced_working_shift(
    emp: str,
    day: date,
    time_off: Dict[Tuple[str, date], str],
    locks: Dict[Tuple[str, date, str], bool],
    standard: Set[str],
) -> Optional[str]:
    """
    If this day is fully determined to one standard working shift, return it.
    Mirrors lock priority: if both O and a working shift are forced, working shift wins (solver behavior).
    """
    if (emp, day) in time_off:
        c = time_off[(emp, day)]
        if c in standard:
            return c

    forced_working: List[str] = []
    for sh in standard:
        if locks.get((emp, day, sh)) is True:
            forced_working.append(sh)

    if not forced_working:
        return None
    if len(forced_working) == 1:
        return forced_working[0]
    if "O" in forced_working:
        non_o = [s for s in forced_working if s != "O"]
        if len(non_o) == 1:
            return non_o[0]
    return None


def _employee_cannot_assign_rest(
    emp: str,
    day: date,
    time_off: Dict[Tuple[str, date], str],
    locks: Dict[Tuple[str, date, str], bool],
    standard: Set[str],
    rest_codes: Set[str],
) -> bool:
    """Heuristic: this day cannot count as a rest day (O / rest leave) for min-days-off / weekly rest."""
    if (emp, day) in time_off:
        code = time_off[(emp, day)]
        if code in standard:
            return True
        if code in rest_codes:
            return False
        return True

    working_forced = [sh for sh in standard if locks.get((emp, day, sh)) is True]
    if working_forced:
        return True
    if locks.get((emp, day, "O")) is True:
        return False
    return False


def _in_hard_matching_pool(
    emp: str,
    day: date,
    time_off: Dict[Tuple[str, date], str],
    locks: Dict[Tuple[str, date, str], bool],
    standard: Set[str],
) -> bool:
    """Employee is not already fixed to a working or off-leave assignment for this day."""
    if _forced_working_shift(emp, day, time_off, locks, standard) is not None:
        return False

    if (emp, day) in time_off:
        code = time_off[(emp, day)]
        if code not in standard and code != "O":
            return False
        if code == "O":
            return False

    if locks.get((emp, day, "O")) is True:
        wf = [sh for sh in standard if locks.get((emp, day, sh)) is True]
        if not wf:
            return False

    if any(locks.get((emp, day, osh)) is True for osh in standard):
        return False

    return True


def check_roster_feasibility(data: RosterData) -> Tuple[bool, List[str]]:
    """
    Check roster data before solving.

    Returns:
        (is_feasible, messages) — is_feasible is False iff any message starts with "❌".
        Messages may include "⚠️" warnings that do not fail the check.
    """
    issues: List[str] = []

    employees = data.get_employee_names()
    dates = data.get_all_dates()
    demands = {day: data.get_daily_requirement(day) for day in dates}
    skills = {emp: data.get_employee_skills(emp) for emp in employees}
    employees_dict = {e.employee: e for e in data.employees}

    time_off: Dict[Tuple[str, date], str] = {}
    for emp in employees:
        for day in dates:
            leave_code = data.get_leave_code(emp, day)
            if leave_code is not None:
                time_off[(emp, day)] = leave_code

    locks: Dict[Tuple[str, date, str], bool] = {}
    shifts = data.get_shifts()
    for emp in employees:
        for day in dates:
            for shift in shifts:
                force = data.get_special_requirement_force(emp, day, shift)
                if force is not None:
                    locks[(emp, day, shift)] = force

    standard = set(STANDARD_WORKING_SHIFTS_SET)
    hard_shifts = _hard_shifts_for_coverage()

    rest_codes: Set[str] = {"O"}
    weekly_rest_minimum = 1
    if getattr(data, "config", None) is not None:
        cfg: Any = data.config
        if getattr(cfg, "rest_codes", None):
            rest_codes = set(cfg.rest_codes)
        if getattr(cfg, "weekly_rest_minimum", None) is not None:
            weekly_rest_minimum = int(cfg.weekly_rest_minimum)

    # --- Issue 0: forced working shift on a zero-demand day (blocking) ---
    # If a shift is not needed on a day (demand=0) but a Must lock exists, the model is infeasible
    # (this includes soft-coverage shifts like M/IP).
    zero_demand_conflicts: List[str] = []
    for (emp, day, shift), force in locks.items():
        if force is not True:
            continue
        if shift not in standard:
            continue
        if day not in demands:
            continue
        required = int((demands.get(day, {}) or {}).get(shift, 0) or 0)
        if required != 0:
            continue
        date_str = day.strftime("%d %B %Y")
        zero_demand_conflicts.append(f"{emp} — {date_str} — {shift}")

    if zero_demand_conflicts:
        preview = "\n".join(f"- {row}" for row in zero_demand_conflicts[:25])
        more = ""
        if len(zero_demand_conflicts) > 25:
            more = f"\n- ... and {len(zero_demand_conflicts) - 25} more"
        def _format_conflict(raw: str) -> str:
            # raw format: "Emp — 01 January 2026 — M"
            parts = [p.strip() for p in raw.split("—")]
            if len(parts) != 3:
                return f"- {raw}"
            emp, date_human, shift = parts
            return f"- {emp} • {date_human} • {shift} (required {shift} shifts on that day = 0)"

        issues.append(
            "❌ Someone was assigned a shift on a day where the shift isn’t needed.\n"
            "Fix: increase demand for that shift on that day, OR remove the approved request.\n"
            "\n"
            "Details:\n"
            + "\n".join(_format_conflict(row) for row in zero_demand_conflicts[:25])
            + (f"\n- ... and {len(zero_demand_conflicts) - 25} more" if len(zero_demand_conflicts) > 25 else "")
        )

    # --- Issue 1A: per-shift hard coverage diagnostics (specific reason per shift/day) ---
    for day in dates:
        if day not in demands:
            continue
        day_demand = demands[day]
        date_str = day.strftime("%d %B %Y")

        for shift_type in hard_shifts:
            required_count = int(day_demand.get(shift_type, 0) or 0)
            if required_count <= 0:
                continue

            skilled_employees: List[str] = []
            available_skilled: List[str] = []
            unavailable_details: List[str] = []

            for emp in employees:
                emp_skills = skills.get(emp, {})
                has_skill = bool(emp_skills.get(shift_type, False)) if shift_type != "CL" else bool(emp_skills.get("CL", False))
                if not has_skill:
                    continue
                skilled_employees.append(emp)

                if _employee_can_fill_shift(emp, day, shift_type, skills, time_off, locks, standard):
                    available_skilled.append(emp)
                    continue

                reasons: List[str] = []
                leave_code = time_off.get((emp, day))
                if leave_code is not None:
                    if leave_code in standard:
                        reasons.append(f"already fixed to {leave_code}")
                    elif leave_code == "O":
                        reasons.append("off (O)")
                    else:
                        reasons.append(f"on leave ({leave_code})")

                if locks.get((emp, day, shift_type)) is False:
                    reasons.append(f"{shift_type} explicitly forbidden")

                forced_other = [
                    other for other in standard
                    if other != shift_type and locks.get((emp, day, other)) is True
                ]
                if forced_other:
                    reasons.append(f"forced to {', '.join(sorted(forced_other))}")

                if not reasons:
                    reasons.append("unavailable due to constraints")

                unavailable_details.append(f"{emp} ({'; '.join(reasons)})")

            if len(skilled_employees) < required_count:
                issues.append(
                    f"❌ {date_str} — **{shift_type}** needs {required_count}, but only "
                    f"{len(skilled_employees)} staff have this skill: "
                    f"{', '.join(skilled_employees) if skilled_employees else 'none'}."
                )
            elif len(available_skilled) < required_count:
                short_by = required_count - len(available_skilled)
                issues.append(
                    f"❌ {date_str} — **{shift_type}** needs {required_count}, but only "
                    f"{len(available_skilled)} skilled staff are available (missing {short_by}). "
                    f"Available: {', '.join(available_skilled) if available_skilled else 'none'}. "
                    f"Unavailable skilled: {', '.join(unavailable_details) if unavailable_details else 'none'}."
                )

    # --- Issue 1B (existing): joint hard coverage per day + M/IP warnings ---
    for day in dates:
        if day not in demands:
            continue
        day_demand = demands[day]

        remaining: Dict[str, int] = {}
        assigned_for_hard: Dict[str, List[Tuple[str, str]]] = {}
        for st in hard_shifts:
            need = int(day_demand.get(st, 0) or 0)
            if need > 0:
                remaining[st] = need
                assigned_for_hard[st] = []

        for emp in employees:
            fs = _forced_working_shift(emp, day, time_off, locks, standard)
            if fs is None or fs not in hard_shifts or fs not in assigned_for_hard:
                continue

            source = "admin-assigned"
            if (emp, day) in time_off and time_off[(emp, day)] == fs:
                source = "approved by admin"
            elif locks.get((emp, day, fs)) is True:
                source = "assigned by admin"

            assigned_for_hard[fs].append((emp, source))
            if remaining.get(fs, 0) > 0:
                remaining[fs] -= 1

        date_str = day.strftime("%d %B %Y")
        for st, assigned_entries in assigned_for_hard.items():
            required_count = int(day_demand.get(st, 0) or 0)
            assigned_count = len(assigned_entries)
            if assigned_count <= required_count:
                continue
            assigned_details = ", ".join([f"{emp} ({src})" for emp, src in assigned_entries])
            issues.append(
                f"❌ {date_str} — **{st}** needs {required_count}, but {assigned_count} are already fixed: "
                f"{assigned_details}."
            )

        pool: List[str] = [emp for emp in employees if _in_hard_matching_pool(emp, day, time_off, locks, standard)]

        slot_labels: List[str] = []
        for st, cnt in remaining.items():
            for _ in range(max(0, cnt)):
                slot_labels.append(st)

        n_slots = len(slot_labels)
        if n_slots > 0:
            adj: List[List[int]] = []
            for emp in pool:
                edges: List[int] = []
                for si, st in enumerate(slot_labels):
                    if _employee_can_fill_shift(emp, day, st, skills, time_off, locks, standard):
                        edges.append(si)
                adj.append(edges)

            msize = _max_bipartite_matching_size(adj, len(pool), n_slots)
            if msize < n_slots:
                date_str = day.strftime("%d %B %Y")
                missing = n_slots - msize
                rem_pos = {k: v for k, v in remaining.items() if v > 0}
                issues.append(
                    f"❌ {date_str} — combined shift coverage is not possible. "
                    f"We still need {n_slots} shift assignment(s), but we are short by at least {missing} staff. "
                    f"Remaining shift needs: {rem_pos}."
                )

        for shift_type in _SOFT_COVERAGE_SHIFTS:
            if shift_type not in day_demand or day_demand[shift_type] <= 0:
                continue
            required_count = int(day_demand[shift_type])
            available_count = 0
            available_employees: List[str] = []
            for emp in employees:
                if not _employee_can_fill_shift(emp, day, shift_type, skills, time_off, locks, standard):
                    continue
                available_count += 1
                available_employees.append(emp)
            if available_count < required_count:
                date_str = day.strftime("%d %B %Y")
                missing = required_count - available_count
                issues.append(
                    f"⚠️ Soft coverage (M/IP): on {date_str} for **{shift_type}**, "
                    f"demand is {required_count} but only {available_count} capable staff are available "
                    f"({', '.join(available_employees) if available_employees else 'none'}). "
                    f"Short by {missing} — the solver may under-fill this shift (penalty), not fail."
                )

    # --- Issue 2: conflicting requests (unchanged) ---
    employee_day_requests: Dict[Tuple[str, date], List[str]] = {}
    for (emp, day), leave_code in time_off.items():
        employee_day_requests.setdefault((emp, day), []).append(leave_code)

    for (emp, day), requests in employee_day_requests.items():
        if len(requests) > 1:
            unique_requests = list(set(requests))
            if len(unique_requests) > 1:
                date_str = day.strftime("%d %B %Y")
                issues.append(
                    f"❌ Conflicting requests for {emp} on {date_str}: "
                    f"{', '.join(unique_requests)}"
                )

    employee_day_locks: Dict[Tuple[str, date], List[str]] = {}
    for (emp, day, shift), force in locks.items():
        if force is True:
            employee_day_locks.setdefault((emp, day), []).append(shift)

    for (emp, day), locked_shifts in employee_day_locks.items():
        if len(locked_shifts) > 1:
            unique_shifts = list(set(locked_shifts))
            if len(unique_shifts) == 2 and "O" in unique_shifts:
                other_shift = [s for s in unique_shifts if s != "O"][0]
                if other_shift in standard:
                    continue
            date_str = day.strftime("%d %B %Y")
            issues.append(
                f"❌ Conflicting lock assignments for {emp} on {date_str}: "
                f"forced to work {', '.join(unique_shifts)}"
            )

    for (emp, day), leave_code in time_off.items():
        if leave_code not in standard and leave_code != "O":
            for shift in standard:
                if (emp, day, shift) in locks and locks[(emp, day, shift)] is True:
                    date_str = day.strftime("%d %B %Y")
                    issues.append(
                        f"❌ Conflict for {emp} on {date_str}: "
                        f"has **{leave_code}** but also forced to work **{shift}**"
                    )
        elif leave_code in standard:
            for shift in standard:
                if shift != leave_code and (emp, day, shift) in locks and locks[(emp, day, shift)] is True:
                    date_str = day.strftime("%d %B %Y")
                    issues.append(
                        f"❌ Conflict for {emp} on {date_str}: "
                        f"has **{leave_code}** but also forced to work **{shift}**"
                    )

    # --- Issue 3: skill mismatches (unchanged) ---
    for (emp, day), leave_code in time_off.items():
        if leave_code in standard:
            emp_skills = skills.get(emp, {})
            if not emp_skills.get(leave_code, False):
                date_str = day.strftime("%d %B %Y")
                issues.append(
                    f"❌ Skill mismatch for {emp} on {date_str}: "
                    f"requested **{leave_code}** but doesn't have that skill"
                )

    for (emp, day, shift), force in locks.items():
        if force is True and shift in standard:
            emp_skills = skills.get(emp, {})
            if not emp_skills.get(shift, False):
                date_str = day.strftime("%d %B %Y")
                issues.append(
                    f"❌ Skill mismatch for {emp} on {date_str}: "
                    f"forced to work **{shift}** but doesn't have that skill"
                )

    # --- Issue 4: contradictory locks (unchanged) ---
    lock_conflicts: Dict[Tuple[str, date, str], List[bool]] = {}
    for (emp, day, shift), force in locks.items():
        key = (emp, day, shift)
        lock_conflicts.setdefault(key, []).append(force)

    for (emp, day, shift), force_values in lock_conflicts.items():
        if len(force_values) > 1 and True in force_values and False in force_values:
            date_str = day.strftime("%d %B %Y")
            issues.append(
                f"❌ Contradictory lock constraint for {emp} on {date_str} "
                f"for **{shift}**: both forced and forbidden"
            )

    # --- Single-skill: wrong standard shift forced (solver cannot assign another standard shift) ---
    for emp in employees:
        emp_skills = skills.get(emp, {})
        qualified_shifts = [s for s in standard if emp_skills.get(s, False)]
        if len(qualified_shifts) != 1:
            continue
        single_shift = qualified_shifts[0]

        for day in dates:
            for shift in standard:
                if shift != single_shift and (emp, day, shift) in locks and locks[(emp, day, shift)] is True:
                    date_str = day.strftime("%d %B %Y")
                    issues.append(
                        f"❌ Single-skill employee {emp} on {date_str}: "
                        f"can only work **{single_shift}** but forced to work **{shift}**"
                    )

    # --- Necessary condition: min_days_off vs forced non-rest days ---
    for emp in employees:
        emp_model = employees_dict.get(emp)
        if not emp_model:
            continue
        min_off = int(emp_model.min_days_off)
        cannot_rest_days = 0
        for day in dates:
            if _employee_cannot_assign_rest(emp, day, time_off, locks, standard, rest_codes):
                cannot_rest_days += 1
        max_rest_achievable = len(dates) - cannot_rest_days
        if max_rest_achievable < min_off:
            issues.append(
                f"⚠️ **Min days off:** {emp} needs {min_off} rest days in the period but at most "
                f"{max_rest_achievable} day(s) could be rest/leave (heuristic: days already fixed to "
                f"working shifts or non-rest leave). The full solver may still find a feasible mix — "
                f"verify locks and leave types."
            )

    # --- Weekly rest heuristic ---
    weeks: Dict[date, List[date]] = {}
    for day in dates:
        wk = day - timedelta(days=day.weekday())
        weeks.setdefault(wk, []).append(day)

    for week_start, week_dates in weeks.items():
        if len(week_dates) < 5:
            continue
        for emp in employees:
            all_forced = True
            for day in week_dates:
                if not _employee_cannot_assign_rest(emp, day, time_off, locks, standard, rest_codes):
                    all_forced = False
                    break
            if all_forced:
                issues.append(
                    f"⚠️ **Weekly rest:** {emp} may have no day off in week starting "
                    f"{week_start.strftime('%d %B %Y')} (every day appears fixed to working or "
                    f"non-rest leave — heuristic). Weekly minimum is {weekly_rest_minimum} rest day(s)."
                )

    errors, _warnings = _split_messages(issues)
    is_feasible = len(errors) == 0
    return is_feasible, issues
