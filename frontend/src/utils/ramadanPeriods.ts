export type RamadanPeriodId = 'pre-ramadan' | 'ramadan' | 'post-ramadan';

export interface RamadanPeriodWindow {
  from: string;
  to: string;
  primaryMonth: number;
}

const DB_OVERRIDES: Record<number, { start: string; end: string; source?: string }> = {};

function parseIsoDate(dateIso: string): Date {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(dateIso: string, days: number): string {
  const dt = parseIsoDate(dateIso);
  dt.setDate(dt.getDate() + days);
  return toIsoDate(dt);
}

function firstDayOfMonth(dateIso: string): string {
  const dt = parseIsoDate(dateIso);
  return toIsoDate(new Date(dt.getFullYear(), dt.getMonth(), 1));
}

function lastDayOfMonth(dateIso: string): string {
  const dt = parseIsoDate(dateIso);
  return toIsoDate(new Date(dt.getFullYear(), dt.getMonth() + 1, 0));
}

export function getRamadanRange(year: number): { start: string; end: string } | null {
  const dbOverride = DB_OVERRIDES[year];
  if (dbOverride) {
    return { start: dbOverride.start, end: dbOverride.end };
  }
  return null;
}

export function setRamadanDateOverride(
  year: number,
  startDate: string,
  endDate: string,
  source?: string,
): void {
  DB_OVERRIDES[year] = { start: startDate, end: endDate, source };
}

export function clearRamadanDateOverride(year: number): void {
  delete DB_OVERRIDES[year];
}

export function hasRamadanDatesConfigured(year: number | undefined): boolean {
  if (!year) return false;
  return Boolean(DB_OVERRIDES[year]);
}

export function getRamadanPeriodWindows(year: number): Record<RamadanPeriodId, RamadanPeriodWindow> | null {
  const range = getRamadanRange(year);
  if (!range) return null;
  const { start, end } = range;
  const preTo = addDays(start, -1);
  const postFrom = addDays(end, 1);

  return {
    'pre-ramadan': {
      from: firstDayOfMonth(start),
      to: preTo,
      primaryMonth: parseIsoDate(start).getMonth() + 1,
    },
    ramadan: {
      from: start,
      to: end,
      primaryMonth: parseIsoDate(start).getMonth() + 1,
    },
    'post-ramadan': {
      from: postFrom,
      to: lastDayOfMonth(end),
      primaryMonth: parseIsoDate(end).getMonth() + 1,
    },
  };
}

export function getRamadanPeriodWindow(
  year: number | undefined,
  month: number | undefined,
  selectedPeriod: string | null | undefined,
): RamadanPeriodWindow | null {
  if (!year || !month || !selectedPeriod) return null;
  if (selectedPeriod !== 'pre-ramadan' && selectedPeriod !== 'ramadan' && selectedPeriod !== 'post-ramadan') {
    return null;
  }

  const windows = getRamadanPeriodWindows(year);
  if (!windows) return null;
  const window = windows[selectedPeriod];
  const fromMonth = parseIsoDate(window.from).getMonth() + 1;
  const toMonth = parseIsoDate(window.to).getMonth() + 1;
  if (month !== fromMonth && month !== toMonth && month !== window.primaryMonth) return null;
  return window;
}

export function isDateInWindow(dateIso: string, window: RamadanPeriodWindow): boolean {
  const parsed = dateIso.split('T')[0];
  return parsed >= window.from && parsed <= window.to;
}

