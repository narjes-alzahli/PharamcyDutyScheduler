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
import {
  collectOverlappingPendingOrApproved,
  normalizeRequestYmd,
  type OverlapRecord,
} from '../utils/requestOverlaps';
import {
  clearRamadanDateOverride,
  getRamadanPeriodWindow,
  getRamadanPeriodWindows,
  isDateInWindow,
  setRamadanDateOverride,
} from '../utils/ramadanPeriods';

interface User {
  username: string;
  employee_name: string;
  employee_type: string;
  staff_no?: string | null;
  start_date?: string | null;
  password_hidden: string;
  pending_off?: number | null;
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

interface RamadanDateRow {
  year: number;
  start_date: string;
  end_date: string;
  source: string;
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
  const [editingEmployeeName, setEditingEmployeeName] = useState('');
  const [editingUsername, setEditingUsername] = useState('');
  const [editingPendingOff, setEditingPendingOff] = useState<number>(0);
  const [newPassword, setNewPassword] = useState('');
  const [employeeType, setEmployeeType] = useState('Staff');
  const [showEditUser, setShowEditUser] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'ramadan' | 'requests' | 'leave' | 'shift'>('users');
  const [poSyncStatus, setPoSyncStatus] = useState<{
    requires_sync: boolean;
    reason: string;
    target?: {
      kind: 'month' | 'period';
      year: number;
      month: number;
      selected_period?: string | null;
      label: string;
      start_date: string;
    };
  } | null>(null);
  const [syncingPo, setSyncingPo] = useState(false);
  const PO_SYNC_IGNORE_KEY = 'po_sync_ignore_target';
  const getPoSyncTargetId = (status?: {
    target?: { kind: 'month' | 'period'; year: number; month: number; selected_period?: string | null };
  } | null) => {
    const t = status?.target;
    if (!t) return null;
    return `${t.kind}:${t.year}:${t.month}:${t.selected_period || ''}`;
  };
  const [requestFilter, setRequestFilter] = useState<'all' | 'leave' | 'shift'>('all');
  const [leaveTableExpanded, setLeaveTableExpanded] = useState(false);
  const [shiftTableExpanded, setShiftTableExpanded] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserStaffNo, setNewUserStaffNo] = useState('');
  const [newUserStartDate, setNewUserStartDate] = useState('2025-10-01');
  const [newUserType, setNewUserType] = useState('Staff');
  const [editingStaffNo, setEditingStaffNo] = useState('');
  const [editingStartDate, setEditingStartDate] = useState('2025-10-01');
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [shiftRequests, setShiftRequests] = useState<any[]>([]);
  const [processingRequest, setProcessingRequest] = useState<string | null>(null);
  const [pendingOverlapApprove, setPendingOverlapApprove] = useState<{
    requestId: string;
    type: 'leave' | 'shift';
    overlaps: OverlapRecord[];
  } | null>(null);
  const hasInitialDataLoaded = useRef(false);
  
  // Resizable columns for leave requests table
  const leaveTableColumns = ['employee', 'from_date', 'to_date', 'type', 'reason', 'status', 'submitted', 'actions'];
  const { columnWidths: leaveWidths, handleMouseDown: leaveHandleMouseDown, tableRef: leaveTableRef, isResizing: leaveResizing } = useResizableColumns(leaveTableColumns, 150);
  
  // Resizable columns for shift requests table
  const shiftTableColumns = ['employee', 'from_date', 'to_date', 'shift', 'type', 'status', 'submitted', 'actions'];
  const { columnWidths: shiftWidths, handleMouseDown: shiftHandleMouseDown, tableRef: shiftTableRef, isResizing: shiftResizing } = useResizableColumns(shiftTableColumns, 150);
  
  // Resizable columns for users table
  const usersTableColumns = ['username', 'employee_name', 'staff_no', 'employee_type', 'start_date', 'pending_off', 'password', 'actions'];
  const { columnWidths: usersWidths, handleMouseDown: usersHandleMouseDown, tableRef: usersTableRef, isResizing: usersResizing } = useResizableColumns(usersTableColumns, 200);
  
  
  // Enrich users with pending_off data from employees
  const usersWithPendingOff = useMemo(() => {
    return users.map(user => {
      if (user.employee_type === 'Manager') {
        return { ...user, pending_off: null }; // Managers have N/A
      }
      const employee = employees.find(emp => emp.employee === user.employee_name);
      return { ...user, pending_off: employee?.pending_off ?? null };
    });
  }, [users, employees]);

