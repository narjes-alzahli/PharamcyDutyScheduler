import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAuthGuard } from '../hooks/useAuthGuard';
import { dataAPI, usersAPI, requestsAPI } from '../services/api';
import api from '../services/api';
import { Pagination } from '../components/Pagination';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { isTokenExpired } from '../utils/tokenUtils';
import { useResizableColumns } from '../hooks/useResizableColumns';
import { useTableSort } from '../hooks/useTableSort';
import { useTableSearch } from '../hooks/useTableSearch';
import { SearchBar } from '../components/SearchBar';

interface User {
  username: string;
  employee_name: string;
  employee_type: string;
  password_hidden: string;
}

interface CalendarEntry {
  requestId: string;
  employee: string;
  status: string;
  submittedAt?: string;
  primaryLabel: string;
  secondaryLabel?: string;
  requestType: 'Leave' | 'Shift';
  startDate: Date;
  endDate: Date;
  raw: any;
}

interface CalendarDay {
  date: Date;
  inCurrentMonth: boolean;
}

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const generateCalendarMatrix = (baseDate: Date): CalendarDay[][] => {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1);
  const startWeekday = firstDayOfMonth.getDay(); // 0 = Sunday

  const startDate = new Date(firstDayOfMonth);
  startDate.setDate(startDate.getDate() - startWeekday);

  const totalCells = 6 * 7; // 6 weeks to comfortably cover any month
  const cells: CalendarDay[] = [];

  for (let i = 0; i < totalCells; i += 1) {
    const current = new Date(startDate);
    current.setDate(startDate.getDate() + i);
    cells.push({
      date: current,
      inCurrentMonth: current.getMonth() === month,
    });
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return weeks;
};

const getStatusBadgeClass = (status: string) => {
  switch (status) {
    case 'Approved':
      return 'bg-green-100 text-gray-900 border border-green-300';
    case 'Rejected':
      return 'bg-red-100 text-gray-900 border border-red-300';
    default:
      return 'bg-yellow-100 text-gray-900 border border-yellow-300';
  }
};

// Helper function to parse YYYY-MM-DD dates as local dates (avoid timezone issues)
const parseLocalDate = (dateStr: string): Date => {
  if (!dateStr) {
    return new Date(NaN);
  }
  const parts = dateStr.split('-');
  if (parts.length !== 3) {
    return new Date(NaN);
  }
  const [year, month, day] = parts.map(Number);
  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    return new Date(NaN);
  }
  return new Date(year, month - 1, day);
};

const buildCalendarEntries = (requests: any[], type: 'Leave' | 'Shift'): CalendarEntry[] => {
  const sortedRequests = [...requests].sort((a, b) => {
    const dateA = new Date(a.submitted_at || a.created_at || a.updated_at || 0).getTime();
    const dateB = new Date(b.submitted_at || b.created_at || b.updated_at || 0).getTime();
    return dateA - dateB;
  });

  const entries: CalendarEntry[] = [];
  
  // Debug: log total requests being processed
  console.log(`Building calendar entries for ${type}: ${sortedRequests.length} total requests`);

  sortedRequests.forEach((req) => {
    if (!req?.from_date) {
      console.warn(`Missing from_date in request ${req.request_id}`, req);
      return;
    }

    const startDate = parseLocalDate(req.from_date);
    const endDate = parseLocalDate(req.to_date || req.from_date);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      console.warn(`Invalid date in request ${req.request_id}: from_date=${req.from_date}, to_date=${req.to_date}`);
      return;
    }
    
    // Debug: log each request being processed
    console.log(`Processing ${type} request:`, {
      request_id: req.request_id,
      employee: req.employee,
      from_date: req.from_date,
      to_date: req.to_date,
      parsed_start: startDate.toISOString().split('T')[0],
      parsed_end: endDate.toISOString().split('T')[0],
    });

    // Ensure endDate is not before startDate
    if (endDate < startDate) {
      console.warn(`End date before start date in request ${req.request_id}: from_date=${req.from_date}, to_date=${req.to_date}`);
      // Use startDate as endDate if endDate is invalid
      const correctedEndDate = startDate;
      const entry: CalendarEntry = {
        requestId: req.request_id,
        employee: req.employee || 'Unknown',
        status: req.status || 'Pending',
        submittedAt: req.submitted_at,
        primaryLabel: type === 'Leave' ? req.leave_type : req.shift,
        secondaryLabel: type === 'Leave' ? undefined : req.force ? 'Must' : 'Cannot',
        requestType: type,
        startDate,
        endDate: correctedEndDate,
        raw: req,
      };
      entries.push(entry);
      return;
    }

    const entry: CalendarEntry = {
      requestId: req.request_id,
      employee: req.employee || 'Unknown',
      status: req.status || 'Pending',
      submittedAt: req.submitted_at,
      primaryLabel: type === 'Leave' ? req.leave_type : req.shift,
      secondaryLabel: type === 'Leave' ? undefined : req.force ? 'Must' : 'Cannot',
      requestType: type,
      startDate,
      endDate,
      raw: req,
    };

    entries.push(entry);
  });

  // Debug: log how many entries were created
  console.log(`Created ${entries.length} calendar entries for ${type} (from ${sortedRequests.length} requests)`);
  
  return entries;
};

const startOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const differenceInDays = (start: Date, end: Date) => {
  const startTime = startOfDay(start).getTime();
  const endTime = startOfDay(end).getTime();
  return Math.round((endTime - startTime) / (1000 * 60 * 60 * 24));
};

interface CalendarActionHandlers {
  approve?: (entry: CalendarEntry) => void;
  reject?: (entry: CalendarEntry) => void;
  remove?: (entry: CalendarEntry) => void;
}

