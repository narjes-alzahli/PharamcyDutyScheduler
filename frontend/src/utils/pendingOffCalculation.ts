/**
 * Pending off (matches roster/app/model/solver.py create_employee_report):
 *
 * pending_off = (
 *   weekend_days_in_scope_not_on_leave
 *   + (1 per N on normal weekday + 2 per N on Fri/Sat or holiday)
 *   + initial_pending_off
 * ) - (count of DO + non-holiday O shifts for that person in the period)
 */

export interface PendingOffData {
  employee: string;
  pending_off: number;
  /** Weighted N credit: +1 per weekday N, +2 per Fri/Sat N */
  night_shifts: number;
  /** Fri+Sat days in scope, excluding leave weekends for that employee */
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

const WORKING_SHIFTS = new Set(['M', 'IP', 'A', 'N', 'M3', 'M4', 'H', 'CL']);
const REST_SHIFTS = new Set(['O']);
const OFF_DEDUCTION_SHIFTS = new Set(['O', 'DO']);

function isLeaveShift(shift: string): boolean {
  const normalized = (shift || '').trim();
  if (!normalized) return false;
  if (WORKING_SHIFTS.has(normalized)) return false;
  if (REST_SHIFTS.has(normalized)) return false;
  return true;
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

  const uniqueWeekendDays = (() => {
    const window = pendingWindow ?? null;
    if (window) {
      const days: string[] = [];
      const start = new Date(window.from);
      const end = new Date(window.to);
      for (
        let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        d <= end;
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
      ) {
        const dayOfWeek = d.getDay();
        if (dayOfWeek === 5 || dayOfWeek === 6) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          days.push(`${y}-${m}-${day}`);
        }
      }
      return days;
    }

    const all = Array.from(new Set(schedule.map((e) => e.date.split('T')[0]))).sort();
    if (all.length === 0) return [] as string[];
    const start = year !== undefined && month !== undefined ? `${year}-${String(month).padStart(2, '0')}-01` : all[0];
    const end =
      year !== undefined && month !== undefined
        ? `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
        : all[all.length - 1];
    const days: string[] = [];
    const s = new Date(start);
    const e = new Date(end);
    for (
      let d = new Date(s.getFullYear(), s.getMonth(), s.getDate());
      d <= e;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    ) {
      const dayOfWeek = d.getDay();
      if (dayOfWeek === 5 || dayOfWeek === 6) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        days.push(`${y}-${m}-${day}`);
      }
    }
    return days;
  })();

  const employeeShiftByDate: Record<string, Record<string, string>> = {};

  schedule.forEach((entry) => {
    const { employee, date: dateStr, shift } = entry;

    if (!employeeData[employee]) {
      employeeData[employee] = {
        night_shifts: 0,
        Os_given: 0,
        total_working_days: 0,
      };
    }
    if (!employeeShiftByDate[employee]) employeeShiftByDate[employee] = {};

    const empData = employeeData[employee];

    const dateKey = dateStr.split('T')[0];
    employeeShiftByDate[employee][dateKey] = shift;
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
    const isHoliday = Boolean(holidays[dateKey]);

    if (WORKING_SHIFTS.has(shift)) {
      empData.total_working_days += 1;

      if (shift === 'N') {
        empData.night_shifts += (isWeekend || isHoliday) ? 2 : 1;
      }
    }

    // Holiday O should not reduce pending off (treated like PH behavior).
    const isDeductibleOff = shift === 'DO' || (shift === 'O' && !isHoliday);
    if (OFF_DEDUCTION_SHIFTS.has(shift) && isDeductibleOff) {
      empData.Os_given += 1;
    }
  });

  const result: PendingOffData[] = Object.keys(employeeData).map((employee) => {
    const data = employeeData[employee];
    const initial = initialPendingOff[employee] || 0;
    const shiftByDate = employeeShiftByDate[employee] || {};
    const weekendDaysForEmployee = uniqueWeekendDays.reduce((acc, dateKey) => {
      const shift = shiftByDate[dateKey];
      return isLeaveShift(shift) ? acc : acc + 1;
    }, 0);

    const pending_off = weekendDaysForEmployee + data.night_shifts + initial - data.Os_given;

    return {
      employee,
      pending_off: Math.round(pending_off),
      night_shifts: data.night_shifts,
      weekend_days_in_month: weekendDaysForEmployee,
      Os_given: data.Os_given,
      total_working_days: data.total_working_days,
    };
  });

  return result;
};
