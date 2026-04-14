/**
 * Pending off (matches roster/app/model/solver.py create_employee_report):
 *
 * pending_off = (
 *   weekend_days_in_scope
 *   + (1 per N on weekday + 2 per N on Fri/Sat)
 *   + initial_pending_off
 * ) - (count of O shifts for that person in the period)
 */

export interface PendingOffData {
  employee: string;
  pending_off: number;
  /** Weighted N credit: +1 per weekday N, +2 per Fri/Sat N */
  night_shifts: number;
  /** Fri+Sat days in the pending scope (full month, partial window, or fallback range) */
  weekend_days_in_month: number;
  Os_given: number;
  total_working_days: number;
}

export interface HolidayMap {
  [dateStr: string]: string | undefined;
}

/** Count Fridays and Saturdays between two YYYY-MM-DD strings (inclusive). */
export function countFridaySaturdayBetween(minIso: string, maxIso: string): number {
  const parse = (s: string) => {
    const p = s.split('T')[0].split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  };
  let d = parse(minIso);
  const end = parse(maxIso);
  let n = 0;
  while (d <= end) {
    const dow = d.getDay();
    if (dow === 5 || dow === 6) n++;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  return n;
}

function countFridaySaturdayInCalendarMonth(year: number, month: number): number {
  const last = new Date(year, month, 0).getDate();
  let n = 0;
  for (let day = 1; day <= last; day++) {
    const dow = new Date(year, month - 1, day).getDay();
    if (dow === 5 || dow === 6) n++;
  }
  return n;
}

/**
 * Partial-month windows (2026 Ramadan split) — same bounds as ScheduleTable date columns.
 * When non-null, Fri/Sat counts and pending_off use only days in [from, to] inclusive.
 */
export function getPendingOffWindow(
  year: number | undefined,
  month: number | undefined,
  selectedPeriod: string | null | undefined,
): { from: string; to: string } | null {
  if (year !== 2026 || month === undefined || !selectedPeriod) return null;
  if (selectedPeriod === 'pre-ramadan' && month === 2) {
    return { from: '2026-02-01', to: '2026-02-18' };
  }
  if (selectedPeriod === 'ramadan' && (month === 2 || month === 3)) {
    return { from: '2026-02-19', to: '2026-03-18' };
  }
  if (selectedPeriod === 'post-ramadan' && month === 3) {
    return { from: '2026-03-19', to: '2026-03-31' };
  }
  return null;
}

export function filterEntriesToPendingWindow<T extends { date: string }>(
  entries: T[],
  year: number | undefined,
  month: number | undefined,
  selectedPeriod: string | null | undefined,
): T[] {
  const win = getPendingOffWindow(year, month, selectedPeriod);
  if (!win) {
    if (year === undefined || month === undefined) return entries;
    return entries.filter((e) => {
      const d = new Date(e.date);
      return !Number.isNaN(d.getTime()) && d.getFullYear() === year && d.getMonth() + 1 === month;
    });
  }
  return entries.filter((e) => {
    const key = e.date.split('T')[0];
    return key >= win.from && key <= win.to;
  });
}

/**
 * Fri/Sat days in scope: optional partial window, else full calendar month, else min–max in schedule.
 */
function weekendDaysInScope(
  schedule: Array<{ date: string }>,
  year: number | undefined,
  month: number | undefined,
  window: { from: string; to: string } | null | undefined,
): number {
  if (window) {
    return countFridaySaturdayBetween(window.from, window.to);
  }
  if (year !== undefined && month !== undefined) {
    return countFridaySaturdayInCalendarMonth(year, month);
  }
  const all = Array.from(new Set(schedule.map((e) => e.date.split('T')[0]))).sort();
  if (all.length === 0) return 0;
  return countFridaySaturdayBetween(all[0], all[all.length - 1]);
}

export const calculatePendingOff = (
  schedule: Array<{ employee: string; date: string; shift: string }>,
  initialPendingOff: Record<string, number> = {},
  holidays: HolidayMap = {},
  year?: number,
  month?: number,
  /** When set (e.g. Ramadan slice), only Fri/Sat inside [from,to] count toward the weekend term. */
  pendingWindow?: { from: string; to: string } | null,
): PendingOffData[] => {
  void holidays; // reserved for parity with older callers; N weighting uses Fri/Sat only
  const wkndDays = weekendDaysInScope(schedule, year, month, pendingWindow);

  const employeeData: Record<
    string,
    {
      night_shifts: number;
      Os_given: number;
      total_working_days: number;
    }
  > = {};

  Object.keys(initialPendingOff).forEach((emp) => {
    if (!employeeData[emp]) {
      employeeData[emp] = {
        night_shifts: 0,
        Os_given: 0,
        total_working_days: 0,
      };
    }
  });

  schedule.forEach((entry) => {
    const { employee, date: dateStr, shift } = entry;

    if (!employeeData[employee]) {
      employeeData[employee] = {
        night_shifts: 0,
        Os_given: 0,
        total_working_days: 0,
      };
    }

    const empData = employeeData[employee];

    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;

    const workingShifts = ['M', 'IP', 'A', 'N', 'M3', 'M4', 'H', 'CL'];
    if (workingShifts.includes(shift)) {
      empData.total_working_days += 1;

      if (shift === 'N') {
        empData.night_shifts += isWeekend ? 2 : 1;
      }
    }

    if (shift === 'O') {
      empData.Os_given += 1;
    }
  });

  const result: PendingOffData[] = Object.keys(employeeData).map((employee) => {
    const data = employeeData[employee];
    const initial = initialPendingOff[employee] || 0;

    const pending_off = wkndDays + data.night_shifts + initial - data.Os_given;

    return {
      employee,
      pending_off: Math.round(pending_off),
      night_shifts: data.night_shifts,
      weekend_days_in_month: wkndDays,
      Os_given: data.Os_given,
      total_working_days: data.total_working_days,
    };
  });

  return result;
};
