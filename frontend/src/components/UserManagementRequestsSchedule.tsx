import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  parseDateToISO,
  enumerateLocalDatesInclusive,
  parseYMDToLocalDate,
} from '../utils/dateFormat';

// Weekend color key (same as ScheduleTable uses)
const SPECIAL_COLOR_KEYS = {
  weekend: '__weekend',
} as const;

// Default weekend color (same as ScheduleTable)
const defaultWeekendColor = '#5f8ace'; // Medium Blue - Weekend

interface Request {
  request_id: string;
  employee: string;
  from_date: string;
  to_date: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  leave_type?: string;
  shift?: string;
  force?: boolean;
  reason?: string;
  submitted_at: string;
}

type CellRequest = Request & { type: 'leave' | 'shift'; code: string };

const statusPriority = (status: Request['status']): number =>
  status === 'Pending' ? 0 : status === 'Approved' ? 1 : 2;

/** Sort requests for one cell: pending/approved before rejected, then newest first. */
const sortRequestsForCell = (a: CellRequest, b: CellRequest): number => {
  const pa = statusPriority(a.status);
  const pb = statusPriority(b.status);
  if (pa !== pb) return pa - pb;
  const ta = new Date(a.submitted_at).getTime();
  const tb = new Date(b.submitted_at).getTime();
  return tb - ta;
};

/** Tooltip line: submission date/time only. */
const formatRequestHoverTip = (req: CellRequest): string[] => {
  const d = new Date(req.submitted_at);
  const submitted =
    Number.isNaN(d.getTime()) || !req.submitted_at
      ? '—'
      : `${d.toLocaleDateString('en-GB')}, ${d.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })}`;
  return [`Submitted: ${submitted}`];
};

type RangeMeta = { fromDate: string; toDate: string; employee: string };

/**
 * For each employee + visible date: either null (single-row cell) or ordered request_ids for aligned
 * multi-row cells. Components are built from same-day overlaps, expanded along the date grid when some
 * overlapping request spans both adjacent days (so trailing single-request days stay band-aligned).
 */
const buildOverlapSlotLayout = (
  employees: string[],
  dates: string[],
  requestMap: Map<string, CellRequest[]>,
  requestRanges: Map<string, RangeMeta>
): Map<string, Map<string, string[] | null>> => {
  const out = new Map<string, Map<string, string[] | null>>();

  for (const employee of employees) {
    const perDate = new Map<string, string[] | null>();
    for (const d of dates) perDate.set(d, null);
    out.set(employee, perDate);

    const overlapDays: string[] = [];
    for (const d of dates) {
      const list = requestMap.get(`${employee}_${d}`);
      if (list && list.length > 1) overlapDays.push(d);
    }
    if (overlapDays.length === 0) continue;

    const requestsOnOverlap = new Set<string>();
    for (const d of overlapDays) {
      for (const r of requestMap.get(`${employee}_${d}`)!) {
        requestsOnOverlap.add(r.request_id);
      }
    }

    const rangeById = new Map<string, { from: string; to: string }>();
    for (const id of Array.from(requestsOnOverlap)) {
      const meta = requestRanges.get(id);
      if (!meta || meta.employee !== employee) continue;
      const from = parseDateToISO(meta.fromDate) || meta.fromDate.split('T')[0];
      const to = parseDateToISO(meta.toDate) || meta.toDate.split('T')[0];
      rangeById.set(id, { from, to });
    }

    const spanCoversBoth = (rid: string, d: string, n: string): boolean => {
      const rg = rangeById.get(rid);
      if (!rg) return false;
      const set = new Set(enumerateLocalDatesInclusive(rg.from, rg.to));
      return set.has(d) && set.has(n);
    };

    const unvisited = new Set(overlapDays);
    while (unvisited.size > 0) {
      const seed = unvisited.values().next().value as string;
      const component = new Set<string>();
      const q: string[] = [seed];
      while (q.length > 0) {
        const d = q.pop()!;
        if (component.has(d)) continue;
        component.add(d);
        unvisited.delete(d);
        const idx = dates.indexOf(d);
        if (idx < 0) continue;
        for (const ni of [idx - 1, idx + 1]) {
          if (ni < 0 || ni >= dates.length) continue;
          const n = dates[ni];
          if (component.has(n)) continue;
          let bridged = false;
          for (const rid of Array.from(requestsOnOverlap)) {
            if (spanCoversBoth(rid, d, n)) {
              bridged = true;
              break;
            }
          }
          if (bridged) q.push(n);
        }
      }

      const slotIds = new Set<string>();
      for (const d of Array.from(component)) {
        const list = requestMap.get(`${employee}_${d}`);
        if (list) for (const r of list) slotIds.add(r.request_id);
      }
      for (const rid of Array.from(requestsOnOverlap)) {
        const rg = rangeById.get(rid);
        if (!rg) continue;
        const spanSet = new Set(enumerateLocalDatesInclusive(rg.from, rg.to));
        for (const d of Array.from(component)) {
          if (spanSet.has(d)) {
            slotIds.add(rid);
            break;
          }
        }
      }

      const byId = new Map<string, CellRequest>();
      for (const d of dates) {
        const list = requestMap.get(`${employee}_${d}`);
        if (!list) continue;
        for (const r of list) {
          if (slotIds.has(r.request_id)) byId.set(r.request_id, r);
        }
      }
      const slotOrder = Array.from(slotIds).filter((id) => byId.has(id)).sort((a, b) =>
        sortRequestsForCell(byId.get(a)!, byId.get(b)!)
      );
      if (slotOrder.length <= 1) continue;

      for (const d of Array.from(component)) {
        perDate.set(d, slotOrder);
      }
    }
  }

  return out;
};