  // Search and sort for users
  const { searchTerm: usersSearchTerm, setSearchTerm: setUsersSearchTerm, filteredData: searchedUsers } = useTableSearch(usersWithPendingOff, ['username', 'employee_name', 'staff_no', 'employee_type', 'start_date']);
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
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null); // 'pre-ramadan', 'ramadan', 'post-ramadan', or null
  const [ramadanDates, setRamadanDates] = useState<RamadanDateRow[]>([]);
  const [loadingRamadanDates, setLoadingRamadanDates] = useState(false);
  const [savingRamadanYear, setSavingRamadanYear] = useState<number | null>(null);
  const [deletingRamadanYear, setDeletingRamadanYear] = useState<number | null>(null);
  const [showAddRamadanModal, setShowAddRamadanModal] = useState(false);
  const [newRamadanYear, setNewRamadanYear] = useState<number>(new Date().getFullYear());
  const [newRamadanFrom, setNewRamadanFrom] = useState<string>('');
  const [newRamadanTo, setNewRamadanTo] = useState<string>('');
  const [showEditRamadanModal, setShowEditRamadanModal] = useState(false);
  const [editRamadanRow, setEditRamadanRow] = useState<RamadanDateRow | null>(null);
  
  // Pagination state
  const [usersPage, setUsersPage] = useState(1);
  const [leavePage, setLeavePage] = useState(1);
  const [shiftPage, setShiftPage] = useState(1);
  const usersItemsPerPage = 30;
  const requestsItemsPerPage = 15;
  
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

  // Generate month options with period options for Ramadan split windows.
  const availableMonthYearOptions = useMemo(() => {
    const allOptions = [...availableLeaveMonthYears, ...availableShiftMonthYears]
      .filter((v, i, a) => a.findIndex(t => t.value === v.value) === i)
      .sort((a, b) => {
        const [aYear, aMonth] = a.value.split('-').map(Number);
        const [bYear, bMonth] = b.value.split('-').map(Number);
        if (aYear !== bYear) return aYear - bYear;
        return aMonth - bMonth;
      });

    const result: Array<{ value: string; label: string; year: number; month: number; period: string | null }> = [];
    const periodOptions: Array<{ value: string; label: string; year: number; month: number; period: string | null }> = [];
    const regularOptions: Array<{ value: string; label: string; year: number; month: number; period: string | null }> = [];
    
    const yearsWithRamadanMonths = new Set<number>();
    allOptions.forEach(opt => {
      const [year, month] = opt.value.split('-').map(Number);
      const windows = getRamadanPeriodWindows(year);
      if (!windows) return;
      const ramadanMonths = new Set<number>([
        windows['pre-ramadan'].primaryMonth,
        windows.ramadan.primaryMonth,
        windows['post-ramadan'].primaryMonth,
      ]);
      if (ramadanMonths.has(month)) yearsWithRamadanMonths.add(year);
    });
    const ramadanAddedByYear = new Set<number>();
    
    allOptions.forEach(opt => {
      const [year, month] = opt.value.split('-').map(Number);
      
      const windows = getRamadanPeriodWindows(year);
      if (!windows) {
        regularOptions.push({ value: opt.value, label: opt.label, year, month, period: null });
        return;
      }
      const preMonth = windows['pre-ramadan'].primaryMonth;
      const postMonth = windows['post-ramadan'].primaryMonth;
      const ramadanMonth = windows.ramadan.primaryMonth;
      if (month === preMonth) {
        periodOptions.push({ value: `${year}-${preMonth}-pre`, label: `Pre-Ramadan ${year}`, year, month: preMonth, period: 'pre-ramadan' });
        periodOptions.push({ value: `${year}-${ramadanMonth}-ramadan`, label: `Ramadan ${year}`, year, month: ramadanMonth, period: 'ramadan' });
        ramadanAddedByYear.add(year);
        return;
      }
      if (month === postMonth) {
        if (!ramadanAddedByYear.has(year)) {
          periodOptions.push({ value: `${year}-${postMonth}-ramadan`, label: `Ramadan ${year}`, year, month: postMonth, period: 'ramadan' });
        }
        periodOptions.push({ value: `${year}-${postMonth}-post`, label: `Post-Ramadan ${year}`, year, month: postMonth, period: 'post-ramadan' });
        return;
      }
      if (month === ramadanMonth) return;
      regularOptions.push({ value: opt.value, label: opt.label, year, month, period: null });
    });
    
    // For Ramadan years, order periods first, then regular months
    if (yearsWithRamadanMonths.size > 0) {
      // Sort periods: pre-ramadan, ramadan, post-ramadan
      periodOptions.sort((a, b) => {
        const periodOrder: { [key: string]: number } = { 'pre-ramadan': 1, 'ramadan': 2, 'post-ramadan': 3 };
        return (periodOrder[a.period || ''] || 0) - (periodOrder[b.period || ''] || 0);
      });
      
      // Sort regular options by year, then month
      regularOptions.sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return a.month - b.month;
      });
      
      // Combine: periods first, then regular months
      return [...periodOptions, ...regularOptions];
    }
    
    // For other years, just sort normally
    return regularOptions.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });
  }, [availableLeaveMonthYears, availableShiftMonthYears]);

  // Get filtered requests based on filter dropdown (must be before date filtering)
  const filteredLeaveRequests = useMemo(() => {
    if (requestFilter === 'all' || requestFilter === 'leave') {
      return leaveRequests;
    }
    return [];
  }, [leaveRequests, requestFilter]);

  const filteredShiftRequests = useMemo(() => {
    if (requestFilter === 'all' || requestFilter === 'shift') {
      return shiftRequests;
    }
    return [];
  }, [shiftRequests, requestFilter]);

  // Get combined month/year for schedule view
  const scheduleMonthDate = useMemo(() => {
    // Use leave table filter date if available, otherwise shift, otherwise null (no selection)
    return leaveTableFilterDate || shiftTableFilterDate || null;
  }, [leaveTableFilterDate, shiftTableFilterDate]);

  useEffect(() => {
    const targetYear = scheduleMonthDate?.getFullYear();
    if (!targetYear) return;
    let cancelled = false;
    dataAPI.getRamadanDates(targetYear)
      .then((rec) => {
        if (cancelled) return;
        if (rec.start_date && rec.end_date) {
          setRamadanDateOverride(targetYear, rec.start_date, rec.end_date, rec.source || undefined);
        } else {
          clearRamadanDateOverride(targetYear);
        }
      })
      .catch(() => {
        clearRamadanDateOverride(targetYear);
      });
    return () => {
      cancelled = true;
    };
  }, [scheduleMonthDate]);

  // Helper function to check if a date is in the selected period
  const isDateInPeriod = (date: Date): boolean => {
    if (!scheduleMonthDate || !selectedPeriod) return true;
    const filterYear = scheduleMonthDate.getFullYear();
    const filterMonth = scheduleMonthDate.getMonth() + 1; // 1-12
    const window = getRamadanPeriodWindow(filterYear, filterMonth, selectedPeriod);
    if (!window) return true;
    return isDateInWindow(date.toISOString().split('T')[0], window);
  };

  // Filter requests by year/month/period for table view (must be after state declarations)
  // Use scheduleMonthDate to sync with schedule view
  const filteredLeaveRequestsByDate = useMemo(() => {
    if (!scheduleMonthDate) return [];
    const filterYear = scheduleMonthDate.getFullYear();
    const filterMonth = scheduleMonthDate.getMonth();
    
    let filtered = filteredLeaveRequests.filter((req: any) => {
      const reqDate = new Date(req.from_date);
      return reqDate.getFullYear() === filterYear && reqDate.getMonth() === filterMonth;
    });
    
    // If period is selected, filter by period
    if (selectedPeriod) {
      filtered = filtered.filter((req: any) => {
        const fromDate = new Date(req.from_date);
        const toDate = new Date(req.to_date);
        // Check if request overlaps with selected period
        let currentDate = new Date(fromDate);
        while (currentDate <= toDate) {
          if (isDateInPeriod(currentDate)) {
            return true;
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
        return false;
      });
    }
    
    return filtered;
  }, [filteredLeaveRequests, scheduleMonthDate, selectedPeriod]);
  
  const filteredShiftRequestsByDate = useMemo(() => {
    if (!scheduleMonthDate) return [];
    const filterYear = scheduleMonthDate.getFullYear();
    const filterMonth = scheduleMonthDate.getMonth();
    
    let filtered = filteredShiftRequests.filter((req: any) => {
      const reqDate = new Date(req.from_date);
      return reqDate.getFullYear() === filterYear && reqDate.getMonth() === filterMonth;
    });
    
    // If period is selected, filter by period
    if (selectedPeriod) {
      filtered = filtered.filter((req: any) => {
        const fromDate = new Date(req.from_date);
        const toDate = new Date(req.to_date);
        // Check if request overlaps with selected period
        let currentDate = new Date(fromDate);
        while (currentDate <= toDate) {
          if (isDateInPeriod(currentDate)) {
            return true;
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
        return false;
      });
    }
    
    return filtered;
  }, [filteredShiftRequests, scheduleMonthDate, selectedPeriod]);
  
  // Search and sort for leave requests (after date filtering)
  const { searchTerm: leaveSearchTerm, setSearchTerm: setLeaveSearchTerm, filteredData: searchedLeaveRequests } = useTableSearch(filteredLeaveRequestsByDate, ['employee', 'leave_type', 'reason', 'status']);
  const { sortedData: sortedLeaveRequests, sortConfig: leaveSortConfig, handleSort: handleLeaveSort } = useTableSort(searchedLeaveRequests);
  
  // Search and sort for shift requests (after date filtering)
  const { searchTerm: shiftSearchTerm, setSearchTerm: setShiftSearchTerm, filteredData: searchedShiftRequests } = useTableSearch(filteredShiftRequestsByDate, ['employee', 'shift', 'reason', 'status']);
  const { sortedData: sortedShiftRequests, sortConfig: shiftSortConfig, handleSort: handleShiftSort } = useTableSort(searchedShiftRequests);

  // Pending counts - filtered by selected month/period if available
  const pendingLeaveCount = useMemo(() => {
    if (scheduleMonthDate) {
      // Use filtered requests by date (which already includes period filtering)
      return filteredLeaveRequestsByDate.filter((req) => req.status === 'Pending').length;
    }
    // If no month selected, show all pending
    return leaveRequests.filter((req) => req.status === 'Pending').length;
  }, [scheduleMonthDate, filteredLeaveRequestsByDate, leaveRequests]);

  const pendingShiftCount = useMemo(() => {
    if (scheduleMonthDate) {
      // Use filtered requests by date (which already includes period filtering)
      return filteredShiftRequestsByDate.filter((req) => req.status === 'Pending').length;
    }
    // If no month selected, show all pending
    return shiftRequests.filter((req) => req.status === 'Pending').length;
  }, [scheduleMonthDate, filteredShiftRequestsByDate, shiftRequests]);
  
  // Total pending count for tab badge (always show all, not filtered)
  const totalPendingCount = useMemo(() => {
    return leaveRequests.filter((req) => req.status === 'Pending').length +
           shiftRequests.filter((req) => req.status === 'Pending').length;
  }, [leaveRequests, shiftRequests]);

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
      const [usersRes, employeesRes, poSyncRes] = await Promise.all([
        api.get('/api/users/'),
        dataAPI.getEmployees(),
        dataAPI.getPendingOffSyncStatus(),
      ]);
      setUsers(usersRes.data);
      setEmployees(employeesRes);
      const ignoredTargetId = localStorage.getItem(PO_SYNC_IGNORE_KEY);
      const currentTargetId = getPoSyncTargetId(poSyncRes);
      const suppressed =
        Boolean(poSyncRes?.requires_sync) &&
        Boolean(currentTargetId) &&
        ignoredTargetId === currentTargetId;
      setPoSyncStatus(
        suppressed
          ? { ...poSyncRes, requires_sync: false, reason: 'ignored_this_time' }
          : poSyncRes,
      );
      if (employeesRes.length > 0) {
        setSelectedEmployee(employeesRes[0].employee);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSyncPendingOff = useCallback(async () => {
    try {
      setSyncingPo(true);
      const result = await dataAPI.syncPendingOff();
      setNotification({
        message: `Synced P/O for ${result.target?.label || 'current target'} (${result.updated} updated).`,
        type: 'success',
      });
      localStorage.removeItem(PO_SYNC_IGNORE_KEY);
      setTimeout(() => setNotification(null), 3000);
      await loadData();
    } catch (error: any) {
      const msg = error.response?.data?.detail || 'Failed to sync pending off';
      setNotification({ message: msg, type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setSyncingPo(false);
    }
  }, [loadData]);

  const handleIgnoreSyncThisTime = useCallback(() => {
    const targetId = getPoSyncTargetId(poSyncStatus);
    if (targetId) {
      localStorage.setItem(PO_SYNC_IGNORE_KEY, targetId);
    }
    setPoSyncStatus((prev) =>
      prev ? { ...prev, requires_sync: false, reason: 'ignored_this_time' } : prev,
    );
  }, [poSyncStatus]);

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
    if (authReady && isManager && activeTab === 'requests') {
      loadRequests();
    }
  }, [activeTab, authReady, isManager, loadRequests]);

  const loadRamadanDates = useCallback(async () => {
    try {
      setLoadingRamadanDates(true);
      const rows = await dataAPI.listRamadanDates();
      setRamadanDates(
        rows
          .filter((r) => r.start_date && r.end_date)
          .map((r) => ({
            year: r.year,
            start_date: r.start_date as string,
            end_date: r.end_date as string,
            source: r.source || 'manual',
          }))
          .sort((a, b) => a.year - b.year),
      );
    } catch (error) {
      console.error('Failed to load Ramadan dates:', error);
      setRamadanDates([]);
    } finally {
      setLoadingRamadanDates(false);
    }
  }, []);

  useEffect(() => {
    if (authReady && isManager && activeTab === 'ramadan') {
      loadRamadanDates();
    }
  }, [activeTab, authReady, isManager, loadRamadanDates]);

  const openAddRamadanModal = () => {
    const nextYear = ramadanDates.length > 0 ? Math.max(...ramadanDates.map((r) => r.year)) + 1 : new Date().getFullYear();
    setNewRamadanYear(nextYear);
    setNewRamadanFrom(`${nextYear}-02-15`);
    setNewRamadanTo(`${nextYear}-03-15`);
    setShowAddRamadanModal(true);
  };

  const handleCreateRamadanRow = async () => {
    if (!newRamadanYear || !newRamadanFrom || !newRamadanTo) {
      setNotification({ message: 'Please fill year, from, and to dates.', type: 'error' });
      setTimeout(() => setNotification(null), 3500);
      return;
    }
    if (newRamadanTo < newRamadanFrom) {
      setNotification({ message: '"To" date must be after or equal to "From" date.', type: 'error' });
      setTimeout(() => setNotification(null), 3500);
      return;
    }
    if (ramadanDates.some((r) => r.year === newRamadanYear)) {
      setNotification({ message: `Year ${newRamadanYear} already exists. Edit it or delete it first.`, type: 'error' });
      setTimeout(() => setNotification(null), 3500);
      return;
    }
    try {
      setSavingRamadanYear(newRamadanYear);
      await dataAPI.saveRamadanDates(newRamadanYear, {
        year: newRamadanYear,
        start_date: newRamadanFrom,
        end_date: newRamadanTo,
        source: 'manual',
      });
      setNotification({ message: `Ramadan dates saved for ${newRamadanYear}.`, type: 'success' });
      setTimeout(() => setNotification(null), 2500);
      setShowAddRamadanModal(false);
      await loadRamadanDates();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to save Ramadan dates', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setSavingRamadanYear(null);
    }
  };

  const openEditRamadanModal = (row: RamadanDateRow) => {
    setEditRamadanRow({ ...row });
    setShowEditRamadanModal(true);
  };

  const handleSaveRamadanRow = async (row: RamadanDateRow) => {
    if (!row.year || !row.start_date || !row.end_date) {
      setNotification({ message: 'Please fill year, from, and to dates.', type: 'error' });
      setTimeout(() => setNotification(null), 3500);
      return;
    }
    if (row.end_date < row.start_date) {
      setNotification({ message: '"To" date must be after or equal to "From" date.', type: 'error' });
      setTimeout(() => setNotification(null), 3500);
      return;
    }
    try {
      setSavingRamadanYear(row.year);
      await dataAPI.saveRamadanDates(row.year, {
        year: row.year,
        start_date: row.start_date,
        end_date: row.end_date,
        source: row.source || 'manual',
      });
      setNotification({ message: `Ramadan dates saved for ${row.year}.`, type: 'success' });
      setTimeout(() => setNotification(null), 2500);
      await loadRamadanDates();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to save Ramadan dates', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setSavingRamadanYear(null);
    }
  };

  const handleDeleteRamadanRow = async (row: RamadanDateRow) => {
    if (!window.confirm(`Delete Ramadan dates for ${row.year}?`)) return;
    try {
      setDeletingRamadanYear(row.year);
      await dataAPI.deleteRamadanDates(row.year);
      setNotification({ message: `Ramadan dates deleted for ${row.year}.`, type: 'success' });
      setTimeout(() => setNotification(null), 2500);
      await loadRamadanDates();
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      if (error.response?.status === 404 || (typeof detail === 'string' && detail.toLowerCase().includes('not found'))) {
        setRamadanDates((prev) => prev.filter((r) => r.year !== row.year));
        setNotification({ message: `Removed unsaved row for ${row.year}.`, type: 'success' });
        setTimeout(() => setNotification(null), 2200);
      } else {
        setNotification({ message: detail || 'Failed to delete Ramadan dates', type: 'error' });
        setTimeout(() => setNotification(null), 4000);
      }
    } finally {
      setDeletingRamadanYear(null);
    }
  };

  const handleSaveRamadanFromModal = async () => {
    if (!editRamadanRow) return;
    await handleSaveRamadanRow(editRamadanRow);
    if (!savingRamadanYear) {
      setShowEditRamadanModal(false);
      setEditRamadanRow(null);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newUserName || !newUserName.trim()) {
      alert('Please enter a display name for the user');
      return;
    }
    
    if (!newUserPassword || newUserPassword.length < 3) {
      alert('Please enter a password (at least 3 characters)');
      return;
    }

    try {
      setUpdating(true);
      await usersAPI.createUser({
        employee_name: newUserName.trim(),
        password: newUserPassword,
        employee_type: newUserType,
        staff_no: newUserStaffNo.trim() || undefined,
        start_date: newUserStartDate || undefined,
      });
      
      setNotification({ message: '✅ User created successfully! Staff users get a roster skills profile automatically.', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
      setNewUserName('');
      setNewUserPassword('');
      setNewUserStaffNo('');
      setNewUserStartDate('2025-10-01');
      setNewUserType('Staff');
      setShowCreateUser(false);
      await loadData();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to create user', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setUpdating(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedEmployee) {
      alert('Please select a staff member');
      return;
    }

    if (!editingEmployeeName || !editingEmployeeName.trim()) {
      setUsernameError('Display name cannot be empty');
      return;
    }

    if (!editingUsername || !editingUsername.trim()) {
      setUsernameError('Username cannot be empty');
      return;
    }

    // Check if username is unique (excluding current user)
    const trimmedUsername = editingUsername.trim().toLowerCase();
    const existingUser = users.find(u => 
      u.username.toLowerCase() === trimmedUsername && 
      u.username !== (window as any).editingOldUsername
    );
    if (existingUser) {
      setUsernameError('Username already exists. Please choose a different username.');
      return;
    }

    setUsernameError(null);

    try {
      setUpdating(true);
      const oldUsername = (window as any).editingOldUsername || selectedEmployee ? getUsername(selectedEmployee) : '';
      await api.put('/api/users/', {
        employee_name: editingEmployeeName.trim(),
        username: editingUsername.trim(),
        old_username: oldUsername,
        password: newPassword || undefined,
        employee_type: employeeType,
        pending_off: employeeType === 'Staff' ? editingPendingOff : undefined,
        staff_no: editingStaffNo.trim(),
        start_date: editingStartDate || null,
      });
      
      setNotification({ message: '✅ User account updated successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      setNewPassword('');
      setSelectedEmployee('');
      setEditingEmployeeName('');
      setEditingUsername('');
      setEditingStartDate('2025-10-01');
      setShowEditUser(false);
      (window as any).editingOldUsername = undefined;
      await loadData();
    } catch (error: any) {
      const errorMessage = error.response?.data?.detail || 'Failed to update user account';
      if (errorMessage.includes('Username already exists') || errorMessage.includes('username')) {
        setUsernameError(errorMessage);
      } else {
        setNotification({ message: errorMessage, type: 'error' });
        setTimeout(() => setNotification(null), 4000);
      }
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

  const performApproveLeave = async (requestId: string, overlaps: OverlapRecord[]) => {
    try {
      setProcessingRequest(requestId);
      for (const o of overlaps) {
        if (o.type === 'leave') {
          await requestsAPI.rejectLeaveRequest(o.request_id);
        } else {
          await requestsAPI.rejectShiftRequest(o.request_id);
        }
      }
      setLeaveRequests((prev) =>
        prev.map((r) => (r.request_id === requestId ? { ...r, status: 'Approved' as const } : r))
      );
      await requestsAPI.approveLeaveRequest(requestId);
      setNotification({
        message: '✅ Leave request approved successfully! It has been added to the roster.',
        type: 'success',
      });
      setTimeout(() => setNotification(null), 3000);
      await loadRequests(true);
    } catch (error: any) {
      await loadRequests(true);
      setNotification({
        message: error.response?.data?.detail || 'Failed to approve leave request',
        type: 'error',
      });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleApproveLeave = async (requestId: string) => {
    const req = leaveRequests.find((r) => r.request_id === requestId);
    if (!req) return;

    const overlaps = collectOverlappingPendingOrApproved(
      req.employee,
      requestId,
      'leave',
      req.from_date,
      req.to_date,
      leaveRequests,
      shiftRequests
    );

    if (overlaps.length > 0) {
      setSelectedCalendarEntryId(null);
      setPendingOverlapApprove({ requestId, type: 'leave', overlaps });
      return;
    }

    await performApproveLeave(requestId, []);
  };

  const performApproveShift = async (requestId: string, overlaps: OverlapRecord[]) => {
    try {
      setProcessingRequest(requestId);
      for (const o of overlaps) {
        if (o.type === 'leave') {
          await requestsAPI.rejectLeaveRequest(o.request_id);
        } else {
          await requestsAPI.rejectShiftRequest(o.request_id);
        }
      }
      setShiftRequests((prev) =>
        prev.map((r) => (r.request_id === requestId ? { ...r, status: 'Approved' as const } : r))
      );
      await requestsAPI.approveShiftRequest(requestId);
      setNotification({
        message: '✅ Shift request approved successfully! It has been added to the roster.',
        type: 'success',
      });
      setTimeout(() => setNotification(null), 3000);
      await loadRequests(true);
    } catch (error: any) {
      await loadRequests(true);
      setNotification({
        message: error.response?.data?.detail || 'Failed to approve shift request',
        type: 'error',
      });
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
      // Optimistically update the UI immediately
      setLeaveRequests(prev => prev.map(req => 
        req.request_id === requestId ? { ...req, status: 'Rejected' as const } : req
      ));
      await requestsAPI.rejectLeaveRequest(requestId);
      setNotification({ message: 'Leave request rejected', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      // Use isRefresh=true to prevent clearing data during refresh
      await loadRequests(true);
    } catch (error: any) {
      // Revert optimistic update on error
      await loadRequests(true);
      setNotification({ message: error.response?.data?.detail || 'Failed to reject leave request', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleApproveShift = async (requestId: string) => {
    const req = shiftRequests.find((r) => r.request_id === requestId);
    if (!req) return;

    const overlaps = collectOverlappingPendingOrApproved(
      req.employee,
      requestId,
      'shift',
      req.from_date,
      req.to_date,
      leaveRequests,
      shiftRequests
    );

    if (overlaps.length > 0) {
      setSelectedCalendarEntryId(null);
      setPendingOverlapApprove({ requestId, type: 'shift', overlaps });
      return;
    }

    await performApproveShift(requestId, []);
  };

  const handleOverlapApproveConfirm = async () => {
    if (!pendingOverlapApprove) return;
    const { requestId, type, overlaps } = pendingOverlapApprove;
    setPendingOverlapApprove(null);
    setSelectedCalendarEntryId(null);
    if (type === 'leave') {
      await performApproveLeave(requestId, overlaps);
    } else {
      await performApproveShift(requestId, overlaps);
    }
  };

  const handleRejectShift = async (requestId: string) => {
    if (!window.confirm('Are you sure you want to reject this shift request?')) {
      return;
    }
    try {
      setProcessingRequest(requestId);
      // Optimistically update the UI immediately
      setShiftRequests(prev => prev.map(req => 
        req.request_id === requestId ? { ...req, status: 'Rejected' as const } : req
      ));
      await requestsAPI.rejectShiftRequest(requestId);
      setNotification({ message: 'Shift request rejected', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      // Use isRefresh=true to prevent clearing data during refresh
      await loadRequests(true);
    } catch (error: any) {
      // Revert optimistic update on error
      await loadRequests(true);
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
      // Optimistically remove from UI immediately
      setLeaveRequests(prev => prev.filter(req => req.request_id !== requestId));
      await requestsAPI.deleteLeaveRequest(requestId);
      setNotification({ message: 'Leave request removed.', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      // Use isRefresh=true to prevent clearing data during refresh
      await loadRequests(true);
    } catch (error: any) {
      // Revert optimistic update on error
      await loadRequests(true);
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
      // Optimistically remove from UI immediately
      setShiftRequests(prev => prev.filter(req => req.request_id !== requestId));
      await requestsAPI.deleteShiftRequest(requestId);
      setNotification({ message: 'Shift request removed.', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      // Use isRefresh=true to prevent clearing data during refresh
      await loadRequests(true);
    } catch (error: any) {
      // Revert optimistic update on error
      await loadRequests(true);
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

  const handleCalendarEntryAction = (entry: CalendarEntry, action: 'approve' | 'reject' | 'remove') => {
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
  };

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
    const start = (usersPage - 1) * usersItemsPerPage;
    const end = start + usersItemsPerPage;
    return sortedUsers.slice(start, end);
  }, [sortedUsers, usersPage, usersItemsPerPage]);
  
  const paginatedLeaveRequests = useMemo(() => {
    const start = (leavePage - 1) * requestsItemsPerPage;
    const end = start + requestsItemsPerPage;
    return sortedLeaveRequests.slice(start, end);
  }, [sortedLeaveRequests, leavePage, requestsItemsPerPage]);
  
  const paginatedShiftRequests = useMemo(() => {
    const start = (shiftPage - 1) * requestsItemsPerPage;
    const end = start + requestsItemsPerPage;
    return sortedShiftRequests.slice(start, end);
  }, [sortedShiftRequests, shiftPage, requestsItemsPerPage]);

  const usersTotalPages = Math.ceil(sortedUsers.length / usersItemsPerPage);
  const leaveTotalPages = Math.ceil(sortedLeaveRequests.length / requestsItemsPerPage);
  const shiftTotalPages = Math.ceil(sortedShiftRequests.length / requestsItemsPerPage);

  // MAJOR RESTRUCTURE: Show loading while auth is being verified
  // This prevents components from rendering and making API calls before auth is ready
  if (authLoading || !authReady) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Management</h2>
        <LoadingSkeleton type="list" rows={5} />
      </div>
    );
  }

  // If auth is ready but user is not a Manager (shouldn't happen due to ProtectedRoute, but be safe)
  if (!isManager || !currentUser) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Management</h2>
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
          You don't have permission to access this page.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Management</h2>
        <LoadingSkeleton type="list" rows={5} />
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Management</h2>
      
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

      {pendingOverlapApprove && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-50">
          <div className="mx-4 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Overlapping requests</h3>
            <p className="mb-3 text-sm text-gray-600">
              {(() => {
                const target =
                  pendingOverlapApprove.type === 'leave'
                    ? leaveRequests.find((r) => r.request_id === pendingOverlapApprove.requestId)
                    : shiftRequests.find((r) => r.request_id === pendingOverlapApprove.requestId);
                if (!target) {
                  return 'This request could not be loaded.';
                }
                const kind = pendingOverlapApprove.type === 'leave' ? 'Leave' : 'Shift';
                const code =
                  pendingOverlapApprove.type === 'leave'
                    ? (target as { leave_type?: string }).leave_type ?? '—'
                    : (target as { shift?: string }).shift ?? '—';
                const fromY = normalizeRequestYmd(target.from_date);
                const toY = normalizeRequestYmd(target.to_date);
                return (
                  <>
                    In order to approve this request, you must reject the following overlapping requests first:
                  </>
                );
              })()}
            </p>
            <ul className="mb-6 max-h-48 space-y-2 overflow-y-auto border border-gray-200 rounded-md p-3 text-sm text-gray-800">
              {pendingOverlapApprove.overlaps.map((o) => (
                <li key={`${o.type}-${o.request_id}`} className="border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                  <span className="font-medium text-gray-900">{o.employee}</span>
                  {' · '}
                  {o.code}
                  {' · '}
                  {o.from_ymd} → {o.to_ymd}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingOverlapApprove(null)}
                disabled={processingRequest !== null}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleOverlapApproveConfirm()}
                disabled={processingRequest !== null}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                Reject conflicting &amp; approve
              </button>
            </div>
          </div>
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
              onClick={() => setActiveTab('ramadan')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'ramadan'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span>Ramadan Dates</span>
            </button>
            <button
              onClick={() => setActiveTab('requests')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'requests'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span>Request History</span>
            </button>
          </nav>
        </div>
      )}

      {activeTab === 'ramadan' && isManager && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-900">Ramadan Dates</h3>
            <button
              onClick={openAddRamadanModal}
              className="px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
            >
              + Add Year
            </button>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Manage Ramadan date windows by year. These dates will result in Pre-Ramadan, Ramadan, and Post-Ramadan period splits.
          </p>
          {loadingRamadanDates ? (
            <LoadingSkeleton type="list" rows={4} />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border border-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Year</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">From</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">To</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {ramadanDates.map((row, index) => (
                    <tr key={`${row.year}-${index}`}>
                      <td className="px-4 py-3 border border-gray-300 text-sm text-gray-900">{row.year}</td>
                      <td className="px-4 py-3 border border-gray-300 text-sm text-gray-700">{row.start_date}</td>
                      <td className="px-4 py-3 border border-gray-300 text-sm text-gray-700">{row.end_date}</td>
                      <td className="px-4 py-3 border border-gray-300 text-sm">
                        {row.source === 'pending' ? (
                          <span
                            className="inline-flex cursor-help items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 border border-gray-300"
                            title="This year is not saved to the database yet. Open Edit and click Save. If it still shows Not Added after that, contact whoever maintains this app (developer or IT)."
                          >
                            Not Added
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 border border-green-300">
                            Added
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 border border-gray-300">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditRamadanModal(row)}
                            className="text-blue-600 hover:text-blue-800"
                            title="Edit Ramadan dates"
                            aria-label={`Edit Ramadan dates for ${row.year}`}
                          >
                            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                              <path d="M11 3H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 0 3L12 12l-4 1 1-4 6.5-6.5a2.121 2.121 0 0 1 3 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                          <button
                            onClick={() => void handleDeleteRamadanRow(row)}
                            disabled={deletingRamadanYear === row.year}
                            className="text-red-600 hover:text-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Delete"
                            aria-label={`Delete Ramadan dates for ${row.year}`}
                          >
                            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                              <path d="M3 6h14M8 6V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2m3 0v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM8 9v6M12 9v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {ramadanDates.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-gray-500 border border-gray-300">
                        No Ramadan dates configured yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showAddRamadanModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Add Ramadan Year</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                <input
                  type="number"
                  value={newRamadanYear}
                  onChange={(e) => setNewRamadanYear(parseInt(e.target.value || '0', 10))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
                <input
                  type="date"
                  value={newRamadanFrom}
                  onChange={(e) => setNewRamadanFrom(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
                <input
                  type="date"
                  value={newRamadanTo}
                  onChange={(e) => setNewRamadanTo(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowAddRamadanModal(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreateRamadanRow()}
                disabled={savingRamadanYear === newRamadanYear}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60"
              >
                {savingRamadanYear === newRamadanYear ? 'Saving...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditRamadanModal && editRamadanRow && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Edit Ramadan Dates</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                <input
                  type="number"
                  value={editRamadanRow.year}
                  onChange={(e) => setEditRamadanRow({ ...editRamadanRow, year: parseInt(e.target.value || '0', 10) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
                <input
                  type="date"
                  value={editRamadanRow.start_date}
                  onChange={(e) => setEditRamadanRow({ ...editRamadanRow, start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
                <input
                  type="date"
                  value={editRamadanRow.end_date}
                  onChange={(e) => setEditRamadanRow({ ...editRamadanRow, end_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => {
                  setShowEditRamadanModal(false);
                  setEditRamadanRow(null);
                }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSaveRamadanFromModal()}
                disabled={savingRamadanYear === editRamadanRow.year}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60"
              >
                {savingRamadanYear === editRamadanRow.year ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unified Requests Tab */}
      {activeTab === 'requests' && isManager && (
        <div className="space-y-6">
          {/* Filter Dropdown and Month/Year Selector */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="text-sm font-medium text-gray-700">Filter:</label>
                <select
                  value={requestFilter}
                  onChange={(e) => setRequestFilter(e.target.value as 'all' | 'leave' | 'shift')}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="all">All Requests</option>
                  <option value="leave">Leave Requests</option>
                  <option value="shift">Shift Requests</option>
                </select>
                <label className="text-sm font-medium text-gray-700">Select Month/Year:</label>
                <select
                  value={scheduleMonthDate ? (() => {
                    const year = scheduleMonthDate.getFullYear();
                    const month = scheduleMonthDate.getMonth() + 1;
                    if (selectedPeriod) {
                      const window = getRamadanPeriodWindow(year, month, selectedPeriod);
                      if (window) {
                        if (selectedPeriod === 'pre-ramadan') return `${year}-${month}-pre`;
                        if (selectedPeriod === 'ramadan') return `${year}-${month}-ramadan`;
                        if (selectedPeriod === 'post-ramadan') return `${year}-${month}-post`;
                      }
                    }
                    return `${year}-${month}`;
                  })() : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      const parts = e.target.value.split('-');
                      const year = parseInt(parts[0]);
                      const month = parseInt(parts[1]);
                      
                      if (parts.length === 3 && parts[2] === 'pre') {
                        setSelectedPeriod('pre-ramadan');
                        setLeaveTableFilterDate(new Date(year, 1, 1));
                        setShiftTableFilterDate(new Date(year, 1, 1));
                      } else if (parts.length === 3 && parts[2] === 'ramadan') {
                        setSelectedPeriod('ramadan');
                        setLeaveTableFilterDate(new Date(year, month - 1, 1));
                        setShiftTableFilterDate(new Date(year, month - 1, 1));
                      } else if (parts.length === 3 && parts[2] === 'post') {
                        setSelectedPeriod('post-ramadan');
                        setLeaveTableFilterDate(new Date(year, 2, 1));
                        setShiftTableFilterDate(new Date(year, 2, 1));
                      } else {
                        setSelectedPeriod(null);
                        setLeaveTableFilterDate(new Date(year, month - 1, 1));
                        setShiftTableFilterDate(new Date(year, month - 1, 1));
                      }
                    } else {
                      setLeaveTableFilterDate(null);
                      setShiftTableFilterDate(null);
                      setSelectedPeriod(null);
                    }
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 min-w-[200px]"
                >
                  <option value="">Select Month & Year...</option>
                  {availableMonthYearOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                </div>
              </div>
              {(pendingLeaveCount + pendingShiftCount) > 0 && (
                <span className="text-sm text-gray-500">
                  {pendingLeaveCount + pendingShiftCount} pending approval{(pendingLeaveCount + pendingShiftCount) > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {!scheduleMonthDate ? (
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <p className="text-gray-600 text-center py-8">Please select a month and year.</p>
            </div>
          ) : (
            <>
              {/* Collapsible Leave Requests Table - Only show when filter is 'all' or 'leave' */}
              {(requestFilter === 'all' || requestFilter === 'leave') && (
                <div className="bg-white rounded-lg shadow p-6 mb-6">
                  <button
                    onClick={() => setLeaveTableExpanded(!leaveTableExpanded)}
                    className="flex items-center justify-between w-full text-left mb-4"
                  >
                    <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                      {leaveTableExpanded ? '▼' : '▶'} Leave Requests
                    </h3>
                  </button>
                  {leaveTableExpanded && (
                  <>
                    {filteredLeaveRequestsByDate.length > 0 ? (
                      <>
                        <SearchBar
                          searchTerm={leaveSearchTerm}
                          onSearchChange={setLeaveSearchTerm}
                          placeholder="Search leave requests by staff name, type, reason, or status..."
                        />
                        <div className="overflow-x-auto mt-4">
                          <table ref={leaveTableRef} className="min-w-full divide-y divide-gray-200 border border-gray-300" style={{ tableLayout: 'auto', width: '100%' }}>
                            <thead className="bg-gray-50 sticky top-0 z-10">
                              <tr>
                                <th key="employee" style={{ width: `${leaveWidths.employee || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                                  <div className="flex items-center space-x-1">
                                    <span>Staff</span>
                                    <button onClick={() => handleLeaveSort('employee')} className="p-1 hover:bg-gray-200 rounded text-xs" title="Sort by staff name">
                                      {leaveSortConfig?.key === 'employee' ? (leaveSortConfig?.direction === 'asc' ? '↑' : '↓') : '↕'}
                                    </button>
                                  </div>
                                  <div onMouseDown={(e) => leaveHandleMouseDown(e, 'employee')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                                </th>
                                <th key="from_date" style={{ width: `${leaveWidths.from_date || 150}px`, position: 'relative' }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 whitespace-nowrap min-w-[120px]">
                                  <div className="flex items-center space-x-1">
                                    <span>From Date</span>
                                    <button onClick={() => handleLeaveSort('from_date')} className="p-1 hover:bg-gray-200 rounded">
                                      {leaveSortConfig?.key === 'from_date' ? (leaveSortConfig?.direction === 'asc' ? '↑' : '↓') : '↕'}
                                    </button>
                                  </div>
                                  <div onMouseDown={(e) => leaveHandleMouseDown(e, 'from_date')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                                </th>
                                <th key="to_date" style={{ width: `${leaveWidths.to_date || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50 whitespace-nowrap min-w-[120px]">
                                  <div className="flex items-center space-x-1">
                                    <span>To Date</span>
                                    <button onClick={() => handleLeaveSort('to_date')} className="p-1 hover:bg-gray-200 rounded">
                                      {leaveSortConfig?.key === 'to_date' ? (leaveSortConfig?.direction === 'asc' ? '↑' : '↓') : '↕'}
                                    </button>
                                  </div>
                                  <div onMouseDown={(e) => leaveHandleMouseDown(e, 'to_date')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                                </th>
                                <th key="type" style={{ width: `${leaveWidths.type || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                                  <div className="flex items-center space-x-1">
                                    <span>Type</span>
                                    <button onClick={() => handleLeaveSort('leave_type')} className="p-1 hover:bg-gray-200 rounded">
                                      {leaveSortConfig?.key === 'leave_type' ? (leaveSortConfig?.direction === 'asc' ? '↑' : '↓') : '↕'}
                                    </button>
                                  </div>
                                  <div onMouseDown={(e) => leaveHandleMouseDown(e, 'type')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                                </th>
                                <th key="reason" style={{ width: `${leaveWidths.reason || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                                  <div className="flex items-center space-x-1">
                                    <span>Reason</span>
                                    <button onClick={() => handleLeaveSort('reason')} className="p-1 hover:bg-gray-200 rounded">
                                      {leaveSortConfig?.key === 'reason' ? (leaveSortConfig?.direction === 'asc' ? '↑' : '↓') : '↕'}
                                    </button>
                                  </div>
                                  <div onMouseDown={(e) => leaveHandleMouseDown(e, 'reason')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                                </th>
                                <th key="status" style={{ width: `${leaveWidths.status || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                                  <div className="flex items-center space-x-1">
                                    <span>Status</span>
                                    <button onClick={() => handleLeaveSort('status')} className="p-1 hover:bg-gray-200 rounded">
                                      {leaveSortConfig?.key === 'status' ? (leaveSortConfig?.direction === 'asc' ? '↑' : '↓') : '↕'}
                                    </button>
                                  </div>
                                  <div onMouseDown={(e) => leaveHandleMouseDown(e, 'status')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                                </th>
                                <th key="submitted" style={{ width: `${leaveWidths.submitted || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                                  <div className="flex items-center space-x-1">
                                    <span>Submitted</span>
                                    <button onClick={() => handleLeaveSort('submitted_at')} className="p-1 hover:bg-gray-200 rounded">
                                      {leaveSortConfig?.key === 'submitted_at' ? (leaveSortConfig?.direction === 'asc' ? '↑' : '↓') : '↕'}
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
                                    <div className="flex gap-1">
                                      {req.status !== 'Approved' && (
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
                                      )}
                                      {req.status !== 'Rejected' && (
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
                                      )}
                                    </div>
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
                                  itemsPerPage={requestsItemsPerPage}
                            totalItems={sortedLeaveRequests.length}
                          />
                        )}
                      </>
                    ) : (
                      <p className="text-gray-600">No leave requests found for the selected month.</p>
                    )}
                  </>
                  )}
                </div>
              )}

              {/* Collapsible Shift Requests Table - Only show when filter is 'all' or 'shift' */}
              {(requestFilter === 'all' || requestFilter === 'shift') && (
                <div className="bg-white rounded-lg shadow p-6 mb-6">
                  <button
                    onClick={() => setShiftTableExpanded(!shiftTableExpanded)}
                    className="flex items-center justify-between w-full text-left mb-4"
                  >
                    <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                      {shiftTableExpanded ? '▼' : '▶'} Shift Requests
                    </h3>
                  </button>
                  {shiftTableExpanded && (
                  <>
                    {filteredShiftRequestsByDate.length > 0 ? (
                      <>
                        <SearchBar
                          searchTerm={shiftSearchTerm}
                          onSearchChange={setShiftSearchTerm}
                          placeholder="Search shift requests by staff name, shift, reason, or status..."
                        />
                        <div className="overflow-x-auto mt-4">
                          <table ref={shiftTableRef} className="min-w-full divide-y divide-gray-200 border border-gray-300" style={{ tableLayout: 'auto', width: '100%' }}>
                            <thead className="bg-gray-50 sticky top-0 z-10">
                              <tr>
                                <th key="employee" style={{ width: `${shiftWidths.employee || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                                  Staff
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
                                    {req.force ? 'Must' : 'Cannot'}
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
                                    <div className="flex gap-1">
                                      {req.status !== 'Approved' && (
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
                                      )}
                                      {req.status !== 'Rejected' && (
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
                                      )}
                                    </div>
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
                                  itemsPerPage={requestsItemsPerPage}
                            totalItems={sortedShiftRequests.length}
                          />
                        )}
                      </>
                    ) : (
                      <p className="text-gray-600">No shift requests found for the selected month.</p>
                    )}
                  </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Old Leave Requests Tab - REMOVED - Now part of unified requests tab */}
      {false && activeTab === 'leave' && isManager && (
        <div className="space-y-6">
          {/* Month/Year Selector at top - shared for table and schedule */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium text-gray-700">Select Month/Year:</label>
                <select
                  value={leaveTableFilterDate ? `${leaveTableFilterDate?.getFullYear() ?? 0}-${(leaveTableFilterDate?.getMonth() ?? 0) + 1}` : ''}
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
              placeholder="Search leave requests by staff name, type, reason, or status..."
            />
            <div className="overflow-x-auto">
              <table ref={leaveTableRef} className="min-w-full divide-y divide-gray-200 border border-gray-300" style={{ tableLayout: 'auto', width: '100%' }}>
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th key="employee" style={{ width: `${leaveWidths.employee || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      <div className="flex items-center space-x-1">
                        <span>Staff</span>
                        <button onClick={() => handleLeaveSort('employee')} className="p-1 hover:bg-gray-200 rounded text-xs" title="Sort by staff name">
                          {leaveSortConfig?.key === 'employee' ? (leaveSortConfig?.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </button>
                      </div>
                      <div onMouseDown={(e) => leaveHandleMouseDown(e, 'employee')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="from_date" style={{ width: `${leaveWidths.from_date || 150}px`, position: 'relative' }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 whitespace-nowrap min-w-[120px]">
                      <div className="flex items-center space-x-1">
                        <span>From Date</span>
                        <button onClick={() => handleLeaveSort('from_date')} className="p-1 hover:bg-gray-200 rounded">
                          {leaveSortConfig?.key === 'from_date' ? (leaveSortConfig?.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </button>
                      </div>
                      <div onMouseDown={(e) => leaveHandleMouseDown(e, 'from_date')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="to_date" style={{ width: `${leaveWidths.to_date || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50 whitespace-nowrap min-w-[120px]">
                      <div className="flex items-center space-x-1">
                        <span>To Date</span>
                        <button onClick={() => handleLeaveSort('to_date')} className="p-1 hover:bg-gray-200 rounded">
                          {leaveSortConfig?.key === 'to_date' ? (leaveSortConfig?.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </button>
                      </div>
                      <div onMouseDown={(e) => leaveHandleMouseDown(e, 'to_date')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="type" style={{ width: `${leaveWidths.type || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      <div className="flex items-center space-x-1">
                        <span>Type</span>
                        <button onClick={() => handleLeaveSort('leave_type')} className="p-1 hover:bg-gray-200 rounded">
                          {leaveSortConfig?.key === 'leave_type' ? (leaveSortConfig?.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </button>
                      </div>
                      <div onMouseDown={(e) => leaveHandleMouseDown(e, 'type')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="reason" style={{ width: `${leaveWidths.reason || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      <div className="flex items-center space-x-1">
                        <span>Reason</span>
                        <button onClick={() => handleLeaveSort('reason')} className="p-1 hover:bg-gray-200 rounded">
                          {leaveSortConfig?.key === 'reason' ? (leaveSortConfig?.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </button>
                      </div>
                      <div onMouseDown={(e) => leaveHandleMouseDown(e, 'reason')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="status" style={{ width: `${leaveWidths.status || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      <div className="flex items-center space-x-1">
                        <span>Status</span>
                        <button onClick={() => handleLeaveSort('status')} className="p-1 hover:bg-gray-200 rounded">
                          {leaveSortConfig?.key === 'status' ? (leaveSortConfig?.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </button>
                      </div>
                      <div onMouseDown={(e) => leaveHandleMouseDown(e, 'status')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${leaveResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                    </th>
                    <th key="submitted" style={{ width: `${leaveWidths.submitted || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-gray-50">
                      <div className="flex items-center space-x-1">
                        <span>Submitted</span>
                        <button onClick={() => handleLeaveSort('submitted_at')} className="p-1 hover:bg-gray-200 rounded">
                          {leaveSortConfig?.key === 'submitted_at' ? ((leaveSortConfig?.direction ?? 'asc') === 'asc' ? '↑' : '↓') : '↕'}
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
                  itemsPerPage={requestsItemsPerPage}
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
                entries={[] as any}
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

      {/* Old Shift Requests Tab - REMOVED - Now part of unified requests tab */}
      {false && activeTab === 'shift' && isManager && (
        <div className="space-y-6">
          {/* Month/Year Selector at top - shared for table and schedule */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium text-gray-700">Select Month/Year:</label>
                <select
                  value={shiftTableFilterDate ? `${shiftTableFilterDate?.getFullYear() ?? 0}-${(shiftTableFilterDate?.getMonth() ?? 0) + 1}` : ''}
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
                      Staff
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
                        {req.force ? 'Must' : 'Cannot'}
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
                  itemsPerPage={requestsItemsPerPage}
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
                entries={[] as any}
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
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-gray-900">User accounts</h3>
          <button
            onClick={() => {
              setNewPassword('');
              setEmployeeType('Staff');
              setSelectedEmployee('');
              setNewUserStaffNo('');
              setNewUserStartDate('2025-10-01');
              setShowCreateUser(true);
            }}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            ➕ Create User
          </button>
        </div>
        {poSyncStatus?.requires_sync && (
          <div className="mb-4 rounded border border-yellow-300 bg-yellow-50 px-4 py-3 text-yellow-900 flex items-center justify-between gap-3">
            <div className="text-sm">
              {`Sync pending-off data from ${poSyncStatus.target?.label || 'Current Period'} roster:`}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSyncPendingOff}
                disabled={syncingPo}
                className="px-3 py-1.5 bg-yellow-600 text-white rounded-md text-sm font-semibold hover:bg-yellow-700 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {syncingPo ? 'Syncing...' : 'Sync P/O'}
              </button>
              <button
                type="button"
                onClick={handleIgnoreSyncThisTime}
                disabled={syncingPo}
                className="px-3 py-1.5 bg-gray-200 text-gray-800 rounded-md text-sm font-semibold hover:bg-gray-300 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                Ignore Sync
              </button>
            </div>
          </div>
        )}
        {users.length > 0 ? (
          <>
          <SearchBar
            searchTerm={usersSearchTerm}
            onSearchChange={setUsersSearchTerm}
            placeholder="Search users by username, employee name, staff no, start date, or type..."
          />
          <div className="overflow-x-auto">
            <table ref={usersTableRef} className="min-w-full divide-y divide-gray-200 border border-gray-300" style={{ tableLayout: 'auto', width: '100%' }}>
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th key="username" style={{ width: `${usersWidths.username || 200}px`, maxWidth: `${usersWidths.username || 200}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300 bg-gray-50 overflow-hidden">
                    <div className="flex items-center space-x-1 truncate">
                      <span className="truncate">Username</span>
                      <button onClick={() => handleUsersSort('username')} className="p-1 hover:bg-gray-200 rounded text-xs flex-shrink-0" title="Sort by username">
                        {usersSortConfig?.key === 'username' ? (usersSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                      </button>
                    </div>
                    <div onMouseDown={(e) => usersHandleMouseDown(e, 'username')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${usersResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                  </th>
                  <th key="employee_name" style={{ width: `${usersWidths.employee_name || 200}px`, maxWidth: `${usersWidths.employee_name || 200}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300 bg-gray-50 overflow-hidden">
                    <div className="flex items-center space-x-1 truncate">
                      <span className="truncate">Display name</span>
                      <button onClick={() => handleUsersSort('employee_name')} className="p-1 hover:bg-gray-200 rounded text-xs flex-shrink-0" title="Sort by display name">
                        {usersSortConfig?.key === 'employee_name' ? (usersSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                      </button>
                    </div>
                    <div onMouseDown={(e) => usersHandleMouseDown(e, 'employee_name')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${usersResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                  </th>
                  <th key="staff_no" style={{ width: `${usersWidths.staff_no || 120}px`, maxWidth: `${usersWidths.staff_no || 120}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300 bg-gray-50 overflow-hidden">
                    <div className="flex items-center space-x-1 truncate">
                      <span className="truncate">Staff No</span>
                      <button onClick={() => handleUsersSort('staff_no')} className="p-1 hover:bg-gray-200 rounded text-xs flex-shrink-0" title="Sort by staff number">
                        {usersSortConfig?.key === 'staff_no' ? (usersSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                      </button>
                    </div>
                    <div onMouseDown={(e) => usersHandleMouseDown(e, 'staff_no')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${usersResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                  </th>
                  <th key="employee_type" style={{ width: `${usersWidths.employee_type || 200}px`, maxWidth: `${usersWidths.employee_type || 200}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300 bg-gray-50 overflow-hidden">
                    <div className="flex items-center space-x-1 truncate">
                      <span className="truncate">Role</span>
                      <button onClick={() => handleUsersSort('employee_type')} className="p-1 hover:bg-gray-200 rounded text-xs flex-shrink-0" title="Sort by role">
                        {usersSortConfig?.key === 'employee_type' ? (usersSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                      </button>
                    </div>
                    <div onMouseDown={(e) => usersHandleMouseDown(e, 'employee_type')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${usersResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                  </th>
                  <th key="start_date" style={{ width: `${usersWidths.start_date || 160}px`, maxWidth: `${usersWidths.start_date || 160}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300 bg-gray-50 overflow-hidden">
                    <div className="flex items-center space-x-1 truncate">
                      <span className="truncate">Start Date</span>
                      <button onClick={() => handleUsersSort('start_date')} className="p-1 hover:bg-gray-200 rounded text-xs flex-shrink-0" title="Sort by start date">
                        {usersSortConfig?.key === 'start_date' ? (usersSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                      </button>
                    </div>
                    <div onMouseDown={(e) => usersHandleMouseDown(e, 'start_date')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${usersResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                  </th>
                  <th key="pending_off" style={{ width: `${usersWidths.pending_off || 150}px`, maxWidth: `${usersWidths.pending_off || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300 bg-gray-50 overflow-hidden">
                    <div className="flex items-center space-x-1 truncate">
                      <span className="truncate">Pending Off</span>
                      <button onClick={() => handleUsersSort('pending_off')} className="p-1 hover:bg-gray-200 rounded text-xs flex-shrink-0" title="Sort by pending off">
                        {usersSortConfig?.key === 'pending_off' ? (usersSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                      </button>
                    </div>
                    <div onMouseDown={(e) => usersHandleMouseDown(e, 'pending_off')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${usersResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                  </th>
                  <th key="password" style={{ width: `${usersWidths.password || 200}px`, maxWidth: `${usersWidths.password || 200}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300 bg-gray-50 overflow-hidden">
                    <div className="truncate">Password</div>
                    <div onMouseDown={(e) => usersHandleMouseDown(e, 'password')} className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${usersResizing ? 'bg-blue-500' : ''}`} style={{ userSelect: 'none' }} />
                  </th>
                  <th key="actions" style={{ width: `${usersWidths.actions || 150}px`, maxWidth: `${usersWidths.actions || 150}px`, position: 'sticky', top: 0, zIndex: 10 }} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300 bg-gray-50 overflow-hidden">
                    <div className="truncate">Actions</div>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                  {paginatedUsers.map((user, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td style={{ width: `${usersWidths.username || 200}px`, maxWidth: `${usersWidths.username || 200}px` }} className="px-4 py-2 text-sm font-medium text-gray-900 border border-gray-300 overflow-hidden">
                      <div className="truncate" title={user.username}>
                        {user.username}
                      </div>
                    </td>
                    <td style={{ width: `${usersWidths.employee_name || 200}px`, maxWidth: `${usersWidths.employee_name || 200}px` }} className="px-4 py-2 text-sm text-gray-500 border border-gray-300 overflow-hidden">
                      <div className="truncate" title={user.employee_name}>
                        {user.employee_name}
                      </div>
                    </td>
                    <td style={{ width: `${usersWidths.staff_no || 120}px`, maxWidth: `${usersWidths.staff_no || 120}px` }} className="px-4 py-2 text-sm text-gray-500 border border-gray-300 overflow-hidden">
                      <div className="truncate" title={user.staff_no || ''}>
                        {user.staff_no || '—'}
                      </div>
                    </td>
                    <td style={{ width: `${usersWidths.employee_type || 200}px`, maxWidth: `${usersWidths.employee_type || 200}px` }} className="px-4 py-2 text-sm text-gray-500 border border-gray-300 overflow-hidden">
                      <div className="truncate" title={user.employee_type}>
                        {user.employee_type}
                      </div>
                    </td>
                    <td style={{ width: `${usersWidths.start_date || 160}px`, maxWidth: `${usersWidths.start_date || 160}px` }} className="px-4 py-2 text-sm text-gray-500 border border-gray-300 overflow-hidden">
                      <div className="truncate" title={user.start_date || ''}>
                        {user.start_date || '—'}
                      </div>
                    </td>
                    <td style={{ width: `${usersWidths.pending_off || 150}px`, maxWidth: `${usersWidths.pending_off || 150}px` }} className="px-4 py-2 text-sm text-gray-500 border border-gray-300 overflow-hidden">
                      <div className="truncate" title={user.employee_type === 'Manager' ? 'N/A' : String(user.pending_off ?? 0)}>
                        {user.employee_type === 'Manager' ? 'N/A' : String(user.pending_off ?? 0)}
                      </div>
                    </td>
                    <td style={{ width: `${usersWidths.password || 200}px`, maxWidth: `${usersWidths.password || 200}px` }} className="px-4 py-2 text-sm text-gray-500 border border-gray-300 overflow-hidden">
                      <div className="truncate" title={user.password_hidden}>
                        {user.password_hidden ? (user.password_hidden.length > 8 ? '*'.repeat(8) : user.password_hidden) : '-'}
                      </div>
                    </td>
                    <td style={{ width: `${usersWidths.actions || 150}px`, maxWidth: `${usersWidths.actions || 150}px` }} className="px-4 py-2 text-sm border border-gray-300 overflow-hidden">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setSelectedEmployee(user.employee_name);
                            setEditingEmployeeName(user.employee_name);
                            setEditingUsername(user.username);
                            setEmployeeType(user.employee_type);
                            setEditingStaffNo(user.staff_no ?? '');
                            setEditingStartDate(user.start_date || '2025-10-01');
                            setEditingPendingOff(user.pending_off !== null && user.pending_off !== undefined ? Number(user.pending_off) : 0);
                            setNewPassword('');
                            setShowCreateUser(false);
                            setShowEditUser(true);
                            setUsernameError(null);
                            // Store old username for backend lookup
                            (window as any).editingOldUsername = user.username;
                          }}
                          className="text-blue-600 hover:text-blue-800"
                          title="Edit user account"
                          aria-label="Edit user account"
                        >
                          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                            <path d="M11 3H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 0 3L12 12l-4 1 1-4 6.5-6.5a2.121 2.121 0 0 1 3 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
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
                      </div>
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
                itemsPerPage={usersItemsPerPage}
                totalItems={sortedUsers.length}
              />
            )}
          </>
        ) : (
          <p className="text-gray-600">No users found. Click "Create User" to add a new user account.</p>
        )}
      </div>

      {/* Edit User Form */}
      {showEditUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Edit User Account</h3>
            <form onSubmit={handleUpdateUser}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Display name
                </label>
                <input
                  type="text"
                  value={editingEmployeeName}
                  onChange={(e) => {
                    setEditingEmployeeName(e.target.value);
                    setUsernameError(null);
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  required
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Staff No
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={editingStaffNo}
                  onChange={(e) => setEditingStaffNo(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="e.g. 58812 (leave empty to clear)"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Start Date
                </label>
                <input
                  type="date"
                  value={editingStartDate}
                  onChange={(e) => setEditingStartDate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  required
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Username <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editingUsername}
                  onChange={(e) => {
                    setEditingUsername(e.target.value);
                    setUsernameError(null);
                  }}
                  className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
                    usernameError ? 'border-red-500' : 'border-gray-300'
                  }`}
                  required
                />
                {usernameError ? (
                  <p className="mt-2 text-xs text-red-600">{usernameError}</p>
                ) : (
                  <p className="mt-2 text-xs text-gray-500">Username must be unique</p>
                )}
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Leave empty to keep current password"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Role
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

              {employeeType === 'Staff' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Pending Off
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={editingPendingOff}
                    onChange={(e) => setEditingPendingOff(parseInt(e.target.value) || 0)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder="0"
                  />
                  <p className="mt-2 text-xs text-gray-500">Number of pending off days for this staff member</p>
                </div>
              )}

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditUser(false);
                    setSelectedEmployee('');
                    setEditingEmployeeName('');
                    setEditingUsername('');
                    setEditingStaffNo('');
                    setEditingStartDate('2025-10-01');
                    setEditingPendingOff(0);
                    setNewPassword('');
                    setEmployeeType('Staff');
                    setUsernameError(null);
                    (window as any).editingOldUsername = undefined;
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  disabled={updating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                  disabled={updating || !editingEmployeeName || !editingUsername}
                >
                  {updating ? 'Updating...' : 'Update User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Create User Modal */}
      {showCreateUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Create New User</h3>
            <form onSubmit={handleCreateUser}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Display name
                </label>
                <input
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Name shown on the roster"
                  autoFocus
                  required
                />
                {newUserName && (
                  <p className="mt-2 text-xs text-gray-500">
                    Username will be: <strong>{newUserName.trim().toLowerCase().replace(/\s+/g, '_')}</strong>
                  </p>
                )}
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Enter password"
                  required
                  minLength={3}
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Staff No <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={newUserStaffNo}
                  onChange={(e) => setNewUserStaffNo(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Official staff number"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Start Date
                </label>
                <input
                  type="date"
                  value={newUserStartDate}
                  onChange={(e) => setNewUserStartDate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Role
                </label>
                <select
                  value={newUserType}
                  onChange={(e) => setNewUserType(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  required
                >
                  <option value="Staff">Staff</option>
                  <option value="Manager">Manager</option>
                </select>
                {newUserType === 'Staff' && (
                  <p className="mt-2 text-xs text-gray-500">
                    Staff accounts automatically get a skills profile (shift eligibility).
                  </p>
                )}
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateUser(false);
                    setNewUserName('');
                    setNewUserPassword('');
                    setNewUserStaffNo('');
                    setNewUserStartDate('2025-10-01');
                    setNewUserType('Staff');
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  disabled={updating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                  disabled={updating}
                >
                  {updating ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
        </>
      )}

    </div>
  );
};