const CalendarView: React.FC<{
  monthDate: Date;
  onPrev: () => void;
  onNext: () => void;
  entries: CalendarEntry[];
  emptyMessage?: string;
  selectedEntryId?: string | null;
  onSelectEntry?: (entry: CalendarEntry | null) => void;
  actions?: CalendarActionHandlers;
  processingRequestId?: string | null;
}> = ({ monthDate, onPrev, onNext, entries, emptyMessage, selectedEntryId, onSelectEntry, actions, processingRequestId }) => {
  const [hoveredEntryId, setHoveredEntryId] = useState<string | null>(null);
  const calendarMatrix = useMemo(() => generateCalendarMatrix(monthDate), [monthDate]);
  const requestCounts = useMemo(() => {
    const map = new Map<string, number>();

    entries.forEach((entry) => {
      const start = startOfDay(entry.startDate);
      const end = startOfDay(entry.endDate);
      for (const current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
        const key = formatDateKey(current);
        map.set(key, (map.get(key) || 0) + 1);
      }
    });

    return map;
  }, [entries]);

  const weekSegments = useMemo(() => {
    return calendarMatrix.map((week) => {
      const weekStart = startOfDay(week[0].date);
      const weekEnd = startOfDay(week[6].date);
      const segments: Array<{
        entry: CalendarEntry;
        colStart: number;
        colSpan: number;
        row: number;
        isSegmentStart: boolean;
        isSegmentEnd: boolean;
      }> = [];
      // Track occupancy per column (not just a single array)
      // occupancy[col][row] = true means that position is taken
      const occupancy: boolean[][] = Array(7).fill(null).map(() => []);

      entries.forEach((entry) => {
        const entryStart = startOfDay(entry.startDate);
        const entryEnd = startOfDay(entry.endDate);

        // Show entries that overlap with this week (even if they start before or end after)
        // This ensures all requests are visible in the schedule view
        // Overlap check: entry overlaps if entryStart <= weekEnd AND entryEnd >= weekStart
        if (entryEnd < weekStart || entryStart > weekEnd) {
          return; // No overlap with this week
        }
        
        // Debug: log entries being processed for this week
        console.log(`Entry overlaps with week:`, {
          employee: entry.employee,
          requestType: entry.requestType,
          entryStart: entryStart.toISOString().split('T')[0],
          entryEnd: entryEnd.toISOString().split('T')[0],
          weekStart: weekStart.toISOString().split('T')[0],
          weekEnd: weekEnd.toISOString().split('T')[0],
        });

        const segmentStart = entryStart < weekStart ? weekStart : entryStart;
        const segmentEnd = entryEnd > weekEnd ? weekEnd : entryEnd;

        const startCol = Math.max(0, differenceInDays(weekStart, segmentStart));
        const endCol = Math.min(6, differenceInDays(weekStart, segmentEnd));

        // Shift requests: treat each day as a separate, independent pill
        // Leave requests: create continuous segments
        if (entry.requestType === 'Shift') {
          // Create separate segments for each day
          // For shift requests, align pills within each column independently
          for (let dayCol = startCol; dayCol <= endCol; dayCol += 1) {
            // Find the first available row in this specific column
            let rowIndex = 0;
            while (rowIndex < occupancy[dayCol].length && occupancy[dayCol][rowIndex]) {
              rowIndex += 1;
            }
            // Mark this position as occupied
            occupancy[dayCol][rowIndex] = true;

            segments.push({
              entry,
              colStart: dayCol,
              colSpan: 1, // Each day is its own segment
              row: rowIndex, // Row within this column
              isSegmentStart: true, // Each day has rounded left end
              isSegmentEnd: true, // Each day has rounded right end
            });
          }
        } else {
          // Leave requests: create continuous segments
          // For leave requests, find the first row where ALL columns in the span are free
          let rowIndex = 0;
          let found = false;
          while (!found) {
            // Check if all columns from startCol to endCol are free at this row
            let allFree = true;
            for (let col = startCol; col <= endCol; col++) {
              if (rowIndex < occupancy[col].length && occupancy[col][rowIndex]) {
                allFree = false;
                break;
              }
            }
            if (allFree) {
              found = true;
            } else {
              rowIndex += 1;
            }
          }
          // Mark all positions in the span as occupied
          for (let col = startCol; col <= endCol; col++) {
            occupancy[col][rowIndex] = true;
          }

          // Determine if this segment is the actual start/end of the entry
          // isSegmentStart: true if this segment starts at the entry's actual start date
          // isSegmentEnd: true if this segment ends at the entry's actual end date
          const isActualStart = segmentStart.getTime() === entryStart.getTime();
          const isActualEnd = segmentEnd.getTime() === entryEnd.getTime();
          
          segments.push({
            entry,
            colStart: startCol,
            colSpan: endCol - startCol + 1,
            row: rowIndex,
            isSegmentStart: isActualStart,
            isSegmentEnd: isActualEnd,
          });
        }
      });

      // Calculate max rows used across all columns
      const maxRows = Math.max(...occupancy.map(col => col.length), 0);
      return { segments, rowsUsed: maxRows };
    });
  }, [calendarMatrix, entries]);

  const monthLabel = monthDate.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="rounded-lg border border-gray-300 bg-white shadow">
      <div className="flex items-center justify-between border-b border-gray-300 bg-gray-50 px-4 py-3">
        <button
          type="button"
          onClick={onPrev}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          ← Prev
        </button>
        <div className="text-base font-semibold text-gray-900">{monthLabel}</div>
        <button
          type="button"
          onClick={onNext}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Next →
        </button>
      </div>
      <div className="grid grid-cols-7 border-b border-gray-300 bg-gray-50">
        {dayLabels.map((day) => (
          <div key={day} className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wide border-r border-gray-300 last:border-r-0">
            {day}
          </div>
        ))}
      </div>
      <div className="divide-y divide-gray-200">
        {calendarMatrix.map((week, idx) => {
          const { segments } = weekSegments[idx];
          return (
            <div key={week[0].date.toISOString()} className="border-b border-gray-200 last:border-b-0">
              <div className="grid grid-cols-7">
                {week.map((day, colIdx) => {
                  const dateKey = formatDateKey(day.date);
                  const count = requestCounts.get(dateKey) || 0;
                  return (
                    <div
                      key={dateKey}
                      className={`flex min-h-[70px] flex-col px-3 pt-1 pb-1.5 overflow-hidden ${
                        day.inCurrentMonth ? 'bg-white text-gray-900' : 'bg-gray-50 text-gray-400'
                      } border-r border-gray-200 last:border-r-0`}
                    >
                      <div className={`mb-0.5 text-sm font-semibold ${day.inCurrentMonth ? 'text-gray-900' : 'text-gray-400'} flex items-center justify-between`}>
                        <span>{day.date.getDate()}</span>
                        {count > 0 && (
                          <span className={`text-[11px] font-medium ${day.inCurrentMonth ? 'text-gray-600' : 'text-gray-400'}`}>
                            ({count} request{count > 1 ? 's' : ''})
                          </span>
                        )}
                      </div>
                      <div className="min-h-[2px]">
                        {/* Reserved space for pills */}
                      </div>
                    </div>
                  );
                })}
              </div>
              {segments.length > 0 && (
                <div className="relative overflow-hidden bg-white">
                  <div className="pointer-events-none absolute inset-0 z-30 grid grid-cols-7">
                    {week.map((_, colIdx) => (
                      <div
                        key={`divider-${week[0].date.toISOString()}-${colIdx}`}
                        className={`border-r border-gray-200 last:border-r-0`}
                      />
                    ))}
                  </div>
                  <div
                    className="relative z-20 grid gap-y-2 gap-x-0 px-2 pt-0 pb-3"
                    style={{
                      gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                      gridAutoRows: 'minmax(24px, auto)',
                      gridAutoFlow: 'row dense',
                      overflow: 'hidden', // Prevent segments from bleeding into adjacent columns
                    }}
                  >
                    {segments.map(({ entry, colStart, colSpan, row, isSegmentStart, isSegmentEnd }) => {
                      const key = `${entry.requestType}-${entry.requestId}`;
                      const isSelected = selectedEntryId === key;
                      // For single-day segments: only use rounded-full if it's both start AND end
                      // If it continues to next week, use rounded left only (straight right edge)
                      const radiusClass =
                        colSpan === 1
                          ? (isSegmentStart && isSegmentEnd)
                            ? 'rounded-full'
                            : isSegmentStart
                            ? 'rounded-l-full'
                            : isSegmentEnd
                            ? 'rounded-r-full'
                            : 'rounded-none'
                          : [
                              'rounded-none',
                              isSegmentStart ? 'rounded-l-full' : '',
                              isSegmentEnd ? 'rounded-r-full' : '',
                            ]
                              .filter(Boolean)
                              .join(' ') || 'rounded-none';

                      // Apply margins to ALL rounded ends (circle tails) regardless of position in row
                      // Only square tails (connecting segments) get 0px margin
                      // isSegmentStart = true means it's a rounded left end (circle tail)
                      // isSegmentEnd = true means it's a rounded right end (circle tail)
                      const segmentStyle: React.CSSProperties = {
                        gridColumn: `${colStart + 1} / span ${colSpan}`,
                        gridRow: row + 1,
                        overflow: 'hidden',
                        position: 'relative',
                        marginLeft: isSegmentStart ? 4 : 0, // All circle tails (rounded left ends) get margin
                        marginRight: isSegmentEnd ? 4 : 0, // All circle tails (rounded right ends) get margin
                        boxSizing: 'border-box',
                        maxWidth: '100%',
                      };

                      // Track if this segment needs fade effects (continues across week rows)
                      const needsLeftFade = !isSegmentStart;
                      const needsRightFade = !isSegmentEnd;

                      // Make all pills float above calendar grid lines (z-30)
                      segmentStyle.zIndex = isSelected ? 50 : 40;
                      
                      // Selected state: use a subtle shadow and slightly darker border
                      if (isSelected) {
                        segmentStyle.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
                      } else {
                        // Only remove side borders for connecting segments (not rounded ends)
                        // Keep borders on rounded ends to show the circular outline
                        // The className already handles this with border-l-0/border-r-0 conditionally
                        // We only need to remove borders in inline style for non-rounded ends
                        if (!isSegmentStart) {
                          segmentStyle.borderLeft = 'none';
                        }
                        if (!isSegmentEnd) {
                          segmentStyle.borderRight = 'none';
                        }
                        // For rounded ends, don't set inline style - let CSS class handle the border
                      }

                      const isHovered = hoveredEntryId === key;
                      
                      return (
                        <button
                          key={`${key}-${colStart}-${row}`}
                          type="button"
                          onClick={() => {
                            if (!onSelectEntry) return;
                            if (isSelected) {
                              onSelectEntry(null);
                            } else {
                              onSelectEntry(entry);
                            }
                          }}
                          onMouseEnter={() => setHoveredEntryId(key)}
                          onMouseLeave={() => setHoveredEntryId(null)}
                          className={`flex flex-col gap-0.5 px-2 py-1 text-center items-center justify-center text-xs font-semibold text-gray-900 transition-all overflow-visible ${
                            getStatusBadgeClass(entry.status)
                          } ${radiusClass} ${
                            !isSegmentStart ? 'border-l-0' : ''
                          } ${
                            !isSegmentEnd ? 'border-r-0' : ''
                          } ${
                            isSelected
                              ? entry.status === 'Pending'
                                ? 'shadow-lg border-yellow-500 ring-2 ring-yellow-400'
                                : entry.status === 'Approved'
                                  ? 'shadow-lg border-green-500 ring-2 ring-green-400'
                                  : 'shadow-lg border-red-500 ring-2 ring-red-400'
                              : hoveredEntryId && !isHovered
                                ? 'opacity-50'
                                : selectedEntryId
                                  ? 'opacity-40'
                                  : isHovered
                                    ? 'shadow-xl scale-[1.02]'
                                    : 'shadow-sm'
                          }`}
                          style={segmentStyle}
                          title={`${entry.employee} • ${entry.primaryLabel}${
                            entry.secondaryLabel ? ` · ${entry.secondaryLabel}` : ''
                          } (${entry.requestType})`}
                        >
                          {/* Get status color for border fading */}
                          {(() => {
                            const getStatusColor = (status: string) => {
                              switch (status) {
                                case 'Approved':
                                  return { bg: 'rgba(134, 239, 172, 0.95)', border: 'rgba(34, 197, 94, 0.8)' }; // green-300
                                case 'Rejected':
                                  return { bg: 'rgba(252, 165, 165, 0.95)', border: 'rgba(239, 68, 68, 0.8)' }; // red-300
                                default:
                                  return { bg: 'rgba(254, 240, 138, 0.95)', border: 'rgba(234, 179, 8, 0.8)' }; // yellow-300
                              }
                            };
                            const statusColor = getStatusColor(entry.status);
                            
                            return (
                              <>
                                {/* Fade overlays for segments that continue across week rows - smoother gradient with status color */}
                                {needsLeftFade && (
                                  <div
                                    className="absolute inset-y-0 left-0 w-8 pointer-events-none z-10"
                                    style={{
                                      background: `linear-gradient(to right, ${statusColor.bg} 0%, ${statusColor.bg.replace('0.95', '0.6')} 40%, ${statusColor.bg.replace('0.95', '0.2')} 70%, transparent 100%)`,
                                      border: 'none',
                                    }}
                                  />
                                )}
                                {needsRightFade && (
                                  <div
                                    className="absolute inset-y-0 right-0 w-8 pointer-events-none z-10"
                                    style={{
                                      background: `linear-gradient(to left, ${statusColor.bg} 0%, ${statusColor.bg.replace('0.95', '0.6')} 40%, ${statusColor.bg.replace('0.95', '0.2')} 70%, transparent 100%)`,
                                      border: 'none',
                                    }}
                                  />
                                )}
                                {/* Top and bottom border fading that matches status color - applies to all pills */}
                                <div
                                  className="absolute inset-x-0 top-0 h-4 pointer-events-none z-10"
                                  style={{
                                    background: `linear-gradient(to bottom, ${statusColor.border} 0%, ${statusColor.border.replace('0.8', '0.4')} 50%, transparent 100%)`,
                                    borderTop: `1px solid ${statusColor.border}`,
                                  }}
                                />
                                <div
                                  className="absolute inset-x-0 bottom-0 h-4 pointer-events-none z-10"
                                  style={{
                                    background: `linear-gradient(to top, ${statusColor.border} 0%, ${statusColor.border.replace('0.8', '0.4')} 50%, transparent 100%)`,
                                    borderBottom: `1px solid ${statusColor.border}`,
                                  }}
                                />
                                {/* Left border fading for rounded start (circular outline) */}
                                {isSegmentStart && (
                                  <div
                                    className="absolute inset-y-0 left-0 w-4 pointer-events-none z-10"
                                    style={{
                                      background: `linear-gradient(to right, ${statusColor.border} 0%, ${statusColor.border.replace('0.8', '0.4')} 50%, transparent 100%)`,
                                      borderLeft: `1px solid ${statusColor.border}`,
                                    }}
                                  />
                                )}
                                {/* Right border fading for rounded end (circular outline) */}
                                {isSegmentEnd && (
                                  <div
                                    className="absolute inset-y-0 right-0 w-4 pointer-events-none z-10"
                                    style={{
                                      background: `linear-gradient(to left, ${statusColor.border} 0%, ${statusColor.border.replace('0.8', '0.4')} 50%, transparent 100%)`,
                                      borderRight: `1px solid ${statusColor.border}`,
                                    }}
                                  />
                                )}
                              </>
                            );
                          })()}
                          {entry.requestType === 'Leave' ? (
                            // Compact single-line format for Leave requests: "Name • Code"
                            <div className="flex items-center justify-center gap-1.5 relative z-50 w-full min-h-[18px]">
                              <span className="text-xs font-bold text-gray-900 leading-tight text-center truncate flex-1 min-w-0">
                                {entry.employee} • {entry.primaryLabel}
                              </span>
                              {isSelected && entry.status === 'Pending' && (
                                <div
                                  className="flex gap-1 flex-shrink-0 relative z-50"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {actions?.approve && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        actions.approve?.(entry);
                                      }}
                                      disabled={processingRequestId === entry.requestId}
                                      className="rounded-full bg-green-600 p-1 text-white shadow hover:bg-green-700 disabled:opacity-60 flex-shrink-0"
                                      title="Approve request"
                                      aria-label="Approve request"
                                    >
                                      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5">
                                        <path d="M16.25 5.75L8.5 13.5L4.75 9.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    </button>
                                  )}
                                  {actions?.reject && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        actions.reject?.(entry);
                                      }}
                                      disabled={processingRequestId === entry.requestId}
                                      className="rounded-full bg-red-600 p-1 text-white shadow hover:bg-red-700 disabled:opacity-60 flex-shrink-0"
                                      title="Reject request"
                                      aria-label="Reject request"
                                    >
                                      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5">
                                        <path d="M6 6L14 14M14 6L6 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    </button>
                                  )}
                                  {actions?.remove && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        actions.remove?.(entry);
                                      }}
                                      disabled={processingRequestId === entry.requestId}
                                      className="rounded-full bg-gray-700 p-1 text-white shadow hover:bg-gray-800 disabled:opacity-60 flex-shrink-0"
                                      title="Remove request"
                                      aria-label="Remove request"
                                    >
                                      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5">
                                        <path d="M5 6H6.66667H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M8.33333 6V4.66667C8.33333 4.31305 8.47381 3.97391 8.72386 3.72386C8.97391 3.47381 9.31305 3.33333 9.66667 3.33333H10.3333C10.687 3.33333 11.0261 3.47381 11.2761 3.72386C11.5262 3.97391 11.6667 4.31305 11.6667 4.66667V6M13.3333 6V15.3333C13.3333 15.687 13.1929 16.0261 12.9428 16.2761C12.6928 16.5262 12.3536 16.6667 12 16.6667H8C7.64638 16.6667 7.30724 16.5262 7.05719 16.2761C6.80714 16.0261 6.66667 15.687 6.66667 15.3333V6H13.3333Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            // Keep shift requests as they were (two-line format)
                            <>
                              <div className="flex items-center justify-center gap-1 relative z-50 min-h-[16px] w-full">
                                <span className="text-xs font-bold text-gray-900 leading-tight text-center">
                                  {entry.employee}
                                </span>
                              </div>
                              <div className="flex items-center justify-center gap-1 relative z-50 w-full mt-0.5">
                                <span className="text-[11px] font-medium text-gray-800 capitalize truncate text-center leading-tight">
                                  {`${entry.primaryLabel}${entry.secondaryLabel ? ` · ${entry.secondaryLabel}` : ''}`}
                                </span>
                                {isSelected && entry.status === 'Pending' && (
                                  <div
                                    className="flex gap-1 flex-shrink-0 relative z-50"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {actions?.approve && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          actions.approve?.(entry);
                                        }}
                                        disabled={processingRequestId === entry.requestId}
                                        className="rounded-full bg-green-600 p-1 text-white shadow hover:bg-green-700 disabled:opacity-60 flex-shrink-0"
                                        title="Approve request"
                                        aria-label="Approve request"
                                      >
                                        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5">
                                          <path d="M16.25 5.75L8.5 13.5L4.75 9.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                      </button>
                                    )}
                                    {actions?.reject && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          actions.reject?.(entry);
                                        }}
                                        disabled={processingRequestId === entry.requestId}
                                        className="rounded-full bg-red-600 p-1 text-white shadow hover:bg-red-700 disabled:opacity-60 flex-shrink-0"
                                        title="Reject request"
                                        aria-label="Reject request"
                                      >
                                        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5">
                                          <path d="M6 6L14 14M14 6L6 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                      </button>
                                    )}
                                    {actions?.remove && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          actions.remove?.(entry);
                                        }}
                                        disabled={processingRequestId === entry.requestId}
                                        className="rounded-full bg-gray-700 p-1 text-white shadow hover:bg-gray-800 disabled:opacity-60 flex-shrink-0"
                                        title="Remove request"
                                        aria-label="Remove request"
                                      >
                                        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5">
                                          <path d="M5 6H6.66667H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                          <path d="M8.33333 6V4.66667C8.33333 4.31305 8.47381 3.97391 8.72386 3.72386C8.97391 3.47381 9.31305 3.33333 9.66667 3.33333H10.3333C10.687 3.33333 11.0261 3.47381 11.2761 3.72386C11.5262 3.97391 11.6667 4.31305 11.6667 4.66667V6M13.3333 6V15.3333C13.3333 15.687 13.1929 16.0261 12.9428 16.2761C12.6928 16.5262 12.3536 16.6667 12 16.6667H8C7.64638 16.6667 7.30724 16.5262 7.05719 16.2761C6.80714 16.0261 6.66667 15.687 6.66667 15.3333V6H13.3333Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {entries.length === 0 && (
        <div className="border-t border-gray-300 px-4 py-8 text-center bg-white">
          <p className="text-gray-500 text-sm">{emptyMessage || 'No requests to display.'}</p>
          <p className="text-gray-400 text-xs mt-2">Try navigating to a different month or check if there are any requests in the table above.</p>
        </div>
      )}
    </div>
  );
};

export const UserManagement: React.FC = () => {
  // MAJOR RESTRUCTURE: Use auth guard to prevent API calls until auth is confirmed
  // This component is protected by requireManager, so if we're here, user MUST be Manager
  // But we still wait for auth to be fully ready before making any API calls
  const { isReady: authReady, isManager, user: currentUser } = useAuthGuard(true);
  const { loading: authLoading } = useAuth(); // Keep for loading state display
  const [users, setUsers] = useState<User[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [employeeType, setEmployeeType] = useState('Staff');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'leave' | 'shift'>('users');
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [shiftRequests, setShiftRequests] = useState<any[]>([]);
  const [processingRequest, setProcessingRequest] = useState<string | null>(null);
  const hasInitialDataLoaded = useRef(false);
  
  // Resizable columns for leave requests table
  const leaveTableColumns = ['employee', 'from_date', 'to_date', 'type', 'reason', 'status', 'submitted', 'actions'];
  const { columnWidths: leaveWidths, handleMouseDown: leaveHandleMouseDown, tableRef: leaveTableRef, isResizing: leaveResizing } = useResizableColumns(leaveTableColumns, 150);
  
  // Resizable columns for shift requests table
  const shiftTableColumns = ['employee', 'from_date', 'to_date', 'shift', 'type', 'status', 'submitted', 'actions'];
  const { columnWidths: shiftWidths, handleMouseDown: shiftHandleMouseDown, tableRef: shiftTableRef, isResizing: shiftResizing } = useResizableColumns(shiftTableColumns, 150);
  
  // Resizable columns for users table
  const usersTableColumns = ['username', 'employee_name', 'employee_type', 'password', 'actions'];
  const { columnWidths: usersWidths, handleMouseDown: usersHandleMouseDown, tableRef: usersTableRef, isResizing: usersResizing } = useResizableColumns(usersTableColumns, 200);
  
  
  // Search and sort for users
  const { searchTerm: usersSearchTerm, setSearchTerm: setUsersSearchTerm, filteredData: searchedUsers } = useTableSearch(users, ['username', 'employee_name', 'employee_type']);
  const { sortedData: sortedUsers, sortConfig: usersSortConfig, handleSort: handleUsersSort } = useTableSort(searchedUsers);
  
  // Calendar and table filter dates (must be declared before useMemo hooks)
  const [leaveCalendarDate, setLeaveCalendarDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [shiftCalendarDate, setShiftCalendarDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // Year/month filter for table views - start as null (no selection)
  const [leaveTableFilterDate, setLeaveTableFilterDate] = useState<Date | null>(null);
  const [shiftTableFilterDate, setShiftTableFilterDate] = useState<Date | null>(null);
  const [selectedCalendarEntryId, setSelectedCalendarEntryId] = useState<string | null>(null);
  
  // Pagination state
  const [usersPage, setUsersPage] = useState(1);
  const [leavePage, setLeavePage] = useState(1);
  const [shiftPage, setShiftPage] = useState(1);
  const itemsPerPage = 10;

  const pendingLeaveCount = leaveRequests.filter((req) => req.status === 'Pending').length;
  const pendingShiftCount = shiftRequests.filter((req) => req.status === 'Pending').length;
  
  // Get available month/year combinations from requests
  const availableLeaveMonthYears = useMemo(() => {
    const monthYearSet = new Set<string>();
    leaveRequests.forEach((req: any) => {
      const reqDate = new Date(req.from_date);
      const year = reqDate.getFullYear();
      const month = reqDate.getMonth() + 1; // 1-12
      monthYearSet.add(`${year}-${month}`);
    });
    return Array.from(monthYearSet)
      .map(key => {
        const [year, month] = key.split('-').map(Number);
        return { year, month, value: key, label: `${new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}` };
      })
      .sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return a.month - b.month;
      });
  }, [leaveRequests]);

  const availableShiftMonthYears = useMemo(() => {
    const monthYearSet = new Set<string>();
    shiftRequests.forEach((req: any) => {
      const reqDate = new Date(req.from_date);
      const year = reqDate.getFullYear();
      const month = reqDate.getMonth() + 1; // 1-12
      monthYearSet.add(`${year}-${month}`);
    });
    return Array.from(monthYearSet)
      .map(key => {
        const [year, month] = key.split('-').map(Number);
        return { year, month, value: key, label: `${new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}` };
      })
      .sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return a.month - b.month;
      });
  }, [shiftRequests]);

  // Filter requests by year/month for table view (must be after state declarations)
  const filteredLeaveRequestsByDate = useMemo(() => {
    if (!leaveTableFilterDate) return [];
    const filterYear = leaveTableFilterDate.getFullYear();
    const filterMonth = leaveTableFilterDate.getMonth();
    return leaveRequests.filter((req: any) => {
      const reqDate = new Date(req.from_date);
      return reqDate.getFullYear() === filterYear && reqDate.getMonth() === filterMonth;
    });
  }, [leaveRequests, leaveTableFilterDate]);
  
  const filteredShiftRequestsByDate = useMemo(() => {
    if (!shiftTableFilterDate) return [];
    const filterYear = shiftTableFilterDate.getFullYear();
    const filterMonth = shiftTableFilterDate.getMonth();
    return shiftRequests.filter((req: any) => {
      const reqDate = new Date(req.from_date);
      return reqDate.getFullYear() === filterYear && reqDate.getMonth() === filterMonth;
    });
  }, [shiftRequests, shiftTableFilterDate]);
  
  // Search and sort for leave requests (after date filtering)
  const { searchTerm: leaveSearchTerm, setSearchTerm: setLeaveSearchTerm, filteredData: searchedLeaveRequests } = useTableSearch(filteredLeaveRequestsByDate, ['employee', 'leave_type', 'reason', 'status']);
  const { sortedData: sortedLeaveRequests, sortConfig: leaveSortConfig, handleSort: handleLeaveSort } = useTableSort(searchedLeaveRequests);
  
  // Search and sort for shift requests (after date filtering)
  const { searchTerm: shiftSearchTerm, setSearchTerm: setShiftSearchTerm, filteredData: searchedShiftRequests } = useTableSearch(filteredShiftRequestsByDate, ['employee', 'shift', 'reason', 'status']);
  const { sortedData: sortedShiftRequests, sortConfig: shiftSortConfig, handleSort: handleShiftSort } = useTableSort(searchedShiftRequests);

  const loadRequests = useCallback(async (isRefresh = false) => {
    // MAJOR RESTRUCTURE: Only make API calls if auth guard confirms we're ready
    // This eliminates all race conditions - we KNOW user is Manager if authReady is true
    // isRefresh=true means this is a refresh after an action, so preserve existing data on auth failures
    if (!authReady || !isManager || !currentUser) {
      // Auth not ready or user not confirmed Manager - don't make any calls
      // Only clear on initial load, not on refresh - preserve existing data
      if (!hasInitialDataLoaded.current && !isRefresh) {
        setLeaveRequests([]);
        setShiftRequests([]);
      }
      return;
    }

    // CRITICAL: Double-check token is still valid right before making the call
    // This prevents race conditions where token expires between guard check and API call
    const token = localStorage.getItem('access_token');
    if (!token || isTokenExpired(token)) {
      // Token expired between guard check and API call - wait for refresh
      // Don't clear existing data on refresh - might be temporary token refresh
      if (!hasInitialDataLoaded.current && !isRefresh) {
        console.warn('⚠️ Token expired between guard check and API call - skipping request');
        setLeaveRequests([]);
        setShiftRequests([]);
      }
      return;
    }

    // At this point, we're 100% certain:
    // 1. Auth is fully loaded
    // 2. User is authenticated
    // 3. User is confirmed to be a Manager
    // 4. Token is still valid
    // Safe to make manager-only API calls
    try {
      const [leaveRes, shiftRes] = await Promise.all([
        requestsAPI.getAllLeaveRequests(),
        requestsAPI.getAllShiftRequests(),
      ]);
      // Filter out "Added via Roster Generator" requests - those are admin-managed, not employee requests
      const filteredLeaveRequests = leaveRes.filter((req: any) => req.reason !== 'Added via Roster Generator');
      const filteredShiftRequests = shiftRes.filter((req: any) => req.reason !== 'Added via Roster Generator');
      setLeaveRequests(filteredLeaveRequests);
      setShiftRequests(filteredShiftRequests);
      hasInitialDataLoaded.current = true; // Mark that we've successfully loaded data
      const pendingCount =
        leaveRes.filter((req: any) => req.status === 'Pending').length +
        shiftRes.filter((req: any) => req.status === 'Pending').length;
      window.dispatchEvent(
        new CustomEvent('pendingRequestsUpdated', { detail: { count: pendingCount } })
      );
    } catch (error: any) {
      // If we get 403 here, something is seriously wrong (auth guard should prevent this)
      // Log it for debugging
      if (error.response?.status === 403) {
        console.error('⚠️ Unexpected 403 error - auth guard should have prevented this:', {
          authReady,
          isManager,
          userType: currentUser?.employee_type
        });
        // Only clear on initial load, not on refresh - preserve existing data
        if (!hasInitialDataLoaded.current && !isRefresh) {
          setLeaveRequests([]);
          setShiftRequests([]);
        }
        return;
      }
      // Log other errors
      console.error('Failed to load requests:', error);
      // Only clear on initial load, not on refresh - preserve existing data
      if (!hasInitialDataLoaded.current && !isRefresh) {
        setLeaveRequests([]);
        setShiftRequests([]);
      }
    }
  }, [authReady, isManager, currentUser]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [usersRes, employeesRes] = await Promise.all([
        api.get('/api/users/'),
        dataAPI.getEmployees(),
      ]);
      setUsers(usersRes.data);
      setEmployees(employeesRes);
      if (employeesRes.length > 0) {
        setSelectedEmployee(employeesRes[0].employee);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // MAJOR RESTRUCTURE: Use auth guard instead of manual checks
    // loadData doesn't require manager status, so it can run when auth is ready
    if (!authLoading) {
      loadData();
    }
    
    // Only load manager-only requests if auth guard confirms we're ready
    if (authReady && isManager) {
      loadRequests();
    } else {
      // Auth not ready or not manager - clear requests
      setLeaveRequests([]);
      setShiftRequests([]);
    }
  }, [authLoading, authReady, isManager, loadData, loadRequests]);

  useEffect(() => {
    // MAJOR RESTRUCTURE: Only reload if auth guard confirms we're ready
    if (authReady && isManager && (activeTab === 'leave' || activeTab === 'shift')) {
      loadRequests();
    }
  }, [activeTab, authReady, isManager, loadRequests]);

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedEmployee) {
      alert('Please select an employee');
      return;
    }

    try {
      setUpdating(true);
      await api.put('/api/users/', {
        employee_name: selectedEmployee,
        password: newPassword || undefined,
        employee_type: employeeType,
      });
      
      setNotification({ message: '✅ User account updated successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      setNewPassword('');
      await loadData();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to update user account', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteUser = async (username: string, employeeName: string) => {
    if (!window.confirm(`Are you sure you want to delete the user account for "${employeeName}" (${username})? This action cannot be undone.`)) {
      return;
    }

    try {
      setDeleting(username);
      await usersAPI.deleteUser(username);
      setNotification({ message: '✅ User account deleted successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      await loadData();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to delete user account', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setDeleting(null);
    }
  };

  const getUsername = (employeeName: string) => {
    return employeeName.toLowerCase().replace(' ', '_');
  };

  const handleApproveLeave = async (requestId: string) => {
    try {
      setProcessingRequest(requestId);
      await requestsAPI.approveLeaveRequest(requestId);
      setNotification({ message: '✅ Leave request approved successfully! It has been added to the roster.', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
      // Use isRefresh=true to prevent clearing data during refresh
      await loadRequests(true);
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to approve leave request', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleRejectLeave = async (requestId: string) => {
    if (!window.confirm('Are you sure you want to reject this leave request?')) {
      return;
    }
    try {
      setProcessingRequest(requestId);
      await requestsAPI.rejectLeaveRequest(requestId);
      setNotification({ message: 'Leave request rejected', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      // Use isRefresh=true to prevent clearing data during refresh
      await loadRequests(true);
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to reject leave request', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleApproveShift = async (requestId: string) => {
    try {
      setProcessingRequest(requestId);
      await requestsAPI.approveShiftRequest(requestId);
      setNotification({ message: '✅ Shift request approved successfully! It has been added to the roster.', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
      // Use isRefresh=true to prevent clearing data during refresh
      await loadRequests(true);
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to approve shift request', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleRejectShift = async (requestId: string) => {
    if (!window.confirm('Are you sure you want to reject this shift request?')) {
      return;
    }
    try {
      setProcessingRequest(requestId);
      await requestsAPI.rejectShiftRequest(requestId);
      setNotification({ message: 'Shift request rejected', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      // Use isRefresh=true to prevent clearing data during refresh
      await loadRequests(true);
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to reject shift request', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleDeleteLeave = async (requestId: string) => {
    if (!window.confirm('Remove this leave request? This cannot be undone.')) {
      return;
    }
    try {
      setProcessingRequest(requestId);
      await requestsAPI.deleteLeaveRequest(requestId);
      setNotification({ message: 'Leave request removed.', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      // Use isRefresh=true to prevent clearing data during refresh
      await loadRequests(true);
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to remove leave request', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleDeleteShift = async (requestId: string) => {
    if (!window.confirm('Remove this shift request? This cannot be undone.')) {
      return;
    }
    try {
      setProcessingRequest(requestId);
      await requestsAPI.deleteShiftRequest(requestId);
      setNotification({ message: 'Shift request removed.', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      // Use isRefresh=true to prevent clearing data during refresh
      await loadRequests(true);
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to remove shift request', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setProcessingRequest(null);
    }
  };

  const formatDate = (dateStr: string) => {
    // Use Day, DD-MM-YYYY format
    if (!dateStr) return '';
    const dateOnly = dateStr.split('T')[0]; // Get YYYY-MM-DD part
    const parts = dateOnly.split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      return `${dayName}, ${day}-${month}-${year}`;
    }
    // Fallback to original if parsing fails
    return dateStr;
  };

  const formatDateTime = (dateStr: string) => {
    // Format date as DD-MM-YYYY and time as HH:MM
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}-${month}-${year} ${hours}:${minutes}`;
  };

  const leaveCalendarEntries = useMemo(
    () => buildCalendarEntries(leaveRequests, 'Leave'),
    [leaveRequests]
  );

  const shiftCalendarEntries = useMemo(
    () => buildCalendarEntries(shiftRequests, 'Shift'),
    [shiftRequests]
  );

  const handleCalendarEntryAction = useCallback(
    (entry: CalendarEntry, action: 'approve' | 'reject' | 'remove') => {
      setSelectedCalendarEntryId(null);

      if (entry.requestType === 'Leave') {
        if (action === 'approve') {
          handleApproveLeave(entry.requestId);
        } else if (action === 'reject') {
          handleRejectLeave(entry.requestId);
        } else if (action === 'remove') {
          handleDeleteLeave(entry.requestId);
        }
      } else if (entry.requestType === 'Shift') {
        if (action === 'approve') {
          handleApproveShift(entry.requestId);
        } else if (action === 'reject') {
          handleRejectShift(entry.requestId);
        } else if (action === 'remove') {
          handleDeleteShift(entry.requestId);
        }
      }
    },
    [handleApproveLeave, handleRejectLeave, handleDeleteLeave, handleApproveShift, handleRejectShift, handleDeleteShift]
  );

  useEffect(() => {
    if (leaveRequests.length > 0) {
      const earliest = leaveRequests.reduce((earliestDate: Date | null, req: any) => {
        const candidate = new Date(req.from_date);
        if (Number.isNaN(candidate.getTime())) {
          return earliestDate;
        }
        if (!earliestDate || candidate < earliestDate) {
          return candidate;
        }
        return earliestDate;
      }, null as Date | null);

      if (earliest) {
        setLeaveCalendarDate(new Date(earliest.getFullYear(), earliest.getMonth(), 1));
      }
    }
  }, [leaveRequests]);

  useEffect(() => {
    if (shiftRequests.length > 0) {
      const earliest = shiftRequests.reduce((earliestDate: Date | null, req: any) => {
        const candidate = new Date(req.from_date);
        if (Number.isNaN(candidate.getTime())) {
          return earliestDate;
        }
        if (!earliestDate || candidate < earliestDate) {
          return candidate;
        }
        return earliestDate;
      }, null as Date | null);

      if (earliest) {
        setShiftCalendarDate(new Date(earliest.getFullYear(), earliest.getMonth(), 1));
      }
    }
  }, [shiftRequests]);

  useEffect(() => {
    setSelectedCalendarEntryId(null);
  }, [activeTab]);

  // Paginated data
  const paginatedUsers = useMemo(() => {
    const start = (usersPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return sortedUsers.slice(start, end);
  }, [sortedUsers, usersPage]);
  
  const paginatedLeaveRequests = useMemo(() => {
    const start = (leavePage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return sortedLeaveRequests.slice(start, end);
  }, [sortedLeaveRequests, leavePage]);
  
  const paginatedShiftRequests = useMemo(() => {
    const start = (shiftPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return sortedShiftRequests.slice(start, end);
  }, [sortedShiftRequests, shiftPage]);

  const usersTotalPages = Math.ceil(sortedUsers.length / itemsPerPage);
  const leaveTotalPages = Math.ceil(sortedLeaveRequests.length / itemsPerPage);
  const shiftTotalPages = Math.ceil(sortedShiftRequests.length / itemsPerPage);

  // MAJOR RESTRUCTURE: Show loading while auth is being verified
  // This prevents components from rendering and making API calls before auth is ready
  if (authLoading || !authReady) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">User Management</h2>
        <LoadingSkeleton type="list" rows={5} />
      </div>
    );
  }

  // If auth is ready but user is not a Manager (shouldn't happen due to ProtectedRoute, but be safe)
  if (!isManager || !currentUser) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">User Management</h2>
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
          You don't have permission to access this page.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">User Management</h2>
        <LoadingSkeleton type="list" rows={5} />
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-3xl font-bold text-gray-900 mb-6">User Management</h2>
      
      {/* Auto-dismissing notification toast */}
      {notification && (
        <div 
          className={`fixed top-20 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
            notification.type === 'success' 
              ? 'bg-green-500 text-white' 
              : 'bg-red-500 text-white'
          }`}
          style={{ animation: 'slideIn 0.3s ease-out' }}
        >
          {notification.message}
        </div>
      )}

      {/* Tabs for Managers */}
      {/* MAJOR RESTRUCTURE: We know user is Manager if we got here (auth guard + ProtectedRoute) */}
      {isManager && (
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('users')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'users'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              User Accounts
            </button>
            <button
              onClick={() => setActiveTab('leave')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'leave'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="inline-flex items-center space-x-2">
                <span>Leave Requests</span>
                {pendingLeaveCount > 0 && (
                  <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-2 text-xs font-semibold text-white bg-red-600 rounded-full">
                    {pendingLeaveCount}
                  </span>
                )}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('shift')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'shift'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="inline-flex items-center space-x-2">
                <span>Shift Requests</span>
                {pendingShiftCount > 0 && (
                  <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-2 text-xs font-semibold text-white bg-red-600 rounded-full">
                    {pendingShiftCount}
                  </span>
                )}
              </span>
            </button>
          </nav>
        </div>
      )}

      {/* Leave Requests Tab */}
      {activeTab === 'leave' && isManager && (
        <div className="space-y-6">
          {/* Month/Year Selector at top - shared for table and schedule */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium text-gray-700">Select Month/Year:</label>
                <select
                  value={leaveTableFilterDate ? `${leaveTableFilterDate.getFullYear()}-${leaveTableFilterDate.getMonth() + 1}` : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      const [year, month] = e.target.value.split('-').map(Number);
                      const newDate = new Date(year, month - 1, 1);
                      setLeaveTableFilterDate(newDate);
                      setLeaveCalendarDate(newDate); // Sync calendar view
                    } else {
                      setLeaveTableFilterDate(null);
                    }
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 min-w-[200px]"
                >
                  <option value="">Select Month & Year...</option>
                  {availableLeaveMonthYears.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {pendingLeaveCount > 0 && (
                <span className="text-sm text-gray-500">
                  {pendingLeaveCount} pending approval{pendingLeaveCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          
          {!leaveTableFilterDate ? (
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <p className="text-gray-600 text-center py-8">Please select a month and year.</p>
            </div>
          ) : (
          <>
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">
                Leave Requests
              </h3>
            </div>
            {filteredLeaveRequestsByDate.length > 0 ? (
            <>
            <SearchBar
              searchTerm={leaveSearchTerm}
              onSearchChange={setLeaveSearchTerm}
              placeholder="Search leave requests by employee, type, reason, or status..."
            />
            <div className="overflow-x-auto">
              <table ref={leaveTableRef} className="min-w-full divide-y divide-gray-200 border border-gray-300" style={{ tableLayout: 'auto', width: '100%' }}>
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th key="employee" style={{ width: `${leaveWidths.employee || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      <div className="flex items-center space-x-1">
                        <span>Employee</span>
                        <button onClick={() => handleLeaveSort('employee')} className="p-1 hover:bg-gray-200 rounded text-xs" title="Sort by employee">
                          {leaveSortConfig?.key === 'employee' ? (leaveSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </button>
                      </div>
                      <div onMouseDown={(e) => leaveHandleMouseDown(e, 'employee')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="from_date" style={{ width: `${leaveWidths.from_date || 150}px`, position: 'relative' }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 whitespace-nowrap min-w-[120px]">
                      <div className="flex items-center space-x-1">
                        <span>From Date</span>
                        <button onClick={() => handleLeaveSort('from_date')} className="p-1 hover:bg-gray-200 rounded">
                          {leaveSortConfig?.key === 'from_date' ? (leaveSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </button>
                      </div>
                      <div onMouseDown={(e) => leaveHandleMouseDown(e, 'from_date')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="to_date" style={{ width: `${leaveWidths.to_date || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50 whitespace-nowrap min-w-[120px]">
                      <div className="flex items-center space-x-1">
                        <span>To Date</span>
                        <button onClick={() => handleLeaveSort('to_date')} className="p-1 hover:bg-gray-200 rounded">
                          {leaveSortConfig?.key === 'to_date' ? (leaveSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </button>
                      </div>
                      <div onMouseDown={(e) => leaveHandleMouseDown(e, 'to_date')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="type" style={{ width: `${leaveWidths.type || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      <div className="flex items-center space-x-1">
                        <span>Type</span>
                        <button onClick={() => handleLeaveSort('leave_type')} className="p-1 hover:bg-gray-200 rounded">
                          {leaveSortConfig?.key === 'leave_type' ? (leaveSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </button>
                      </div>
                      <div onMouseDown={(e) => leaveHandleMouseDown(e, 'type')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="reason" style={{ width: `${leaveWidths.reason || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      <div className="flex items-center space-x-1">
                        <span>Reason</span>
                        <button onClick={() => handleLeaveSort('reason')} className="p-1 hover:bg-gray-200 rounded">
                          {leaveSortConfig?.key === 'reason' ? (leaveSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </button>
                      </div>
                      <div onMouseDown={(e) => leaveHandleMouseDown(e, 'reason')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="status" style={{ width: `${leaveWidths.status || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      <div className="flex items-center space-x-1">
                        <span>Status</span>
                        <button onClick={() => handleLeaveSort('status')} className="p-1 hover:bg-gray-200 rounded">
                          {leaveSortConfig?.key === 'status' ? (leaveSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </button>
                      </div>
                      <div onMouseDown={(e) => leaveHandleMouseDown(e, 'status')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="submitted" style={{ width: `${leaveWidths.submitted || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      <div className="flex items-center space-x-1">
                        <span>Submitted</span>
                        <button onClick={() => handleLeaveSort('submitted_at')} className="p-1 hover:bg-gray-200 rounded">
                          {leaveSortConfig?.key === 'submitted_at' ? (leaveSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </button>
                      </div>
                      <div onMouseDown={(e) => leaveHandleMouseDown(e, 'submitted')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="actions" style={{ width: `${leaveWidths.actions || 200}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {paginatedLeaveRequests.map((req) => (
                    <tr key={req.request_id} className="hover:bg-gray-50">
                      <td style={{ width: `${leaveWidths.employee || 150}px` }} className="px-4 py-3 text-sm text-gray-900 border border-gray-300">{req.employee}</td>
                      <td style={{ width: `${leaveWidths.from_date || 150}px` }} className="px-4 py-3 text-sm text-gray-700 border border-gray-300 whitespace-nowrap">{formatDate(req.from_date)}</td>
                      <td style={{ width: `${leaveWidths.to_date || 150}px` }} className="px-4 py-3 text-sm text-gray-700 border border-gray-300 whitespace-nowrap">{formatDate(req.to_date)}</td>
                      <td style={{ width: `${leaveWidths.type || 150}px` }} className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{req.leave_type}</td>
                      <td style={{ width: `${leaveWidths.reason || 150}px` }} className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{req.reason || '-'}</td>
                      <td style={{ width: `${leaveWidths.status || 150}px` }} className="px-4 py-3 text-sm border border-gray-300">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          req.status === 'Approved' ? 'bg-green-100 text-green-800' :
                          req.status === 'Rejected' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {req.status}
                        </span>
                      </td>
                      <td style={{ width: `${leaveWidths.submitted || 150}px` }} className="px-4 py-3 text-sm text-gray-500 border border-gray-300">{formatDateTime(req.submitted_at)}</td>
                      <td style={{ width: `${leaveWidths.actions || 200}px` }} className="px-4 py-3 text-sm border border-gray-300">
                        {req.status === 'Pending' ? (
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleApproveLeave(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="rounded-full bg-green-600 p-1 text-white shadow hover:bg-green-700 disabled:opacity-60 flex-shrink-0"
                              title="Approve request"
                              aria-label="Approve request"
                            >
                              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5">
                                <path d="M16.25 5.75L8.5 13.5L4.75 9.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleRejectLeave(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="rounded-full bg-red-600 p-1 text-white shadow hover:bg-red-700 disabled:opacity-60 flex-shrink-0"
                              title="Reject request"
                              aria-label="Reject request"
                            >
                              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5">
                                <path d="M6 6L14 14M14 6L6 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDeleteLeave(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="rounded-full bg-gray-700 p-1 text-white shadow hover:bg-gray-800 disabled:opacity-60 flex-shrink-0"
                              title="Remove request"
                              aria-label="Remove request"
                            >
                              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5">
                                <path d="M5 6H6.66667H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M8.33333 6V4.66667C8.33333 4.31305 8.47381 3.97391 8.72386 3.72386C8.97391 3.47381 9.31305 3.33333 9.66667 3.33333H10.3333C10.687 3.33333 11.0261 3.47381 11.2761 3.72386C11.5262 3.97391 11.6667 4.31305 11.6667 4.66667V6M13.3333 6V15.3333C13.3333 15.687 13.1929 16.0261 12.9428 16.2761C12.6928 16.5262 12.3536 16.6667 12 16.6667H8C7.64638 16.6667 7.30724 16.5262 7.05719 16.2761C6.80714 16.0261 6.66667 15.687 6.66667 15.3333V6H13.3333Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500">
                            {req.approved_by && `By ${req.approved_by}`}
                            {req.approved_at && ` on ${formatDate(req.approved_at)}`}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              {leaveTotalPages > 1 && (
                <Pagination
                  currentPage={leavePage}
                  totalPages={leaveTotalPages}
                  onPageChange={setLeavePage}
                  itemsPerPage={itemsPerPage}
                  totalItems={sortedLeaveRequests.length}
                />
              )}
            </>
          ) : (
            <p className="text-gray-600">No leave requests found for the selected month.</p>
          )}
            </div>
            <div className="mt-8 max-w-8xl pr-6 space-y-3">
              <h4 className="text-lg font-semibold text-gray-900">Schedule View</h4>
              <CalendarView
                monthDate={leaveTableFilterDate!}
                onPrev={() => {
                  if (leaveTableFilterDate) {
                    const newDate = new Date(leaveTableFilterDate.getFullYear(), leaveTableFilterDate.getMonth() - 1, 1);
                    setLeaveTableFilterDate(newDate);
                    setLeaveCalendarDate(newDate);
                  }
                }}
                onNext={() => {
                  if (leaveTableFilterDate) {
                    const newDate = new Date(leaveTableFilterDate.getFullYear(), leaveTableFilterDate.getMonth() + 1, 1);
                    setLeaveTableFilterDate(newDate);
                    setLeaveCalendarDate(newDate);
                  }
                }}
                entries={leaveCalendarEntries}
                emptyMessage="No leave requests for the selected month."
                selectedEntryId={selectedCalendarEntryId}
                onSelectEntry={(entry) =>
                  setSelectedCalendarEntryId(entry ? `${entry.requestType}-${entry.requestId}` : null)
                }
                actions={{
                  approve: (entry) => handleCalendarEntryAction(entry, 'approve'),
                  reject: (entry) => handleCalendarEntryAction(entry, 'reject'),
                  remove: (entry) => handleCalendarEntryAction(entry, 'remove'),
                }}
                processingRequestId={processingRequest}
              />
            </div>
          </>
          )}
        </div>
      )}

      {/* Shift Requests Tab */}
      {activeTab === 'shift' && isManager && (
        <div className="space-y-6">
          {/* Month/Year Selector at top - shared for table and schedule */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium text-gray-700">Select Month/Year:</label>
                <select
                  value={shiftTableFilterDate ? `${shiftTableFilterDate.getFullYear()}-${shiftTableFilterDate.getMonth() + 1}` : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      const [year, month] = e.target.value.split('-').map(Number);
                      const newDate = new Date(year, month - 1, 1);
                      setShiftTableFilterDate(newDate);
                      setShiftCalendarDate(newDate); // Sync calendar view
                    } else {
                      setShiftTableFilterDate(null);
                    }
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 min-w-[200px]"
                >
                  <option value="">Select Month & Year...</option>
                  {availableShiftMonthYears.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {pendingShiftCount > 0 && (
                <span className="text-sm text-gray-500">
                  {pendingShiftCount} pending approval{pendingShiftCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          
          {!shiftTableFilterDate ? (
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <p className="text-gray-600 text-center py-8">Please select a month and year.</p>
            </div>
          ) : (
          <>
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">
                Shift Requests
              </h3>
            </div>
            {filteredShiftRequestsByDate.length > 0 ? (
            <>
            <div className="overflow-x-auto">
              <table ref={shiftTableRef} className="min-w-full divide-y divide-gray-200 border border-gray-300" style={{ tableLayout: 'auto', width: '100%' }}>
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th key="employee" style={{ width: `${shiftWidths.employee || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      Employee
                      <div onMouseDown={(e) => shiftHandleMouseDown(e, 'employee')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${shiftResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="from_date" style={{ width: `${shiftWidths.from_date || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      From Date
                      <div onMouseDown={(e) => shiftHandleMouseDown(e, 'from_date')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${shiftResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="to_date" style={{ width: `${shiftWidths.to_date || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      To Date
                      <div onMouseDown={(e) => shiftHandleMouseDown(e, 'to_date')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${shiftResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="shift" style={{ width: `${shiftWidths.shift || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      Shift
                      <div onMouseDown={(e) => shiftHandleMouseDown(e, 'shift')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${shiftResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="type" style={{ width: `${shiftWidths.type || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      Type
                      <div onMouseDown={(e) => shiftHandleMouseDown(e, 'type')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${shiftResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="reason" style={{ width: `${shiftWidths.reason || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      Reason
                      <div onMouseDown={(e) => shiftHandleMouseDown(e, 'reason')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${shiftResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="status" style={{ width: `${shiftWidths.status || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      Status
                      <div onMouseDown={(e) => shiftHandleMouseDown(e, 'status')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${shiftResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="submitted" style={{ width: `${shiftWidths.submitted || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      Submitted
                      <div onMouseDown={(e) => shiftHandleMouseDown(e, 'submitted')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${shiftResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="actions" style={{ width: `${shiftWidths.actions || 200}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {paginatedShiftRequests.map((req) => (
                    <tr key={req.request_id} className="hover:bg-gray-50">
                      <td style={{ width: `${shiftWidths.employee || 150}px` }} className="px-4 py-3 text-sm text-gray-900 border border-gray-300">{req.employee}</td>
                      <td style={{ width: `${shiftWidths.from_date || 150}px` }} className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{formatDate(req.from_date)}</td>
                      <td style={{ width: `${shiftWidths.to_date || 150}px` }} className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{formatDate(req.to_date || req.from_date)}</td>
                      <td style={{ width: `${shiftWidths.shift || 150}px` }} className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{req.shift}</td>
                      <td style={{ width: `${shiftWidths.type || 150}px` }} className="px-4 py-3 text-sm text-gray-700 border border-gray-300">
                        {req.force ? 'Force (Must)' : 'Forbid (Cannot)'}
                      </td>
                      <td style={{ width: `${shiftWidths.reason || 150}px` }} className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{req.reason || '-'}</td>
                      <td style={{ width: `${shiftWidths.status || 150}px` }} className="px-4 py-3 text-sm border border-gray-300">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          req.status === 'Approved' ? 'bg-green-100 text-green-800' :
                          req.status === 'Rejected' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {req.status}
                        </span>
                      </td>
                      <td style={{ width: `${shiftWidths.submitted || 150}px` }} className="px-4 py-3 text-sm text-gray-500 border border-gray-300">{formatDateTime(req.submitted_at)}</td>
                      <td style={{ width: `${shiftWidths.actions || 200}px` }} className="px-4 py-3 text-sm border border-gray-300">
                        {req.status === 'Pending' ? (
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleApproveShift(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="rounded-full bg-green-600 p-1 text-white shadow hover:bg-green-700 disabled:opacity-60 flex-shrink-0"
                              title="Approve request"
                              aria-label="Approve request"
                            >
                              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5">
                                <path d="M16.25 5.75L8.5 13.5L4.75 9.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleRejectShift(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="rounded-full bg-red-600 p-1 text-white shadow hover:bg-red-700 disabled:opacity-60 flex-shrink-0"
                              title="Reject request"
                              aria-label="Reject request"
                            >
                              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5">
                                <path d="M6 6L14 14M14 6L6 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDeleteShift(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="rounded-full bg-gray-700 p-1 text-white shadow hover:bg-gray-800 disabled:opacity-60 flex-shrink-0"
                              title="Remove request"
                              aria-label="Remove request"
                            >
                              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5">
                                <path d="M5 6H6.66667H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M8.33333 6V4.66667C8.33333 4.31305 8.47381 3.97391 8.72386 3.72386C8.97391 3.47381 9.31305 3.33333 9.66667 3.33333H10.3333C10.687 3.33333 11.0261 3.47381 11.2761 3.72386C11.5262 3.97391 11.6667 4.31305 11.6667 4.66667V6M13.3333 6V15.3333C13.3333 15.687 13.1929 16.0261 12.9428 16.2761C12.6928 16.5262 12.3536 16.6667 12 16.6667H8C7.64638 16.6667 7.30724 16.5262 7.05719 16.2761C6.80714 16.0261 6.66667 15.687 6.66667 15.3333V6H13.3333Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500">
                            {req.approved_by && `By ${req.approved_by}`}
                            {req.approved_at && ` on ${formatDate(req.approved_at)}`}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              {shiftTotalPages > 1 && (
                <Pagination
                  currentPage={shiftPage}
                  totalPages={shiftTotalPages}
                  onPageChange={setShiftPage}
                  itemsPerPage={itemsPerPage}
                  totalItems={sortedShiftRequests.length}
                />
              )}
            </>
          ) : (
            <p className="text-gray-600">No shift requests found for the selected month.</p>
          )}
            </div>
            <div className="mt-8 max-w-8xl pr-6 space-y-3">
              <h4 className="text-lg font-semibold text-gray-900">Schedule View</h4>
              <CalendarView
                monthDate={shiftTableFilterDate!}
                onPrev={() => {
                  if (shiftTableFilterDate) {
                    const newDate = new Date(shiftTableFilterDate.getFullYear(), shiftTableFilterDate.getMonth() - 1, 1);
                    setShiftTableFilterDate(newDate);
                    setShiftCalendarDate(newDate);
                  }
                }}
                onNext={() => {
                  if (shiftTableFilterDate) {
                    const newDate = new Date(shiftTableFilterDate.getFullYear(), shiftTableFilterDate.getMonth() + 1, 1);
                    setShiftTableFilterDate(newDate);
                    setShiftCalendarDate(newDate);
                  }
                }}
                entries={shiftCalendarEntries}
                emptyMessage="No shift requests for the selected month."
                selectedEntryId={selectedCalendarEntryId}
                onSelectEntry={(entry) =>
                  setSelectedCalendarEntryId(entry ? `${entry.requestType}-${entry.requestId}` : null)
                }
                actions={{
                  approve: (entry) => handleCalendarEntryAction(entry, 'approve'),
                  reject: (entry) => handleCalendarEntryAction(entry, 'reject'),
                  remove: (entry) => handleCalendarEntryAction(entry, 'remove'),
                }}
                processingRequestId={processingRequest}
              />
            </div>
          </>
          )}
        </div>
      )}

      {/* User Accounts Tab */}
      {activeTab === 'users' && (
        <>
      {/* Display Current Users */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h3 className="text-xl font-bold text-gray-900 mb-4">Employee User Accounts</h3>
        {users.length > 0 ? (
          <>
          <SearchBar
            searchTerm={usersSearchTerm}
            onSearchChange={setUsersSearchTerm}
            placeholder="Search users by username, employee name, or type..."
          />
          <div className="overflow-x-auto">
            <table ref={usersTableRef} className="min-w-full divide-y divide-gray-200 border border-gray-300" style={{ tableLayout: 'auto', width: '100%' }}>
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th key="username" style={{ width: `${usersWidths.username || 200}px`, maxWidth: `${usersWidths.username || 200}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300 bg-gray-50 overflow-hidden">
                    <div className="flex items-center space-x-1 truncate">
                      <span className="truncate">Username</span>
                      <button onClick={() => handleUsersSort('username')} className="p-1 hover:bg-gray-200 rounded text-xs flex-shrink-0" title="Sort by username">
                        {usersSortConfig?.key === 'username' ? (usersSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                      </button>
                    </div>
                    <div onMouseDown={(e) => usersHandleMouseDown(e, 'username')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${usersResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                  </th>
                  <th key="employee_name" style={{ width: `${usersWidths.employee_name || 200}px`, maxWidth: `${usersWidths.employee_name || 200}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300 bg-gray-50 overflow-hidden">
                    <div className="flex items-center space-x-1 truncate">
                      <span className="truncate">Employee Name</span>
                      <button onClick={() => handleUsersSort('employee_name')} className="p-1 hover:bg-gray-200 rounded text-xs flex-shrink-0" title="Sort by employee name">
                        {usersSortConfig?.key === 'employee_name' ? (usersSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                      </button>
                    </div>
                    <div onMouseDown={(e) => usersHandleMouseDown(e, 'employee_name')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${usersResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                  </th>
                  <th key="employee_type" style={{ width: `${usersWidths.employee_type || 200}px`, maxWidth: `${usersWidths.employee_type || 200}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300 bg-gray-50 overflow-hidden">
                    <div className="flex items-center space-x-1 truncate">
                      <span className="truncate">Employee Type</span>
                      <button onClick={() => handleUsersSort('employee_type')} className="p-1 hover:bg-gray-200 rounded text-xs flex-shrink-0" title="Sort by employee type">
                        {usersSortConfig?.key === 'employee_type' ? (usersSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                      </button>
                    </div>
                    <div onMouseDown={(e) => usersHandleMouseDown(e, 'employee_type')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${usersResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                  </th>
                  <th key="password" style={{ width: `${usersWidths.password || 200}px`, maxWidth: `${usersWidths.password || 200}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300 bg-gray-50 overflow-hidden">
                    <div className="truncate">Password</div>
                    <div onMouseDown={(e) => usersHandleMouseDown(e, 'password')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${usersResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                  </th>
                  <th key="actions" style={{ width: `${usersWidths.actions || 150}px`, maxWidth: `${usersWidths.actions || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300 bg-gray-50 overflow-hidden">
                    <div className="truncate">Actions</div>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                  {paginatedUsers.map((user, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td style={{ width: `${usersWidths.username || 200}px`, maxWidth: `${usersWidths.username || 200}px` }} className="px-6 py-4 text-sm font-medium text-gray-900 border border-gray-300 overflow-hidden">
                      <div className="truncate" title={user.username}>
                        {user.username}
                      </div>
                    </td>
                    <td style={{ width: `${usersWidths.employee_name || 200}px`, maxWidth: `${usersWidths.employee_name || 200}px` }} className="px-6 py-4 text-sm text-gray-500 border border-gray-300 overflow-hidden">
                      <div className="truncate" title={user.employee_name}>
                        {user.employee_name}
                      </div>
                    </td>
                    <td style={{ width: `${usersWidths.employee_type || 200}px`, maxWidth: `${usersWidths.employee_type || 200}px` }} className="px-6 py-4 text-sm text-gray-500 border border-gray-300 overflow-hidden">
                      <div className="truncate" title={user.employee_type}>
                        {user.employee_type}
                      </div>
                    </td>
                    <td style={{ width: `${usersWidths.password || 200}px`, maxWidth: `${usersWidths.password || 200}px` }} className="px-6 py-4 text-sm text-gray-500 border border-gray-300 overflow-hidden">
                      <div className="truncate" title={user.password_hidden}>
                        {user.password_hidden ? (user.password_hidden.length > 8 ? '*'.repeat(8) : user.password_hidden) : '-'}
                      </div>
                    </td>
                    <td style={{ width: `${usersWidths.actions || 150}px`, maxWidth: `${usersWidths.actions || 150}px` }} className="px-6 py-4 text-sm border border-gray-300 overflow-hidden">
                      <button
                        onClick={() => handleDeleteUser(user.username, user.employee_name)}
                        disabled={deleting === user.username || user.username === currentUser?.username}
                        className="text-red-600 hover:text-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={user.username === currentUser?.username ? "Cannot delete your own account" : "Delete user account"}
                        aria-label="Delete user account"
                      >
                        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                          <path d="M3 6h14M8 6V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2m3 0v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM8 9v6M12 9v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            {usersTotalPages > 1 && (
              <Pagination
                currentPage={usersPage}
                totalPages={usersTotalPages}
                onPageChange={setUsersPage}
                itemsPerPage={itemsPerPage}
                totalItems={sortedUsers.length}
              />
            )}
          </>
        ) : (
          <p className="text-gray-600">No users found.</p>
        )}
      </div>

      {/* Edit User Form */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-xl font-bold text-gray-900 mb-4">Edit User Account</h3>
        <form onSubmit={handleUpdateUser} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Employee
              </label>
              <select
                value={selectedEmployee}
                onChange={(e) => {
                  setSelectedEmployee(e.target.value);
                  // Find existing user type if user exists
                  const username = getUsername(e.target.value);
                  const existingUser = users.find(u => u.username === username);
                  if (existingUser) {
                    setEmployeeType(existingUser.employee_type);
                  } else {
                    setEmployeeType('Staff');
                  }
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
              >
                <option value="">Select Employee...</option>
                {employees.map(emp => (
                  <option key={emp.employee} value={emp.employee}>
                    {emp.employee}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Username
              </label>
              <input
                type="text"
                value={selectedEmployee ? getUsername(selectedEmployee) : ''}
                disabled
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-500"
              />
              <p className="text-xs text-gray-500 mt-1">Username cannot be changed</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                placeholder="Leave empty to keep current password"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Employee Type
              </label>
              <select
                value={employeeType}
                onChange={(e) => setEmployeeType(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
              >
                <option value="Staff">Staff</option>
                <option value="Manager">Manager</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={updating || !selectedEmployee}
              className="px-6 py-3 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updating ? 'Updating...' : 'Update User Account'}
            </button>
          </div>
        </form>
      </div>
        </>
      )}

    </div>
  );
};