interface UserManagementRequestsScheduleProps {
  year: number;
  month: number;
  leaveRequests: Request[];
  shiftRequests: Request[];
  selectedRequestId: string | null;
  onSelectRequest: (requestId: string | null) => void;
  onApprove: (requestId: string, type: 'leave' | 'shift') => void;
  onReject: (requestId: string, type: 'leave' | 'shift') => void;
  processingRequestId: string | null;
  allEmployees?: string[]; // Optional: if provided, show all employees even if they have no requests
  selectedPeriod?: string | null; // 'pre-ramadan', 'ramadan', 'post-ramadan', or null
}

export const UserManagementRequestsSchedule: React.FC<UserManagementRequestsScheduleProps> = ({
  year,
  month,
  leaveRequests,
  shiftRequests,
  selectedRequestId,
  onSelectRequest,
  onApprove,
  onReject,
  processingRequestId,
  allEmployees,
  selectedPeriod,
}) => {
  const [hoveredRequestId, setHoveredRequestId] = useState<string | null>(null);
  const [hoverTip, setHoverTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number; side: 'left' | 'right' } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);

  // Get date range based on selected period
  const getPeriodDateRange = () => {
    if (year === 2026 && (month === 2 || month === 3) && selectedPeriod) {
      if (selectedPeriod === 'pre-ramadan') {
        return { start: new Date('2026-02-01'), end: new Date('2026-02-18') };
      } else if (selectedPeriod === 'ramadan') {
        return { start: new Date('2026-02-19'), end: new Date('2026-03-18') };
      } else if (selectedPeriod === 'post-ramadan') {
        return { start: new Date('2026-03-19'), end: new Date('2026-03-31') };
      }
    }
    return null;
  };

  // Get all dates in the month (or period)
  const dates = useMemo(() => {
    const dateRange = getPeriodDateRange();
    
    if (dateRange) {
      // Filter by date range
      const dates: string[] = [];
      let currentDate = new Date(dateRange.start);
      while (currentDate <= dateRange.end) {
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        dates.push(`${year}-${month}-${day}`);
        currentDate.setDate(currentDate.getDate() + 1);
      }
      return dates;
    }
    
    // Default: all dates in the month
    const daysInMonth = new Date(year, month, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const monthStr = String(month).padStart(2, '0');
      const dayStr = String(day).padStart(2, '0');
      return `${year}-${monthStr}-${dayStr}`;
    });
  }, [year, month, selectedPeriod]);

  // Get all unique employees - use allEmployees if provided, otherwise only show employees with requests
  // Preserve order from EmployeeSkills (by ID) - same as schedule order
  const employees = useMemo(() => {
    if (allEmployees && allEmployees.length > 0) {
      // Show all employees if provided - preserve order (already ordered by EmployeeSkills.id from backend)
      return [...allEmployees];
    }
    // Otherwise, only show employees who have requests
    // Try to preserve EmployeeSkills order if allEmployees is available for reference
    const empSet = new Set<string>();
    leaveRequests.forEach(req => empSet.add(req.employee));
    shiftRequests.forEach(req => empSet.add(req.employee));
    const employeesWithRequests = Array.from(empSet);
    
    // If we have allEmployees, use it to order the employees with requests
    if (allEmployees && allEmployees.length > 0) {
      const ordered = allEmployees.filter(emp => employeesWithRequests.includes(emp));
      // Add any employees with requests that aren't in allEmployees (shouldn't happen, but just in case)
      const unordered = employeesWithRequests.filter(emp => !allEmployees.includes(emp));
      return [...ordered, ...unordered];
    }
    
    // Fallback: alphabetical sort if no allEmployees reference
    return employeesWithRequests.sort();
  }, [leaveRequests, shiftRequests, allEmployees]);

  // All requests touching each employee+date (stacked); primary = first after sort (pending/approved before rejected, newest first)
  const requestMap = useMemo(() => {
    const map = new Map<string, CellRequest[]>();

    const append = (key: string, item: CellRequest) => {
      const arr = map.get(key);
      if (arr?.some((r) => r.request_id === item.request_id)) return;
      if (arr) arr.push(item);
      else map.set(key, [item]);
    };

    leaveRequests.forEach((req) => {
      const fromDate = parseDateToISO(req.from_date);
      const toDate = parseDateToISO(req.to_date);
      if (!fromDate || !toDate) return;

      for (const dateStr of enumerateLocalDatesInclusive(fromDate, toDate)) {
        const key = `${req.employee}_${dateStr}`;
        append(key, {
          ...req,
          type: 'leave',
          code: req.leave_type || '',
        });
      }
    });

    shiftRequests.forEach((req) => {
      const fromDate = parseDateToISO(req.from_date);
      const toDate = parseDateToISO(req.to_date);
      if (!fromDate || !toDate) return;

      for (const dateStr of enumerateLocalDatesInclusive(fromDate, toDate)) {
        const key = `${req.employee}_${dateStr}`;
        append(key, {
          ...req,
          type: 'shift',
          code: req.shift || '',
        });
      }
    });

    map.forEach((arr) => arr.sort(sortRequestsForCell));

    return map;
  }, [leaveRequests, shiftRequests]);

  // Get request ranges for highlighting
  const requestRanges = useMemo(() => {
    const ranges: Map<string, { requestId: string; fromDate: string; toDate: string; employee: string }> = new Map();
    
    [...leaveRequests, ...shiftRequests].forEach(req => {
      ranges.set(req.request_id, {
        requestId: req.request_id,
        fromDate: parseDateToISO(req.from_date) || req.from_date,
        toDate: parseDateToISO(req.to_date) || req.to_date,
        employee: req.employee,
      });
    });
    
    return ranges;
  }, [leaveRequests, shiftRequests]);

  const overlapSlotLayout = useMemo(
    () => buildOverlapSlotLayout(employees, dates, requestMap, requestRanges),
    [employees, dates, requestMap, requestRanges]
  );

  // Get status color
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'Approved':
        return '#4ADE80'; // green-400
      case 'Rejected':
        return '#FCA5A5'; // red-300
      default:
        return '#FEF08A'; // yellow-300
    }
  };

  const getDayOfWeek = (dateStr: string) => {
    const date = parseYMDToLocalDate(dateStr);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()];
  };

  const isFriday = (dateStr: string) => {
    return getDayOfWeek(dateStr) === 'Fri';
  };

  const isSaturday = (dateStr: string) => {
    return getDayOfWeek(dateStr) === 'Sat';
  };

  const isWeekend = (dateStr: string) => {
    return isFriday(dateStr) || isSaturday(dateStr);
  };

  // Load weekend color from localStorage (same as ScheduleTable)
  const getWeekendColor = (): string => {
    try {
      const saved = localStorage.getItem('shiftColors');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed[SPECIAL_COLOR_KEYS.weekend]) {
          return parsed[SPECIAL_COLOR_KEYS.weekend];
        }
      }
    } catch (e) {
      console.error('Failed to load weekend color:', e);
    }
    return defaultWeekendColor;
  };

  // Get weekend color (memoized to avoid recalculation)
  const weekendColor = useMemo(() => getWeekendColor(), []);

  const formatDate = (dateStr: string) => {
    return parseYMDToLocalDate(dateStr).getDate().toString();
  };

  const handleCellClick = (
    employee: string,
    date: string,
    e: React.MouseEvent,
    explicitRequestId?: string
  ) => {
    const key = `${employee}_${date}`;
    const requests = requestMap.get(key);
    const request = explicitRequestId
      ? requests?.find((r) => r.request_id === explicitRequestId)
      : requests?.[0];

    if (request) {
      const isSelected = selectedRequestId === request.request_id;
      const newSelectedId = isSelected ? null : request.request_id;
      onSelectRequest(newSelectedId);
      setHoveredRequestId(newSelectedId);
      setHoverTip(null);

      if (newSelectedId) {
        // Calculate popup position using the clicked cell
        const cellRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const viewportCenter = window.innerWidth / 2;
        const cellCenter = cellRect.left + cellRect.width / 2;

        let side: 'left' | 'right' = cellCenter < viewportCenter ? 'right' : 'left';

        // Adjust for far right cells to prevent overflow
        if (cellRect.right > window.innerWidth - 200) {
          side = 'left';
        }

        // For multi-day ranges, try to position near the edge
        const range = requestRanges.get(newSelectedId);
        if (range) {
          const rangeDates = getRequestRangeDates(newSelectedId);
          const dateIndex = rangeDates.indexOf(date);
          const totalDates = rangeDates.length;
          // If clicked near the start, position on right; if near end, position on left
          if (dateIndex < totalDates / 3) {
            side = 'right';
          } else if (dateIndex > (totalDates * 2) / 3) {
            side = 'left';
          }
        }

        const x = side === 'right' ? cellRect.right : cellRect.left;
        const y = cellRect.top;

        setPopupPosition({ x, y, side });
      } else {
        setPopupPosition(null);
      }
    } else {
      onSelectRequest(null);
      setPopupPosition(null);
      setHoveredRequestId(null);
      setHoverTip(null);
    }
  };

  const handleCellHover = (employee: string, date: string, requestId?: string) => {
    if (selectedRequestId) return;
    const key = `${employee}_${date}`;
    const requests = requestMap.get(key);
    const slotOrder = overlapSlotLayout.get(employee)?.get(date) ?? null;
    const multiRowHere = slotOrder != null && slotOrder.length > 1;
    if (multiRowHere && !requestId) return;
    const request = requestId
      ? requests?.find((r) => r.request_id === requestId)
      : requests?.[0];
    if (request) {
      setHoveredRequestId(request.request_id);
    }
  };

  const handleCellLeave = () => {
    if (selectedRequestId) return;
    setHoveredRequestId(null);
    setHoverTip(null);
  };

  // Check if a date is part of a hovered request range
  const isInHoveredRange = (employee: string, date: string): boolean => {
    if (!hoveredRequestId) return false;
    const range = requestRanges.get(hoveredRequestId);
    if (!range || range.employee !== employee) return false;
    const rangeDates = getRequestRangeDates(hoveredRequestId);
    return rangeDates.includes(date);
  };

  // Check if a date is part of a selected request range
  const isInSelectedRange = (employee: string, date: string): boolean => {
    if (!selectedRequestId) return false;
    const range = requestRanges.get(selectedRequestId);
    if (!range || range.employee !== employee) return false;
    const rangeDates = getRequestRangeDates(selectedRequestId);
    return rangeDates.includes(date);
  };

  // Get all dates in a request range (local calendar, matches grid columns)
  const getRequestRangeDates = (requestId: string): string[] => {
    const range = requestRanges.get(requestId);
    if (!range) return [];
    const from = parseDateToISO(range.fromDate) || range.fromDate;
    const to = parseDateToISO(range.toDate) || range.toDate;
    return enumerateLocalDatesInclusive(from, to);
  };

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        if (!(event.target as HTMLElement).closest('td')) {
          onSelectRequest(null);
          setPopupPosition(null);
          setHoveredRequestId(null);
          setHoverTip(null);
        }
      }
    };
    
    if (selectedRequestId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [selectedRequestId, onSelectRequest]);

  return (
    <div className="space-y-4">
      {hoverTip && (
        <div
          className="pointer-events-none fixed z-[60] max-w-[220px] rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-left text-[9px] font-medium leading-snug text-white shadow-lg"
          style={{ left: hoverTip.x, top: hoverTip.y }}
        >
          {hoverTip.lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
      <div ref={scheduleRef} className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <table className="min-w-full border-2 border-black text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-black px-1 py-1 text-left font-bold sticky left-0 bg-gray-100 z-10 text-[10px]">
                  Staff
                </th>
                {dates.map(dateStr => {
                  const weekend = isWeekend(dateStr);
                  
                  return (
                    <th
                      key={dateStr}
                      className="border border-black px-0.5 py-0.5 text-center font-semibold min-w-[28px]"
                      title={`${getDayOfWeek(dateStr)} ${formatDate(dateStr)}`}
                      style={weekend ? { backgroundColor: weekendColor } : undefined}
                    >
                      <div className="text-[10px] leading-tight">{formatDate(dateStr)}</div>
                      <div className="text-[10px] text-gray-500 leading-tight">{getDayOfWeek(dateStr)}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {employees.map(employee => (
                <tr key={employee}>
                  <td className="border border-black px-1 py-1 font-semibold sticky left-0 bg-white z-10 text-[10px]">
                    {employee}
                  </td>
                  {dates.map(dateStr => {
                    const key = `${employee}_${dateStr}`;
                    const cellRequests = requestMap.get(key);
                    const list = cellRequests ?? [];
                    const primary = list[0];
                    const colorSource =
                      selectedRequestId && list.some((r) => r.request_id === selectedRequestId)
                        ? list.find((r) => r.request_id === selectedRequestId)!
                        : primary;

                    const isHovered = isInHoveredRange(employee, dateStr);

                    const weekend = isWeekend(dateStr);
                    const slotOrder = overlapSlotLayout.get(employee)?.get(dateStr) ?? null;
                    const useMultiRow = slotOrder != null && slotOrder.length > 1;
                    let tdBackground: string;
                    if (list.length > 0) {
                      tdBackground = useMultiRow ? 'transparent' : getStatusColor(colorSource!.status);
                    } else {
                      tdBackground = 'transparent';
                    }

                    if (!primary && weekend) {
                      tdBackground = weekendColor;
                    }

                    const tdHoverScale = !useMultiRow && isHovered;

                    const renderRequestRow = (req: CellRequest, rowUsesSlotColors: boolean) => {
                      const rowBg = getStatusColor(req.status);
                      const rowHovered = hoveredRequestId === req.request_id && isHovered;
                      return (
                        <div
                          key={req.request_id}
                          role="button"
                          tabIndex={0}
                          className={`flex min-h-[18px] min-w-0 w-full flex-[1_1_0] basis-0 items-center justify-center gap-0.5 px-0.5 py-0.5 transition-transform ${
                            rowHovered ? 'scale-110 z-10 relative' : ''
                          }`}
                          style={{ backgroundColor: rowUsesSlotColors ? rowBg : undefined }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCellClick(employee, dateStr, e, req.request_id);
                          }}
                          onMouseEnter={(e) => {
                            if (selectedRequestId) return;
                            handleCellHover(employee, dateStr, req.request_id);
                            setHoverTip({
                              x: e.clientX + 10,
                              y: e.clientY + 10,
                              lines: formatRequestHoverTip(req),
                            });
                          }}
                          onMouseMove={(e) => {
                            if (selectedRequestId) return;
                            setHoverTip((t) =>
                              t ? { ...t, x: e.clientX + 10, y: e.clientY + 10 } : null
                            );
                          }}
                          onMouseLeave={() => setHoverTip(null)}
                        >
                          <span className="truncate min-w-0">{req.code}</span>
                          {req.type === 'shift' && req.force !== undefined && (
                            <span className="text-[8px] flex-shrink-0">
                              {req.force ? '📌' : '✗'}
                            </span>
                          )}
                        </div>
                      );
                    };

                    return (
                      <td
                        key={dateStr}
                        data-cell-key={`${employee}_${dateStr}`}
                        className={`border border-black text-center font-bold text-[10px] align-top transition-all ${
                          useMultiRow ? 'p-0' : 'px-0.5 py-0.5'
                        } ${list.length > 0 ? 'cursor-pointer' : ''} ${tdHoverScale ? 'scale-110' : ''}`}
                        style={{ backgroundColor: tdBackground }}
                        onClick={(e) => handleCellClick(employee, dateStr, e)}
                        onMouseEnter={() => handleCellHover(employee, dateStr)}
                        onMouseLeave={handleCellLeave}
                      >
                        {useMultiRow && slotOrder ? (
                          <div className="flex min-h-[36px] flex-col items-stretch divide-y divide-black/25 leading-tight">
                            {slotOrder.map((rid) => {
                              const req = list.find((r) => r.request_id === rid);
                              if (req) return renderRequestRow(req, true);
                              return (
                                <div
                                  key={`spacer-${rid}`}
                                  aria-hidden
                                  className="pointer-events-none flex min-h-[18px] flex-[1_1_0] basis-0 bg-white"
                                />
                              );
                            })}
                          </div>
                        ) : list.length > 0 ? (
                          <div className="flex min-h-[18px] flex-col items-stretch justify-center leading-tight">
                            {renderRequestRow(list[0], false)}
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Action Popup */}
      {selectedRequestId && popupPosition && (() => {
        const request = [...leaveRequests, ...shiftRequests].find(r => r.request_id === selectedRequestId);
        if (!request) return null;
        
        const requestType = leaveRequests.some(r => r.request_id === selectedRequestId) ? 'leave' : 'shift';
        
        return (
          <div
            ref={popupRef}
            className="fixed z-50 bg-white border-2 border-gray-300 rounded-lg shadow-xl p-2 flex gap-1"
            style={{
              left: popupPosition.side === 'right' ? `${popupPosition.x}px` : 'auto',
              right: popupPosition.side === 'left' ? `${window.innerWidth - popupPosition.x}px` : 'auto',
              top: `${popupPosition.y}px`,
              transform: popupPosition.side === 'left' ? 'translateX(-100%)' : 'none',
            }}
          >
            {request.status !== 'Approved' && (
              <button
                onClick={() => {
                  onApprove(selectedRequestId, requestType);
                  onSelectRequest(null);
                  setPopupPosition(null);
                  setHoveredRequestId(null);
                  setHoverTip(null);
                }}
                disabled={processingRequestId === selectedRequestId}
                className="rounded-full bg-green-600 p-1.5 text-white shadow hover:bg-green-700 disabled:opacity-60 flex-shrink-0"
                title="Approve request"
              >
                <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                  <path d="M16.25 5.75L8.5 13.5L4.75 9.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {request.status !== 'Rejected' && (
              <button
                onClick={() => {
                  onReject(selectedRequestId, requestType);
                  onSelectRequest(null);
                  setPopupPosition(null);
                  setHoveredRequestId(null);
                  setHoverTip(null);
                }}
                disabled={processingRequestId === selectedRequestId}
                className="rounded-full bg-red-600 p-1.5 text-white shadow hover:bg-red-700 disabled:opacity-60 flex-shrink-0"
                title="Reject request"
              >
                <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                  <path d="M6 6L14 14M14 6L6 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
};
