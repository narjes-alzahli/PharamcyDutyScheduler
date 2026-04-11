#!/usr/bin/env python3
"""One-off: load DB data for a calendar month like the solver does; run sanity + short solve."""
from __future__ import annotations

import calendar
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import yaml

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import SessionLocal  # noqa: E402
from backend.models import LeaveType, ShiftType  # noqa: E402
from backend.roster_data_loader import (  # noqa: E402
    get_standard_working_shifts,
    load_month_demands,
    load_month_holidays,
    load_previous_period_last_days,
    load_roster_data_from_db,
)
from backend.routers.solver import FORBIDDEN_ADJACENCY_PAIRS, SolveRequest  # noqa: E402
from roster.app.model.sanity_check import check_roster_feasibility  # noqa: E402
from roster.app.model.schema import RosterConfig, RosterData  # noqa: E402
from roster.app.model.solver import RosterSolver  # noqa: E402


def main() -> None:
    year = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    month = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    time_limit = int(sys.argv[3]) if len(sys.argv) > 3 else 90

    start_date = date(year, month, 1)
    end_date = date(year, month, calendar.monthrange(year, month)[1])
    period_name = f"{year}-{month:02d}"

    db = SessionLocal()
    try:
        roster_data = load_roster_data_from_db(db, expand_ranges=True)
        month_demands = load_month_demands(year, month, db)
        holidays_dict = load_month_holidays(year, month, db)

        print("=== April" if month == 4 else "=== Month", f"{period_name} (local DB) ===\n")
        print(f"Demand rows in DB for month: {len(month_demands)}")
        print(f"Employees (skills rows): {len(roster_data['employees'])}")
        print(f"Time-off rows (expanded): {len(roster_data['time_off'])}")
        print(f"Lock rows (shift requests expanded): {len(roster_data['locks'])}")

        if month_demands.empty:
            print("\n** No demands for this month — solver fails immediately with empty demands.")
            return

        # Skill counts (for intuition)
        emp_df = roster_data["employees"]
        skill_cols = [c for c in emp_df.columns if c.startswith("skill_")]
        print("\n--- Staff count with each skill (True) ---")
        for c in skill_cols:
            code = c.replace("skill_", "").replace("_", "+")  # rough
            if c == "skill_IP_P":
                code = "IP+P"
            elif c == "skill_M_P":
                code = "M+P"
            n = int(emp_df[c].sum()) if c in emp_df.columns else 0
            print(f"  {code}: {n}")

        prev = load_previous_period_last_days(start_date, db)
        print(f"\nPrevious committed period — last-days shift entries loaded: {len(prev)}")
        if prev:
            dates = sorted({d for _, d in prev.keys()})
            print(f"  Dates in DB (last segment): {dates[0]} .. {dates[-1]} ({len(dates)} day(s))")

        request = SolveRequest(year=year, month=month, time_limit=time_limit)

        with tempfile.TemporaryDirectory() as tmp:
            temp_path = Path(tmp)
            roster_data["employees"].to_csv(temp_path / "employees.csv", index=False)

            demands_for_csv = month_demands.copy()
            if "holiday" in demands_for_csv.columns:
                demands_for_csv = demands_for_csv.drop(columns=["holiday"])
            if "date" in demands_for_csv.columns:
                demands_for_csv["date"] = pd.to_datetime(
                    demands_for_csv["date"], errors="coerce"
                ).dt.strftime("%Y-%m-%d")
            demands_for_csv.to_csv(temp_path / "demands.csv", index=False)

            holidays_for_csv = {}
            for date_str, holiday_name in holidays_dict.items():
                try:
                    date_val = pd.to_datetime(date_str, errors="coerce").date()
                    if date_val:
                        holidays_for_csv[date_val] = holiday_name
                except Exception:
                    continue
            if holidays_for_csv:
                holidays_df = pd.DataFrame(
                    [
                        {"date": date_val.isoformat(), "holiday": holiday_name}
                        for date_val, holiday_name in holidays_for_csv.items()
                    ]
                )
                holidays_df.to_csv(temp_path / "holidays.csv", index=False)

            time_off_for_csv = roster_data["time_off"].copy()
            if not time_off_for_csv.empty:
                if "from_date" in time_off_for_csv.columns:
                    time_off_for_csv["from_date"] = pd.to_datetime(
                        time_off_for_csv["from_date"], errors="coerce"
                    ).dt.strftime("%Y-%m-%d")
                if "to_date" in time_off_for_csv.columns:
                    time_off_for_csv["to_date"] = pd.to_datetime(
                        time_off_for_csv["to_date"], errors="coerce"
                    ).dt.strftime("%Y-%m-%d")
            time_off_for_csv.to_csv(temp_path / "time_off.csv", index=False)

            STANDARD_WORKING_SHIFTS = get_standard_working_shifts(db) | {"O"}
            locks_df = roster_data["locks"].copy()
            if not locks_df.empty and "shift" in locks_df.columns:
                locks_df = locks_df[locks_df["shift"].isin(STANDARD_WORKING_SHIFTS)]

            period_start = start_date
            prev_period_shifts = load_previous_period_last_days(period_start, db)

            if prev_period_shifts:
                first_day = period_start
                second_day = first_day + timedelta(days=1)
                prev_dates = sorted({d for _, d in prev_period_shifts.keys()})
                if len(prev_dates) >= 2:
                    second_last_date = prev_dates[-2]
                    last_date = prev_dates[-1]
                elif len(prev_dates) == 1:
                    second_last_date = None
                    last_date = prev_dates[0]
                else:
                    last_date = None
                    second_last_date = None

                rest_required = {}
                forbidden_shifts = {}
                for (emp, prev_date), shift in prev_period_shifts.items():
                    if shift == "N":
                        if second_last_date and prev_date == second_last_date:
                            rest_required[(emp, first_day)] = True
                        elif prev_date == last_date:
                            rest_required[(emp, first_day)] = True
                            rest_required[(emp, second_day)] = True
                            for s1, s2 in FORBIDDEN_ADJACENCY_PAIRS:
                                if s1 == "N":
                                    forbidden_shifts[(emp, first_day, s2)] = True
                    elif prev_date == last_date:
                        for s1, s2 in FORBIDDEN_ADJACENCY_PAIRS:
                            if s1 == shift:
                                forbidden_shifts[(emp, first_day, s2)] = True
                    if shift == "M4" and prev_date == last_date:
                        rest_required[(emp, first_day)] = True
                    elif shift == "A" and prev_date == last_date:
                        rest_required[(emp, first_day)] = True

                rest_locks = []
                for (emp, rest_day), _ in rest_required.items():
                    rest_locks.append(
                        {
                            "employee": emp,
                            "from_date": rest_day,
                            "to_date": rest_day,
                            "shift": "O",
                            "force": True,
                            "reason": "Adjacency constraint from previous period",
                        }
                    )
                forbidden_locks = []
                for (emp, forbid_day, forbid_shift), _ in forbidden_shifts.items():
                    forbidden_locks.append(
                        {
                            "employee": emp,
                            "from_date": forbid_day,
                            "to_date": forbid_day,
                            "shift": forbid_shift,
                            "force": False,
                            "reason": "Forbidden adjacency from previous period",
                        }
                    )
                all_new_locks = rest_locks + forbidden_locks
                if all_new_locks:
                    new_locks_df = pd.DataFrame(all_new_locks)
                    if locks_df.empty:
                        locks_df = new_locks_df
                    else:
                        existing_keys = set()
                        for _, row in locks_df.iterrows():
                            emp_name = row.get("employee")
                            from_date = (
                                pd.to_datetime(row.get("from_date", "")).date()
                                if pd.notna(row.get("from_date"))
                                else None
                            )
                            shift = row.get("shift")
                            if emp_name and from_date and shift:
                                existing_keys.add((emp_name, from_date, shift))
                        filtered_locks = []
                        for _, row in new_locks_df.iterrows():
                            emp_name = row.get("employee")
                            from_date = (
                                pd.to_datetime(row.get("from_date", "")).date()
                                if pd.notna(row.get("from_date"))
                                else None
                            )
                            shift = row.get("shift")
                            if emp_name and from_date and shift:
                                if (emp_name, from_date, shift) not in existing_keys:
                                    filtered_locks.append(row.to_dict())
                        if filtered_locks:
                            filtered_locks_df = pd.DataFrame(filtered_locks)
                            locks_df = pd.concat([locks_df, filtered_locks_df], ignore_index=True)

            if not locks_df.empty:
                if "from_date" in locks_df.columns:
                    locks_df["from_date"] = pd.to_datetime(
                        locks_df["from_date"], errors="coerce"
                    ).dt.strftime("%Y-%m-%d")
                if "to_date" in locks_df.columns:
                    locks_df["to_date"] = pd.to_datetime(
                        locks_df["to_date"], errors="coerce"
                    ).dt.strftime("%Y-%m-%d")
            locks_df.to_csv(temp_path / "locks.csv", index=False)

            print(f"\nLocks after prev-period adjacency merge (rows): {len(locks_df)}")

            all_leave_types = db.query(LeaveType).filter(LeaveType.is_active == True).all()  # noqa: E712
            leave_codes = [lt.code for lt in all_leave_types]
            rest_leave_types = [lt for lt in all_leave_types if lt.counts_as_rest is True]
            rest_codes = [lt.code for lt in rest_leave_types]

            all_shift_types = db.query(ShiftType).filter(ShiftType.is_active == True).all()  # noqa: E712
            STANDARD = get_standard_working_shifts(db)
            working_shift_codes = [
                st.code
                for st in all_shift_types
                if st.is_working_shift is True and st.code in STANDARD
            ]
            all_shift_codes = [
                st.code for st in all_shift_types if st.code in STANDARD or st.code == "O"
            ]
            non_standard_shift_codes = [
                st.code for st in all_shift_types if st.code not in STANDARD and st.code != "O"
            ]
            leave_codes_set = set(leave_codes)
            leave_codes_set.update(non_standard_shift_codes)
            leave_codes = list(leave_codes_set)

            config_data = {
                "weights": {
                    "unfilled_coverage": 1000.0,
                    "fairness": request.fairness_weight,
                    "rest_after_shift": 4000.0,
                    "do_after_n": 1.0,
                },
                "rest_codes": rest_codes,
                "leave_codes": leave_codes,
                "working_shift_codes": working_shift_codes,
                "all_shift_codes": all_shift_codes,
                "forbidden_adjacencies": [
                    ["N", "M"],
                    ["N", "IP"],
                    ["N", "M3"],
                    ["E", "M"],
                    ["E", "IP"],
                    ["E", "M3"],
                    ["N", "APP"],
                ],
                "weekly_rest_minimum": 1,
                "required_rest_after_shifts": [
                    {"shift": "N", "rest_days": 2, "rest_code": "O"},
                    {"shift": "M4", "rest_days": 1, "rest_code": "O"},
                    {"shift": "A", "rest_days": 1, "rest_code": "O"},
                ],
            }
            config_path = temp_path / "config.yaml"
            with open(config_path, "w") as f:
                yaml.dump(config_data, f)

            config = RosterConfig(config_path)
            data = RosterData(temp_path, config)
            data.load_data()

            ok, issues = check_roster_feasibility(data)
            err_lines = [x for x in issues if x.startswith("❌")]
            warn_lines = [x for x in issues if x.startswith("⚠️")]
            print("\n--- Sanity check (pre-solve) ---")
            if ok and not warn_lines:
                print("PASSED — no issues reported.")
            elif ok and warn_lines:
                print(f"PASSED (no blocking errors) — {len(warn_lines)} warning(s):")
                for i, w in enumerate(warn_lines, 1):
                    print(f"  {i}. {w}")
            else:
                print(f"FAILED — {len(err_lines)} error(s), {len(warn_lines)} warning(s):")
                for i, issue in enumerate(err_lines + warn_lines, 1):
                    print(f"  {i}. {issue}")

            print("\n--- CP-SAT solve (same model as app) ---")
            solver = RosterSolver(config)
            success, _assignments, metrics = solver.solve(data, time_limit_seconds=time_limit)
            print(f"success={success}  metrics={metrics}")

            if not success and metrics.get("sanity_check_failed"):
                print("\n(Failure is from sanity check; UI should list issues if job payload includes them.)")
            elif not success and metrics.get("status") == "INFEASIBLE":
                print(
                    "\nSanity passed but solver INFEASIBLE — typical causes: min_days_off + weekly rest + "
                    "coverage together; boundary locks from previous period; conflicting approved locks; "
                    "or time_limit too low (try higher time_limit)."
                )
    finally:
        db.close()


if __name__ == "__main__":
    main()
