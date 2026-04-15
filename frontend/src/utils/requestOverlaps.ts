import { parseDateToISO } from './dateFormat';

/** Normalize API date to YYYY-MM-DD for comparisons */
export const normalizeRequestYmd = (d: string): string =>
  parseDateToISO(d.split('T')[0]) || d.split('T')[0];

/** Inclusive calendar overlap on YYYY-MM-DD strings */
export const dateRangesOverlapYmd = (
  aFrom: string,
  aTo: string,
  bFrom: string,
  bTo: string
): boolean => {
  const a0 = normalizeRequestYmd(aFrom);
  const a1 = normalizeRequestYmd(aTo);
  const b0 = normalizeRequestYmd(bFrom);
  const b1 = normalizeRequestYmd(bTo);
  return a0 <= b1 && a1 >= b0;
};

export type OverlapRecord = {
  request_id: string;
  type: 'leave' | 'shift';
  /** Staff name */
  employee: string;
  /** Leave type code or shift code (e.g. DO, M4) */
  code: string;
  from_ymd: string;
  to_ymd: string;
  status: string;
  /** One-line for logs / simple UI */
  summary: string;
};

type MinimalLeave = {
  request_id: string;
  employee: string;
  from_date: string;
  to_date: string;
  status: string;
  leave_type?: string;
};

type MinimalShift = {
  request_id: string;
  employee: string;
  from_date: string;
  to_date: string;
  status: string;
  shift?: string;
};

/** Other pending/approved leave/shift for same employee whose dates overlap (excludes rejected; excludes the request being approved). */
export const collectOverlappingPendingOrApproved = (
  employee: string,
  excludeRequestId: string,
  excludeType: 'leave' | 'shift',
  fromDate: string,
  toDate: string,
  leaves: MinimalLeave[],
  shifts: MinimalShift[]
): OverlapRecord[] => {
  const out: OverlapRecord[] = [];

  for (const r of leaves) {
    if (r.employee !== employee) continue;
    if (r.request_id === excludeRequestId && excludeType === 'leave') continue;
    if (r.status === 'Rejected') continue;
    if (!dateRangesOverlapYmd(fromDate, toDate, r.from_date, r.to_date)) continue;
    const fromY = normalizeRequestYmd(r.from_date);
    const toY = normalizeRequestYmd(r.to_date);
    const code = r.leave_type || '?';
    out.push({
      request_id: r.request_id,
      type: 'leave',
      employee: r.employee,
      code,
      from_ymd: fromY,
      to_ymd: toY,
      status: r.status,
      summary: `${r.employee} · Leave ${code} · ${fromY} → ${toY} · ${r.status} (${r.request_id})`,
    });
  }

  for (const r of shifts) {
    if (r.employee !== employee) continue;
    if (r.request_id === excludeRequestId && excludeType === 'shift') continue;
    if (r.status === 'Rejected') continue;
    if (!dateRangesOverlapYmd(fromDate, toDate, r.from_date, r.to_date)) continue;
    const fromY = normalizeRequestYmd(r.from_date);
    const toY = normalizeRequestYmd(r.to_date);
    const code = r.shift || '?';
    out.push({
      request_id: r.request_id,
      type: 'shift',
      employee: r.employee,
      code,
      from_ymd: fromY,
      to_ymd: toY,
      status: r.status,
      summary: `${r.employee} · Shift ${code} · ${fromY} → ${toY} · ${r.status} (${r.request_id})`,
    });
  }

  return out;
};
