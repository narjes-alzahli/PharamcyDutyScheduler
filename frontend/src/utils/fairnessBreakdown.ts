/**
 * Requested vs assigned breakdown for fairness charts.
 * "Requested" = shift requests (non-rejected) + roster locks, counting only days that fall
 * in relevantDates and match the fairness metric's shift families.
 */

export type FairnessMetricKey =
  | 'night'
  | 'afternoon'
  | 'm4'
  | 'ipCombined'
  | 'mainCombined'
  | 'e'
  | 'weekend'
  | 'thursday'
  | 'working';

const NIGHT = new Set(['N']);
const AFTERNOON = new Set(['A']);
const M4 = new Set(['M4']);
const IP_COMBINED = new Set(['IP', 'IP+P']);
const MAIN_COMBINED = new Set(['M', 'M3', 'M+P']);
const E_SHIFT = new Set(['E']);
const WEEKEND_FAIRNESS = new Set(['A', 'M3', 'N', 'E']);
const THURSDAY_FAIRNESS = new Set(['A', 'M4', 'N', 'E']);
const WORKING_SHIFTS = new Set([
  'M', 'IP', 'A', 'N', 'M3', 'M4', 'H', 'CL', 'E', 'MS', 'IP+P', 'P', 'M+P',
]);

function parseYmd(s: string): { y: number; m: number; d: number } {
  const part = s.split('T')[0];
  const [y, m, d] = part.split('-').map(Number);
  return { y, m, d };
}

function ymdToDate(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d);
}

/** Inclusive list of YYYY-MM-DD between from and to. */
export function expandDateRangeInclusive(fromStr: string, toStr: string): string[] {
  const a = parseYmd(fromStr);
  const b = parseYmd(toStr);
  let cur = ymdToDate(a.y, a.m, a.d);
  const end = ymdToDate(b.y, b.m, b.d);
  const out: string[] = [];
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
  }
  return out;
}

function dayOfWeekSun0(dateStr: string): number {
  const { y, m, d } = parseYmd(dateStr);
  return ymdToDate(y, m, d).getDay();
}

function shiftMatchesMetric(metric: FairnessMetricKey, shift: string): boolean {
  const sh = (shift || '').trim();
  if (!sh) return false;
  switch (metric) {
    case 'night':
      return NIGHT.has(sh);
    case 'afternoon':
      return AFTERNOON.has(sh);
    case 'm4':
      return M4.has(sh);
    case 'ipCombined':
      return IP_COMBINED.has(sh);
    case 'mainCombined':
      return MAIN_COMBINED.has(sh);
    case 'e':
      return E_SHIFT.has(sh);
    case 'working':
      return WORKING_SHIFTS.has(sh);
    case 'weekend':
      return WEEKEND_FAIRNESS.has(sh);
    case 'thursday':
      return THURSDAY_FAIRNESS.has(sh);
    default:
      return false;
  }
}

/** Weekend = Fri/Sat (5,6) — matches fairnessMetrics.isWeekend */
function isWeekendYmd(dateStr: string): boolean {
  const dow = dayOfWeekSun0(dateStr);
  return dow === 5 || dow === 6;
}

function isThursdayYmd(dateStr: string): boolean {
  return dayOfWeekSun0(dateStr) === 4;
}

function dayMatchesMetricDayRules(metric: FairnessMetricKey, dateStr: string): boolean {
  if (metric === 'weekend') return isWeekendYmd(dateStr);
  if (metric === 'thursday') return isThursdayYmd(dateStr);
  return true;
}

function requestIsActive(status: string | undefined): boolean {
  const s = (status || '').toLowerCase();
  return s !== 'rejected';
}

export interface ShiftRequestLike {
  employee?: string;
  from_date?: string;
  to_date?: string;
  shift?: string;
  status?: string;
}

export interface LockLike {
  employee?: string;
  from_date?: string;
  to_date?: string;
  shift?: string;
  force?: boolean;
}

/**
 * Count requested days for one employee and metric: shift requests + locks, restricted to relevantDates.
 */
export function countRequestedDaysForMetric(
  employee: string,
  metric: FairnessMetricKey,
  shiftRequests: ShiftRequestLike[] | undefined,
  rosterLocks: LockLike[] | undefined,
  relevantDates: Set<string>,
): number {
  const days = new Set<string>();

  const tryAddDay = (dateStr: string, shift: string | undefined) => {
    const key = dateStr.split('T')[0];
    if (!relevantDates.has(key)) return;
    if (!shiftMatchesMetric(metric, shift || '')) return;
    if (!dayMatchesMetricDayRules(metric, key)) return;
    days.add(key);
  };

  if (shiftRequests) {
    for (const req of shiftRequests) {
      const emp = req.employee || '';
      if (emp !== employee) continue;
      if (!requestIsActive(req.status)) continue;
      const from = req.from_date || '';
      const to = req.to_date || from;
      const shift = req.shift || '';
      if (!from) continue;
      for (const day of expandDateRangeInclusive(from, to)) {
        tryAddDay(day, shift);
      }
    }
  }

  if (rosterLocks) {
    for (const lock of rosterLocks) {
      const emp = lock.employee || '';
      if (emp !== employee) continue;
      const from = lock.from_date || '';
      const to = lock.to_date || from;
      const shift = lock.shift || '';
      if (!from) continue;
      for (const day of expandDateRangeInclusive(from, to)) {
        tryAddDay(day, shift);
      }
    }
  }

  return days.size;
}
