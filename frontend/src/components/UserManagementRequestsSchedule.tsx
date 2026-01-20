import React, { useState, useMemo, useRef, useEffect } from 'react';
import { parseDateToISO } from '../utils/dateFormat';

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

interface UserManagementRequestsScheduleProps {
  year: number;
  month: number;
  leaveRequests: Request[];
  shiftRequests: Request[];
  selectedRequestId: string | null;
  onSelectRequest: (requestId: string | null) => void;
  onApprove: (requestId: string, type: 'leave' | 'shift') => void;
  onReject: (requestId: string, type: 'leave' | 'shift') => void;
  onDelete: (requestId: string, type: 'leave' | 'shift') => void;
  processingRequestId: string | null;
  allEmployees?: string[]; // Optional: if provided, show all employees even if they have no requests
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
  onDelete,
  processingRequestId,
  allEmployees,
}) => {
  const [hoveredRequestId, setHoveredRequestId] = useState<string | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number; side: 'left' | 'right' } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);

  // Get all dates in the month
  const dates = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const monthStr = String(month).padStart(2, '0');
      const dayStr = String(day).padStart(2, '0');
      return `${year}-${monthStr}-${dayStr}`;
    });
  }, [year, month]);

  // Get all unique employees - use allEmployees if provided, otherwise only show employees with requests
  const employees = useMemo(() => {
    if (allEmployees && allEmployees.length > 0) {
      // Show all employees if provided
      return [...allEmployees].sort();
    }
    // Otherwise, only show employees who have requests
    const empSet = new Set<string>();
    leaveRequests.forEach(req => empSet.add(req.employee));
    shiftRequests.forEach(req => empSet.add(req.employee));
    return Array.from(empSet).sort();
  }, [leaveRequests, shiftRequests, allEmployees]);

  // Create request map for quick lookup
  const requestMap = useMemo(() => {
    const map = new Map<string, Request & { type: 'leave' | 'shift'; code: string }>();
    
    leaveRequests.forEach(req => {
      const fromDate = parseDateToISO(req.from_date);
      const toDate = parseDateToISO(req.to_date);
      if (!fromDate || !toDate) return;
      
      let currentDate = new Date(fromDate);
      const endDate = new Date(toDate);
      
      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const key = `${req.employee}_${dateStr}`;
        map.set(key, {
          ...req,
          type: 'leave',
          code: req.leave_type || '',
        });
        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

    shiftRequests.forEach(req => {
      const fromDate = parseDateToISO(req.from_date);
      const toDate = parseDateToISO(req.to_date);
      if (!fromDate || !toDate) return;
      
      let currentDate = new Date(fromDate);
      const endDate = new Date(toDate);
      
      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const key = `${req.employee}_${dateStr}`;
        // If there's already a leave request, skip (leave takes priority for display)
        if (!map.has(key)) {
          map.set(key, {
            ...req,
            type: 'shift',
            code: req.shift || '',
          });
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

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
    const date = new Date(dateStr);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()];
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.getDate().toString();
  };

  const handleCellClick = (employee: string, date: string, e: React.MouseEvent) => {
    const key = `${employee}_${date}`;
    const request = requestMap.get(key);
    
    if (request) {
      const isSelected = selectedRequestId === request.request_id;
      const newSelectedId = isSelected ? null : request.request_id;
      onSelectRequest(newSelectedId);
      
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
    }
  };

  const handleCellHover = (employee: string, date: string) => {
    const key = `${employee}_${date}`;
    const request = requestMap.get(key);
    if (request) {
      setHoveredRequestId(request.request_id);
    }
  };

  const handleCellLeave = () => {
    setHoveredRequestId(null);
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

  // Get all dates in a request range
  const getRequestRangeDates = (requestId: string): string[] => {
    const range = requestRanges.get(requestId);
    if (!range) return [];
    
    const dates: string[] = [];
    let currentDate = new Date(range.fromDate);
    const endDate = new Date(range.toDate);
    
    while (currentDate <= endDate) {
      dates.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return dates;
  };

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        if (!(event.target as HTMLElement).closest('td')) {
          onSelectRequest(null);
          setPopupPosition(null);
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
      <div ref={scheduleRef} className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <table className="min-w-full border-2 border-black text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-black px-1 py-1 text-left font-bold sticky left-0 bg-gray-100 z-10 text-[10px]">
                  Employee
                </th>
                {dates.map(dateStr => (
                  <th
                    key={dateStr}
                    className="border border-black px-0.5 py-0.5 text-center font-semibold min-w-[28px]"
                    title={`${getDayOfWeek(dateStr)} ${formatDate(dateStr)}`}
                  >
                    <div className="text-[10px] leading-tight">{formatDate(dateStr)}</div>
                    <div className="text-[10px] text-gray-500 leading-tight">{getDayOfWeek(dateStr)}</div>
                  </th>
                ))}
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
                    const request = requestMap.get(key);
                    const range = request ? requestRanges.get(request.request_id) : null;
                    const rangeDates = request ? getRequestRangeDates(request.request_id) : [];
                    const isInRange = request && rangeDates.includes(dateStr);
                    const isSelected = isInSelectedRange(employee, dateStr);
                    const isHovered = isInHoveredRange(employee, dateStr);
                    const isRangeStart = range && dateStr === range.fromDate;
                    const isRangeEnd = range && dateStr === range.toDate;
                    
                    const backgroundColor = request ? getStatusColor(request.status) : 'transparent';
                    const isHighlighted = isSelected;
                    const shouldHoverScale = isHovered;
                    
                    return (
                      <td
                        key={dateStr}
                        data-cell-key={`${employee}_${dateStr}`}
                        className={`border border-black px-0.5 py-0.5 text-center font-bold text-[10px] relative cursor-pointer transition-all ${
                          isHighlighted ? 'ring-2 ring-blue-500' : ''
                        } ${shouldHoverScale ? 'scale-110' : ''}`}
                        style={{ backgroundColor }}
                        onClick={(e) => handleCellClick(employee, dateStr, e)}
                        onMouseEnter={() => handleCellHover(employee, dateStr)}
                        onMouseLeave={handleCellLeave}
                        title={request ? `${request.code} - ${request.status}` : ''}
                      >
                        {request && (
                          <div className="flex items-center justify-center min-h-[18px]">
                            <span>{request.code}</span>
                            {request.type === 'shift' && request.force !== undefined && (
                              <span className="ml-0.5 text-[8px]">
                                {request.force ? '📌' : '✗'}
                              </span>
                            )}
                          </div>
                        )}
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
            <button
              onClick={() => {
                onApprove(selectedRequestId, requestType);
                onSelectRequest(null);
                setPopupPosition(null);
              }}
              disabled={processingRequestId === selectedRequestId || request.status !== 'Pending'}
              className="rounded-full bg-green-600 p-1.5 text-white shadow hover:bg-green-700 disabled:opacity-60 flex-shrink-0"
              title="Approve request"
            >
              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                <path d="M16.25 5.75L8.5 13.5L4.75 9.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={() => {
                onReject(selectedRequestId, requestType);
                onSelectRequest(null);
                setPopupPosition(null);
              }}
              disabled={processingRequestId === selectedRequestId || request.status !== 'Pending'}
              className="rounded-full bg-red-600 p-1.5 text-white shadow hover:bg-red-700 disabled:opacity-60 flex-shrink-0"
              title="Reject request"
            >
              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                <path d="M6 6L14 14M14 6L6 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={() => {
                onDelete(selectedRequestId, requestType);
                onSelectRequest(null);
                setPopupPosition(null);
              }}
              disabled={processingRequestId === selectedRequestId}
              className="rounded-full bg-gray-700 p-1.5 text-white shadow hover:bg-gray-800 disabled:opacity-60 flex-shrink-0"
              title="Delete request"
            >
              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                <path d="M5 6H6.66667H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8.33333 6V4.66667C8.33333 4.31305 8.47381 3.97391 8.72386 3.72386C8.97391 3.47381 9.31305 3.33333 9.66667 3.33333H10.3333C10.687 3.33333 11.0261 3.47381 11.2761 3.72386C11.5262 3.97391 11.6667 4.31305 11.6667 4.66667V6M13.3333 6V15.3333C13.3333 15.687 13.1929 16.0261 12.9428 16.2761C12.6928 16.5262 12.3536 16.6667 12 16.6667H8C7.64638 16.6667 7.30724 16.5262 7.05719 16.2761C6.80714 16.0261 6.66667 15.687 6.66667 15.3333V6H13.3333Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        );
      })()}
    </div>
  );
};
