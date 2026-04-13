/**
 * Build an iCalendar (.ics) file of all-day events for roster working shifts only.
 * Dates are calendar dates (YYYY-MM-DD) as stored in committed schedules (Oman operations).
 */

export interface RosterScheduleEntry {
  employee: string;
  date: string;
  shift: string;
}

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

function formatIcsDateOnly(ymd: string): string {
  const part = ymd.split('T')[0];
  return part.replace(/-/g, '');
}

function addOneCalendarDayYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const y2 = dt.getUTCFullYear();
  const m2 = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d2 = String(dt.getUTCDate()).padStart(2, '0');
  return `${y2}${m2}${d2}`;
}

function formatIcsDateTimeUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const H = String(d.getUTCHours()).padStart(2, '0');
  const M = String(d.getUTCMinutes()).padStart(2, '0');
  const S = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${mo}${day}T${H}${M}${S}Z`;
}

function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 0) {
    parts.push(rest.slice(0, 75));
    rest = ' ' + rest.slice(75);
  }
  return parts.join('\r\n');
}

/** UID suffix: random enough for single-user download. */
function newUid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}@pharmacy-duty-scheduler`;
}

export function buildMyWorkingShiftsIcs(params: {
  entries: RosterScheduleEntry[];
  employeeName: string;
  workingShiftCodes: Set<string>;
  leaveCodes: Set<string>;
  calendarTitle: string;
}): { ics: string; eventCount: number } {
  const { entries, employeeName, workingShiftCodes, leaveCodes, calendarTitle } = params;

  const byDate = new Map<string, string>();
  for (const e of entries) {
    if (e.employee !== employeeName) continue;
    const code = (e.shift || '').trim();
    if (!code) continue;
    if (leaveCodes.has(code)) continue;
    if (!workingShiftCodes.has(code)) continue;

    const dateStr = e.date.split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    if (!byDate.has(dateStr)) {
      byDate.set(dateStr, code);
    }
  }

  const sortedDates = Array.from(byDate.keys()).sort();
  const eventCount = sortedDates.length;
  const dtStamp = formatIcsDateTimeUtc(new Date());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PharmacyDutyScheduler//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:' + escapeIcsText(calendarTitle),
    'X-WR-TIMEZONE:Asia/Muscat',
  ];

  for (const dateStr of sortedDates) {
    const shift = byDate.get(dateStr)!;
    const start = formatIcsDateOnly(dateStr);
    const end = addOneCalendarDayYmd(dateStr);

    const summary = escapeIcsText(`Shift: ${shift}`);
    const desc = escapeIcsText(`Roster shift ${shift} (${employeeName})`);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${newUid()}`);
    lines.push(`DTSTAMP:${dtStamp}`);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
    lines.push(foldIcsLine(`SUMMARY:${summary}`));
    lines.push(foldIcsLine(`DESCRIPTION:${desc}`));
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return { ics: lines.join('\r\n'), eventCount };
}
