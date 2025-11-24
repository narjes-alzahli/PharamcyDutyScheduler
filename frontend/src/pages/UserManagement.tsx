import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { dataAPI, usersAPI, requestsAPI } from '../services/api';
import api from '../services/api';
import { Pagination } from '../components/Pagination';
import { LoadingSkeleton } from '../components/LoadingSkeleton';

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
      return 'bg-green-50 text-green-700 border border-green-200';
    case 'Rejected':
      return 'bg-red-50 text-red-700 border border-red-200';
    default:
      return 'bg-amber-50 text-amber-700 border border-amber-200';
  }
};

const buildCalendarEntries = (requests: any[], type: 'Leave' | 'Shift'): CalendarEntry[] => {
  const sortedRequests = [...requests].sort((a, b) => {
    const dateA = new Date(a.submitted_at || a.created_at || a.updated_at || 0).getTime();
    const dateB = new Date(b.submitted_at || b.created_at || b.updated_at || 0).getTime();
    return dateA - dateB;
  });

  const entries: CalendarEntry[] = [];

  sortedRequests.forEach((req) => {
    if (!req?.from_date) {
      return;
    }

    const startDate = new Date(req.from_date);
    const endDate = new Date(req.to_date || req.from_date);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
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
      const occupancy: number[] = [];

      entries.forEach((entry) => {
        const entryStart = startOfDay(entry.startDate);
        const entryEnd = startOfDay(entry.endDate);

        if (entryEnd < weekStart || entryStart > weekEnd) {
          return;
        }

        const segmentStart = entryStart < weekStart ? weekStart : entryStart;
        const segmentEnd = entryEnd > weekEnd ? weekEnd : entryEnd;

        const startCol = Math.max(0, differenceInDays(weekStart, segmentStart));
        const endCol = Math.min(6, differenceInDays(weekStart, segmentEnd));

        // Shift requests: treat each day as a separate, independent pill
        // Leave requests: create continuous segments
        if (entry.requestType === 'Shift') {
          // Create separate segments for each day
          for (let dayCol = startCol; dayCol <= endCol; dayCol += 1) {
            let rowIndex = 0;
            while (
              rowIndex < occupancy.length &&
              occupancy[rowIndex] !== undefined &&
              occupancy[rowIndex] >= dayCol
            ) {
              rowIndex += 1;
            }
            occupancy[rowIndex] = dayCol;

            segments.push({
              entry,
              colStart: dayCol,
              colSpan: 1, // Each day is its own segment
              row: rowIndex,
              isSegmentStart: true, // Each day has rounded left end
              isSegmentEnd: true, // Each day has rounded right end
            });
          }
        } else {
          // Leave requests: create continuous segments
        let rowIndex = 0;
        while (
          rowIndex < occupancy.length &&
          occupancy[rowIndex] !== undefined &&
          occupancy[rowIndex] >= startCol
        ) {
          rowIndex += 1;
        }
        occupancy[rowIndex] = endCol;

        segments.push({
          entry,
          colStart: startCol,
          colSpan: endCol - startCol + 1,
          row: rowIndex,
          isSegmentStart: segmentStart.getTime() === entryStart.getTime(),
          isSegmentEnd: segmentEnd.getTime() === entryEnd.getTime(),
        });
        }
      });

      const rowsUsed = occupancy.length;
      return { segments, rowsUsed };
    });
  }, [calendarMatrix, entries]);

  const monthLabel = monthDate.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <button
          type="button"
          onClick={onPrev}
          className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
        >
          ← Prev
        </button>
        <div className="text-sm font-semibold text-gray-900">{monthLabel}</div>
        <button
          type="button"
          onClick={onNext}
          className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
        >
          Next →
        </button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-600">
        {dayLabels.map((day) => (
          <div key={day} className="bg-gray-50 px-2 py-2 text-center">
            {day}
          </div>
        ))}
      </div>
      <div className="divide-y divide-gray-200">
        {calendarMatrix.map((week, idx) => {
          const { segments } = weekSegments[idx];
          return (
            <div key={week[0].date.toISOString()} className="border-b border-gray-200 overflow-hidden">
              <div className="grid grid-cols-7 border-t border-gray-200">
                {week.map((day, colIdx) => {
                  const dateKey = formatDateKey(day.date);
                  const count = requestCounts.get(dateKey) || 0;
                  return (
                    <div
                      key={dateKey}
                      className={`flex min-h-[84px] flex-col px-2 py-2 overflow-hidden ${
                        day.inCurrentMonth ? 'bg-white text-gray-900' : 'bg-gray-50 text-gray-400'
                      } border-r border-gray-200 ${colIdx === 6 ? 'border-r-0' : ''}`}
                    >
                      <div className="mb-1 text-xs font-semibold">{day.date.getDate()}</div>
                      {count > 0 && (
                        <span className="text-[11px] font-medium text-gray-500">
                          {count} request{count > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {segments.length > 0 && (
                <div className="relative overflow-hidden">
                  <div className="pointer-events-none absolute inset-0 z-30 grid grid-cols-7">
                    {week.map((_, colIdx) => (
                      <div
                        key={`divider-${week[0].date.toISOString()}-${colIdx}`}
                        className={`border-r border-gray-200 ${colIdx === 6 ? 'border-r-0' : ''}`}
                      />
                    ))}
                  </div>
                  <div
                    className="relative z-20 grid gap-y-2 gap-x-0 px-2 py-3"
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
                      const radiusClass =
                        colSpan === 1
                          ? 'rounded-full'
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

                      // Highlight uses same color as unhighlighted outline (amber-200) but thicker
                      // amber-200 in RGB is rgb(253, 230, 138)
                      if (isSelected) {
                        segmentStyle.zIndex = 50;
                        if (isSegmentStart) {
                          segmentStyle.borderLeft = '3px solid rgb(253, 230, 138)'; // amber-200, thicker
                        } else {
                          segmentStyle.borderLeft = 'none';
                        }
                        if (isSegmentEnd) {
                          segmentStyle.borderRight = '3px solid rgb(253, 230, 138)'; // amber-200, thicker
                        } else {
                          segmentStyle.borderRight = 'none';
                        }
                        segmentStyle.borderTop = '3px solid rgb(253, 230, 138)'; // amber-200, thicker
                        segmentStyle.borderBottom = '3px solid rgb(253, 230, 138)'; // amber-200, thicker
                      } else {
                        if (!isSegmentStart) {
                          segmentStyle.borderLeft = 'none';
                        }
                        if (!isSegmentEnd) {
                          segmentStyle.borderRight = 'none';
                        }
                      }

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
                          className={`flex flex-col gap-0.5 px-2 py-1 text-left text-[11px] font-semibold text-gray-900 shadow-sm transition ${
                            getStatusBadgeClass(entry.status)
                          } ${radiusClass} ${
                            !isSegmentStart ? 'border-l-0' : ''
                          } ${
                            !isSegmentEnd ? 'border-r-0' : ''
                          } ${
                            isSelected
                              ? ''
                              : selectedEntryId
                                ? 'opacity-40'
                                : ''
                          }`}
                          style={segmentStyle}
                          title={`${entry.employee} • ${entry.primaryLabel}${
                            entry.secondaryLabel ? ` · ${entry.secondaryLabel}` : ''
                          } (${entry.requestType})`}
                        >
                          {/* Fade overlays for segments that continue across week rows */}
                          {needsLeftFade && (
                            <div
                              className="absolute inset-y-0 left-0 w-6 pointer-events-none z-10"
                              style={{
                                background: 'linear-gradient(to right, rgb(255, 255, 255) 0%, rgba(255, 255, 255, 0.8) 30%, transparent 100%)',
                                border: 'none',
                              }}
                            />
                          )}
                          {needsRightFade && (
                            <div
                              className="absolute inset-y-0 right-0 w-6 pointer-events-none z-10"
                              style={{
                                background: 'linear-gradient(to left, rgb(255, 255, 255) 0%, rgba(255, 255, 255, 0.8) 30%, transparent 100%)',
                                border: 'none',
                              }}
                            />
                          )}
                          <div className="flex items-center justify-between gap-1 relative z-0">
                            <span className="text-xs font-semibold text-amber-900">
                              {entry.employee}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-1 relative z-0">
                            <span className="text-[10px] font-medium text-gray-600 capitalize truncate">
                              {entry.requestType === 'Leave'
                                ? entry.primaryLabel
                                : `${entry.primaryLabel}${entry.secondaryLabel ? ` · ${entry.secondaryLabel}` : ''}`}
                            </span>
                            {isSelected && entry.status === 'Pending' && (
                              <div
                                className="flex gap-2"
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
                                    className="rounded-full bg-green-600 p-1 text-white shadow hover:bg-green-700 disabled:opacity-60"
                                    title="Approve request"
                                    aria-label="Approve request"
                                  >
                                    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
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
                                    className="rounded-full bg-red-600 p-1 text-white shadow hover:bg-red-700 disabled:opacity-60"
                                    title="Reject request"
                                    aria-label="Reject request"
                                  >
                                    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
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
                                    className="rounded-full bg-gray-700 p-1 text-white shadow hover:bg-gray-800 disabled:opacity-60"
                                    title="Remove request"
                                    aria-label="Remove request"
                                  >
                                    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                                      <path d="M5 6H6.66667H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                      <path d="M8.3335 6V4.33333C8.3335 3.8731 8.52663 3.43172 8.8692 3.11915C9.21178 2.80659 9.67607 2.65039 10.1566 2.6927L11.8233 2.83444C12.2818 2.8749 12.709 3.0683 13.0216 3.38087C13.3342 3.69344 13.5276 4.12063 13.5681 4.57911L13.6668 5.66666M12.5 8.33333V14.1667" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                      <path d="M9.1665 8.33333V14.1667" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                      <path d="M4.99984 5.66666H5.6665L6.33317 16.6667C6.33317 17.1087 6.50877 17.5326 6.82133 17.8452C7.1339 18.1577 7.55781 18.3333 7.99984 18.3333H12.3332C12.7752 18.3333 13.1991 18.1577 13.5117 17.8452C13.8242 17.5326 13.9998 17.1087 13.9998 16.6667L14.6665 5.66666" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
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
        <div className="border-t border-gray-200 px-4 py-3 text-sm text-gray-500">
          {emptyMessage || 'No requests to display.'}
        </div>
      )}
    </div>
  );
};

export const UserManagement: React.FC = () => {
  const { user: currentUser } = useAuth();
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
  const [leaveCalendarDate, setLeaveCalendarDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [shiftCalendarDate, setShiftCalendarDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedCalendarEntryId, setSelectedCalendarEntryId] = useState<string | null>(null);
  
  // Pagination state
  const [usersPage, setUsersPage] = useState(1);
  const [leavePage, setLeavePage] = useState(1);
  const [shiftPage, setShiftPage] = useState(1);
  const itemsPerPage = 10;

  const pendingLeaveCount = leaveRequests.filter((req) => req.status === 'Pending').length;
  const pendingShiftCount = shiftRequests.filter((req) => req.status === 'Pending').length;

  useEffect(() => {
    loadData();
    if (currentUser?.employee_type === 'Manager') {
      loadRequests();
    }
  }, []);

  useEffect(() => {
    if (currentUser?.employee_type === 'Manager' && (activeTab === 'leave' || activeTab === 'shift')) {
      loadRequests();
    }
  }, [activeTab, currentUser]);

  const loadRequests = async () => {
    // Double-check user is manager before making API calls
    if (!currentUser || currentUser.employee_type !== 'Manager') {
      setLeaveRequests([]);
      setShiftRequests([]);
      return;
    }

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
      const pendingCount =
        leaveRes.filter((req: any) => req.status === 'Pending').length +
        shiftRes.filter((req: any) => req.status === 'Pending').length;
      window.dispatchEvent(
        new CustomEvent('pendingRequestsUpdated', { detail: { count: pendingCount } })
      );
    } catch (error: any) {
      // Silently handle 403 errors (non-managers) - already handled in API
      if (error.response?.status !== 403) {
        console.error('Failed to load requests:', error);
      }
      setLeaveRequests([]);
      setShiftRequests([]);
    }
  };


  const loadData = async () => {
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
  };

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
      await loadRequests();
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
      await loadRequests();
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
      await loadRequests();
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
      await loadRequests();
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
      await loadRequests();
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
      await loadRequests();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to remove shift request', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setProcessingRequest(null);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
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
    []
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
    return users.slice(start, end);
  }, [users, usersPage]);

  const paginatedLeaveRequests = useMemo(() => {
    const start = (leavePage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return leaveRequests.slice(start, end);
  }, [leaveRequests, leavePage]);

  const paginatedShiftRequests = useMemo(() => {
    const start = (shiftPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return shiftRequests.slice(start, end);
  }, [shiftRequests, shiftPage]);

  const usersTotalPages = Math.ceil(users.length / itemsPerPage);
  const leaveTotalPages = Math.ceil(leaveRequests.length / itemsPerPage);
  const shiftTotalPages = Math.ceil(shiftRequests.length / itemsPerPage);

  if (loading) {
    return (
      <div>
        <h2 className="text-3xl font-bold text-gray-900 mb-6">User Management</h2>
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
      {currentUser?.employee_type === 'Manager' && (
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
              👥 User Accounts
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
                <span>🏖️ Leave Requests</span>
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
                <span>🔒 Shift Requests</span>
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
      {activeTab === 'leave' && currentUser?.employee_type === 'Manager' && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
              <span>🏖️ Leave Requests</span>
              {pendingLeaveCount > 0 && (
                <span className="inline-flex items-center justify-center h-7 min-w-[1.75rem] px-2 text-xs font-semibold text-white bg-red-600 rounded-full">
                  {pendingLeaveCount}
                </span>
              )}
            </h3>
            {pendingLeaveCount > 0 && (
              <span className="text-sm text-gray-500">
                Pending approval
              </span>
            )}
          </div>
          {leaveRequests.length > 0 ? (
            <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Employee</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">From Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">To Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Reason</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Submitted</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {paginatedLeaveRequests.map((req) => (
                    <tr key={req.request_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900 border border-gray-300">{req.employee}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{formatDate(req.from_date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{formatDate(req.to_date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{req.leave_type}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{req.reason || '-'}</td>
                      <td className="px-4 py-3 text-sm border border-gray-300">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          req.status === 'Approved' ? 'bg-green-100 text-green-800' :
                          req.status === 'Rejected' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {req.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 border border-gray-300">{formatDateTime(req.submitted_at)}</td>
                      <td className="px-4 py-3 text-sm border border-gray-300">
                        {req.status === 'Pending' ? (
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleApproveLeave(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              {processingRequest === req.request_id ? 'Processing...' : 'Approve'}
                            </button>
                            <button
                              onClick={() => handleRejectLeave(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50"
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => handleDeleteLeave(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="px-3 py-1 bg-gray-600 text-white text-xs rounded hover:bg-gray-700 disabled:opacity-50"
                            >
                              Remove
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
                  totalItems={leaveRequests.length}
                />
              )}
            </>
          ) : (
            <p className="text-gray-600">No leave requests found.</p>
          )}
          <div className="mt-8 max-w-8xl pr-6 space-y-3">
            <h4 className="text-lg font-semibold text-gray-900">Schedule View</h4>
            <CalendarView
              monthDate={leaveCalendarDate}
              onPrev={() =>
                setLeaveCalendarDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
              }
              onNext={() =>
                setLeaveCalendarDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
              }
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
        </div>
      )}

      {/* Shift Requests Tab */}
      {activeTab === 'shift' && currentUser?.employee_type === 'Manager' && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
              <span>🔒 Shift Requests</span>
              {pendingShiftCount > 0 && (
                <span className="inline-flex items-center justify-center h-7 min-w-[1.75rem] px-2 text-xs font-semibold text-white bg-red-600 rounded-full">
                  {pendingShiftCount}
                </span>
              )}
            </h3>
            {pendingShiftCount > 0 && (
              <span className="text-sm text-gray-500">
                Pending approval
              </span>
            )}
          </div>
          {shiftRequests.length > 0 ? (
            <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Employee</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">From Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">To Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Shift</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Reason</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Submitted</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {paginatedShiftRequests.map((req) => (
                    <tr key={req.request_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900 border border-gray-300">{req.employee}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{formatDate(req.from_date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{formatDate(req.to_date || req.from_date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{req.shift}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">
                        {req.force ? 'Force (Must)' : 'Forbid (Cannot)'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{req.reason || '-'}</td>
                      <td className="px-4 py-3 text-sm border border-gray-300">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          req.status === 'Approved' ? 'bg-green-100 text-green-800' :
                          req.status === 'Rejected' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {req.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 border border-gray-300">{formatDateTime(req.submitted_at)}</td>
                      <td className="px-4 py-3 text-sm border border-gray-300">
                        {req.status === 'Pending' ? (
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleApproveShift(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              {processingRequest === req.request_id ? 'Processing...' : 'Approve'}
                            </button>
                            <button
                              onClick={() => handleRejectShift(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50"
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => handleDeleteShift(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="px-3 py-1 bg-gray-600 text-white text-xs rounded hover:bg-gray-700 disabled:opacity-50"
                            >
                              Remove
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
                  totalItems={shiftRequests.length}
                />
              )}
            </>
          ) : (
            <p className="text-gray-600">No shift requests found.</p>
          )}
          <div className="mt-8 max-w-8xl pr-6 space-y-3">
            <h4 className="text-lg font-semibold text-gray-900">Schedule View</h4>
            <CalendarView
              monthDate={shiftCalendarDate}
              onPrev={() =>
                setShiftCalendarDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
              }
              onNext={() =>
                setShiftCalendarDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
              }
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
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                    Username
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                    Employee Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                    Employee Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                    Password
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                  {paginatedUsers.map((user, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 border border-gray-300">
                      {user.username}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border border-gray-300">
                      {user.employee_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border border-gray-300">
                      {user.employee_type}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border border-gray-300">
                      {user.password_hidden}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm border border-gray-300">
                      <button
                        onClick={() => handleDeleteUser(user.username, user.employee_name)}
                        disabled={deleting === user.username || user.username === currentUser?.username}
                        className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={user.username === currentUser?.username ? "Cannot delete your own account" : "Delete user account"}
                      >
                        {deleting === user.username ? 'Deleting...' : 'Delete'}
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
                totalItems={users.length}
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

