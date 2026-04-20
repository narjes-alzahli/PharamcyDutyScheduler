import React, { useState, useEffect, useMemo, useRef } from 'react';
import { leaveTypesAPI, shiftTypesAPI, LeaveType, ShiftType, requestsAPI } from '../services/api';
import { formatDateDDMMYYYY, parseDateToISO } from '../utils/dateFormat';
import { shiftColors as defaultShiftColors } from '../utils/shiftColors';
import { getRamadanPeriodWindow } from '../utils/ramadanPeriods';

interface RequestsScheduleProps {
  year: number;
  month: number;
  employees: string[];
  timeOff: any[];
  locks: any[];
  onTimeOffChange: (newData: any[]) => void;
  onLocksChange: (newData: any[]) => void;
  onSaveNotification: (notification: { message: string; type: 'success' | 'error' }) => void;
  /** Human summary for toast after a cell/range save (shift, dates, person). */
  onRequestSaveSummary?: (summary: string) => void;
  onReload: () => void;
  selectedPeriod?: string | null; // 'pre-ramadan', 'ramadan', 'post-ramadan', or null
}

// Standard working shifts that go to locks
const STANDARD_SHIFT_CODES = new Set(['M', 'IP', 'A', 'N', 'M3', 'M4', 'H', 'CL', 'E', 'MS', 'IP+P', 'P', 'M+P', 'AS']);

/** Matches save toasts: `Name · DD-MM-YYYY[–DD-MM-YYYY] · detail` */
function formatPersonDatesDetail(
  employee: string,
  fromDate: string,
  toDate: string,
  detail: string
): string {
  const d1 = formatDateDDMMYYYY(fromDate);
  const d2 = formatDateDDMMYYYY(toDate);
  const dateStr = fromDate === toDate ? d1 : `${d1}–${d2}`;
  return `${employee} · ${dateStr} · ${detail}`;
}

function formatBatchActionNotification(
  verb: 'Saved' | 'Deleted' | 'Rejected',
  lines: string[]
): string {
  if (lines.length === 0) return `${verb}.`;
  if (lines.length === 1) return `${verb} · ${lines[0]}`;
  return `${verb} ${lines.length} requests · ${lines[0]}${lines.length > 1 ? '…' : ''}`;
}

function buildContiguousRangesFromCells(
  cells: Array<{ employee: string; date: string }>
): Array<{ employee: string; from_date: string; to_date: string }> {
  const byEmployee = new Map<string, string[]>();
  cells.forEach((cell) => {
    const isoDate = parseDateToISO(cell.date) || cell.date;
    if (!byEmployee.has(cell.employee)) {
      byEmployee.set(cell.employee, []);
    }
    byEmployee.get(cell.employee)!.push(isoDate);
  });

  const ranges: Array<{ employee: string; from_date: string; to_date: string }> = [];
  byEmployee.forEach((dates, employeeName) => {
    const uniqueSortedDates = Array.from(new Set(dates)).sort();
    if (uniqueSortedDates.length === 0) return;

    let rangeStart = uniqueSortedDates[0];
    let prevDate = uniqueSortedDates[0];

    for (let i = 1; i < uniqueSortedDates.length; i++) {
      const currentDate = uniqueSortedDates[i];
      const prev = new Date(prevDate);
      const curr = new Date(currentDate);
      const dayDiff = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));

      if (dayDiff === 1) {
        prevDate = currentDate;
        continue;
      }

      ranges.push({ employee: employeeName, from_date: rangeStart, to_date: prevDate });
      rangeStart = currentDate;
      prevDate = currentDate;
    }

    ranges.push({ employee: employeeName, from_date: rangeStart, to_date: prevDate });
  });

  return ranges;
}

export const RequestsSchedule: React.FC<RequestsScheduleProps> = ({
  year,
  month,
  employees,
  timeOff,
  locks,
  onTimeOffChange,
  onLocksChange,
  onSaveNotification,
  onRequestSaveSummary,
  onReload,
  selectedPeriod,
}) => {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [editingCell, setEditingCell] = useState<{ employee: string; date: string } | null>(null);
  const [selectedCells, setSelectedCells] = useState<Array<{ employee: string; date: string }>>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartCell, setDragStartCell] = useState<{ employee: string; date: string } | null>(null);
  const [justFinishedDrag, setJustFinishedDrag] = useState(false);
  const [selectionMode, setSelectionMode] = useState<'single' | 'range'>('single');
  const [rangeStartCell, setRangeStartCell] = useState<{ employee: string; date: string } | null>(null);
  const [isTouchOrSmallScreen, setIsTouchOrSmallScreen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pendingRejection, setPendingRejection] = useState<{
    requestId: string;
    employee: string;
    type: 'leave' | 'shift';
    action: 'reject' | 'delete';
    cell: { employee: string; date: string };
    /** Inner line: `Name · dates · code/shift` (same shape as save toasts) */
    toastInner?: string;
  } | null>(null);
  const [allLeaveRequests, setAllLeaveRequests] = useState<any[]>([]);
  const [allShiftRequests, setAllShiftRequests] = useState<any[]>([]);

  useEffect(() => {
    const loadTypes = async () => {
      try {
        const [leaveTypesData, shiftTypesData, leaveReqs, shiftReqs] = await Promise.all([
          leaveTypesAPI.getLeaveTypes(true),
          shiftTypesAPI.getShiftTypes(true),
          requestsAPI.getAllLeaveRequests().catch(() => []), // Load all requests to get employee names
          requestsAPI.getAllShiftRequests().catch(() => []),
        ]);
        setLeaveTypes(leaveTypesData);
        setShiftTypes(shiftTypesData);
        setAllLeaveRequests(leaveReqs);
        setAllShiftRequests(shiftReqs);
      } catch (error) {
        console.error('Failed to load types:', error);
      }
    };
    loadTypes();
  }, []);

  // Show range mode toggle for touch/smaller viewports.
  useEffect(() => {
    const evaluateTouchOrSmall = () => {
      const isSmall = window.innerWidth <= 1024;
      const isTouch = navigator.maxTouchPoints > 0;
      setIsTouchOrSmallScreen(isSmall || isTouch);
    };

    evaluateTouchOrSmall();
    window.addEventListener('resize', evaluateTouchOrSmall);
    return () => window.removeEventListener('resize', evaluateTouchOrSmall);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (editingCell && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setEditingCell(null);
        setSearchTerm('');
      }
    };
    if (editingCell) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [editingCell]);

  // Clear selection on Escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedCells([]);
        setEditingCell(null);
        setSearchTerm('');
        setRangeStartCell(null);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  // Get dynamic shift colors
  const getDynamicShiftColors = (): Record<string, string> => {
    const colors: Record<string, string> = { ...defaultShiftColors };
    leaveTypes.forEach(lt => {
      if (lt.color_hex) {
        colors[lt.code] = lt.color_hex;
      }
    });
    shiftTypes.forEach(st => {
      if (st.color_hex) {
        colors[st.code] = st.color_hex;
      }
    });
    return colors;
  };

  const getShiftColor = (shift: string): string => {
    const dynamicColors = getDynamicShiftColors();
    return dynamicColors[shift] || defaultShiftColors[shift] || '#FFFFFF';
  };

  // Get date range based on selected period
  const getPeriodDateRange = () => {
    const window = getRamadanPeriodWindow(year, month, selectedPeriod);
    if (window) return { start: new Date(window.from), end: new Date(window.to) };
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

  // Create pivot data structure for requests
  const pivotData = useMemo(() => {
    const data: Record<string, Record<string, { code: string; requestId?: string; force?: boolean; reason?: string; type: 'leave' | 'shift' }>> = {};
    
    employees.forEach(emp => {
      data[emp] = {};
      dates.forEach(date => {
        data[emp][date] = { code: '', type: 'leave' };
      });
    });

    // Fill in leave requests (from time_off)
    const leaveTypeCodes = new Set(leaveTypes.map(lt => lt.code));
    timeOff.forEach((item: any) => {
      const fromDate = parseDateToISO(item.from_date);
      const toDate = parseDateToISO(item.to_date);
      if (!fromDate || !toDate) return;

      const from = new Date(fromDate);
      const to = new Date(toDate);
      
      // Check if this is a leave type or non-standard shift
      const isLeaveType = leaveTypeCodes.has(item.code);
      const isNonStandard = !STANDARD_SHIFT_CODES.has(item.code);

      if (isLeaveType || isNonStandard) {
        let currentDate = new Date(from);
        while (currentDate <= to) {
          const dateStr = currentDate.toISOString().split('T')[0];
          if (data[item.employee] && data[item.employee][dateStr]) {
            data[item.employee][dateStr] = {
              code: item.code,
              requestId: item.request_id,
              reason: item.reason,
              type: 'leave',
            };
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
      }
    });

    // Fill in standard shift requests (from locks)
    locks.forEach((lock: any) => {
      const fromDate = parseDateToISO(lock.from_date);
      const toDate = parseDateToISO(lock.to_date);
      if (!fromDate || !toDate) return;

      const from = new Date(fromDate);
      const to = new Date(toDate);
      
      let currentDate = new Date(from);
      while (currentDate <= to) {
        const dateStr = currentDate.toISOString().split('T')[0];
        if (data[lock.employee] && data[lock.employee][dateStr]) {
          data[lock.employee][dateStr] = {
            code: lock.shift,
            requestId: lock.request_id,
            force: lock.force,
              reason: lock.reason,
            type: 'shift',
          };
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

    return data;
  }, [employees, dates, timeOff, locks, leaveTypes]);

  // Get organized dropdown options
  const getDropdownOptions = () => {
    const leaveTypeCodes = new Set(leaveTypes.map(lt => lt.code));
    const standardShifts = shiftTypes.filter(st => STANDARD_SHIFT_CODES.has(st.code));
    const nonStandardShifts = shiftTypes.filter(st => !STANDARD_SHIFT_CODES.has(st.code) && st.code !== 'O' && st.code !== 'DO');

    const options: Array<{ code: string; label: string; type: 'empty' | 'leave' | 'non-standard' | 'standard'; group: string }> = [
      { code: '', label: 'Empty', type: 'empty', group: 'Empty' },
    ];

    // Leave types
    leaveTypes.forEach(lt => {
      options.push({ code: lt.code, label: lt.code, type: 'leave', group: 'Leave Types' });
    });

    // Non-standard shifts
    nonStandardShifts.forEach(st => {
      options.push({ code: st.code, label: st.code, type: 'non-standard', group: 'Non-Standard Shifts' });
    });

    // Standard shifts - add both "Must" and "Cannot" variants
    standardShifts.forEach(st => {
      // Add "Must" variant (force: true) - use 📌 emoji
      options.push({ code: st.code, label: `${st.code} 📌`, type: 'standard', group: 'Standard Shifts' });
      // Add "Cannot" variant (force: false) - use 🚫 emoji, use a special code format to distinguish
      options.push({ code: `${st.code}_FORBID`, label: `${st.code} 🚫`, type: 'standard', group: 'Standard Shifts' });
    });

    // Filter by search term
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      return options.filter(opt => 
        opt.label.toLowerCase().includes(term) || 
        opt.group.toLowerCase().includes(term)
      );
    }

    return options;
  };

  const handleCellChange = async (employee: string, date: string, newCode: string) => {
    // Get cells to update - use selected cells if any, otherwise just the clicked cell
    const cellsToUpdate = selectedCells.length > 0 ? selectedCells : [{ employee, date }];

    // Process each cell
    let newTimeOff = [...timeOff];
    let newLocks = [...locks];
    let hasChanges = false;

    // Helper function to normalize date string to YYYY-MM-DD
    const normalizeDate = (dateInput: string): string => {
      const parsed = parseDateToISO(dateInput);
      if (!parsed) return '';
      return parsed.split('T')[0];
    };

    // Determine destination type to check if we're switching between leave and shift
    const options = getDropdownOptions();
    const selectedOption = options.find(opt => opt.code === newCode);

    // Collect approved employee requests (LR_/SR_) to delete via API, with span metadata for toasts
    const approvedRequestsToTrack: Array<{
      request_id: string;
      type: 'LR' | 'SR';
      employee: string;
      from_date: string;
      to_date: string;
      code?: string;
      shift?: string;
      force?: boolean;
    }> = [];

    // STEP 1: Process all cells to remove entries and collect approved requests
    for (const cell of cellsToUpdate) {
      const dateStr = parseDateToISO(cell.date) || cell.date;
      // Normalize date to YYYY-MM-DD format for comparison (no time component)
      const currentDateStr = dateStr.split('T')[0];
      
      // Find all entries to remove (for potential API deletion if approved)
      const entriesToRemoveFromTimeOff = newTimeOff.filter((item: any) => {
        const itemFromStr = normalizeDate(item.from_date);
        const itemToStr = normalizeDate(item.to_date);
        if (!itemFromStr || !itemToStr) return false;
        
        // Check if current date falls within the range (inclusive)
        return item.employee === cell.employee && 
               currentDateStr >= itemFromStr && 
               currentDateStr <= itemToStr;
      });
      
      const entriesToRemoveFromLocks = newLocks.filter((item: any) => {
        const itemFromStr = normalizeDate(item.from_date);
        const itemToStr = normalizeDate(item.to_date);
        if (!itemFromStr || !itemToStr) return false;
        
        // Check if current date falls within the range (inclusive)
        return item.employee === cell.employee && 
               currentDateStr >= itemFromStr && 
               currentDateStr <= itemToStr;
      });

      // Only collect approved requests to delete when clearing (Empty).
      if (newCode === '') {
        const approvedRequests = [
          ...entriesToRemoveFromTimeOff.filter((item: any) => item.request_id?.startsWith('LR_')),
          ...entriesToRemoveFromLocks.filter((item: any) => item.request_id?.startsWith('SR_'))
        ];
        
        // Add to collection (avoid duplicates by request_id)
        approvedRequests.forEach((item: any) => {
          const id = item.request_id;
          if (!id || approvedRequestsToTrack.some((r) => r.request_id === id)) return;
          const from = normalizeDate(item.from_date);
          const to = normalizeDate(item.to_date);
          if (id.startsWith('LR_')) {
            approvedRequestsToTrack.push({
              request_id: id,
              type: 'LR',
              employee: item.employee,
              from_date: from,
              to_date: to,
              code: item.code,
            });
          } else if (id.startsWith('SR_')) {
            approvedRequestsToTrack.push({
              request_id: id,
              type: 'SR',
              employee: item.employee,
              from_date: from,
              to_date: to,
              shift: item.shift,
              force: !!item.force,
            });
          }
        });
      }

      // Remove all entries from arrays (regardless of whether they're approved or not)
      // Use the same date normalization for consistent comparison
      const timeOffBeforeRemove = newTimeOff.length;
      newTimeOff = newTimeOff.filter((item: any) => {
        const itemFromStr = normalizeDate(item.from_date);
        const itemToStr = normalizeDate(item.to_date);
        if (!itemFromStr || !itemToStr) return true; // Keep items with invalid dates
        const coversDate = item.employee === cell.employee && 
                          currentDateStr >= itemFromStr && 
                          currentDateStr <= itemToStr;
        return !coversDate; // Keep items that don't cover this date
      });
      if (newTimeOff.length !== timeOffBeforeRemove) {
        hasChanges = true;
      }
      
      const locksBeforeRemove = newLocks.length;
      newLocks = newLocks.filter((item: any) => {
        const itemFromStr = normalizeDate(item.from_date);
        const itemToStr = normalizeDate(item.to_date);
        if (!itemFromStr || !itemToStr) return true; // Keep items with invalid dates
        const coversDate = item.employee === cell.employee && 
                          currentDateStr >= itemFromStr && 
                          currentDateStr <= itemToStr;
        return !coversDate; // Keep items that don't cover this date
      });
      if (newLocks.length !== locksBeforeRemove) {
        hasChanges = true;
      }
    }

    // STEP 2: Delete all approved requests at once (if any)
    if (approvedRequestsToTrack.length > 0) {
      try {
        await Promise.all(
          approvedRequestsToTrack.map(async (req) => {
            if (req.type === 'LR') {
              await requestsAPI.deleteLeaveRequest(req.request_id);
            } else if (req.type === 'SR') {
              await requestsAPI.deleteShiftRequest(req.request_id);
            }
          })
        );
        if (newCode === '') {
          const deleteLines = approvedRequestsToTrack.map((req) => {
            if (req.type === 'LR') {
              return formatPersonDatesDetail(
                req.employee,
                req.from_date,
                req.to_date,
                req.code || 'leave'
              );
            }
            const detail =
              req.force === false
                ? `Cannot work ${req.shift || ''}`
                : `Must work ${req.shift || ''}`;
            return formatPersonDatesDetail(req.employee, req.from_date, req.to_date, detail);
          });
          onSaveNotification({
            message: formatBatchActionNotification('Deleted', deleteLines),
            type: 'success',
          });
          onReload();
          setEditingCell(null);
          setSearchTerm('');
          setSelectedCells([]);
          return;
        }
        // If switching types, continue to create new requests below
      } catch (error: any) {
        onSaveNotification({
          message: `Failed to delete request: ${error.response?.data?.detail || 'Unknown error'}`,
          type: 'error',
        });
        return;
      }
    } else if (newCode === '') {
      // Empty option but no approved requests to delete - just save the changes
      if (hasChanges) {
        onTimeOffChange(newTimeOff);
        onLocksChange(newLocks);
        const ranges = buildContiguousRangesFromCells(cellsToUpdate);
        const deleteLines = ranges.map((r) => {
          const dKey = (parseDateToISO(r.from_date) || r.from_date).split('T')[0];
          const c = pivotData[r.employee]?.[dKey];
          let detail = 'cleared';
          if (c) {
            if (c.type === 'leave') {
              detail = c.code || 'leave';
            } else {
              detail =
                c.force === false ? `Cannot work ${c.code}` : `Must work ${c.code}`;
            }
          }
          return formatPersonDatesDetail(r.employee, r.from_date, r.to_date, detail);
        });
        onSaveNotification({
          message: formatBatchActionNotification('Deleted', deleteLines),
          type: 'success',
        });
      }
      setEditingCell(null);
      setSearchTerm('');
      setSelectedCells([]);
      return;
    }

    // STEP 3: If newCode is empty, we're done (already handled above)
    if (newCode === '') {
      return;
    }

    // STEP 4: Add the new assignment for all cells
    if (!selectedOption) {
      // No valid option selected, just save any removal changes
      if (hasChanges) {
        onTimeOffChange(newTimeOff);
        onLocksChange(newLocks);
      }
      setEditingCell(null);
      setSearchTerm('');
      setSelectedCells([]);
      return;
    }

    const rangesToUpdate = buildContiguousRangesFromCells(cellsToUpdate);

    // Create one request per contiguous range so delete/reject acts on the whole span.
    for (const range of rangesToUpdate) {
      if (selectedOption.type === 'leave' || selectedOption.type === 'non-standard') {
        const newEntry: any = {
          employee: range.employee,
          from_date: range.from_date,
          to_date: range.to_date,
          code: newCode,
          reason: 'Added via Roster Generator',
        };

        newTimeOff.push(newEntry);
        hasChanges = true;
      } else if (selectedOption.type === 'standard') {
        // Handle "Cannot" option - codes ending with "_FORBID" mean force: false
        const isForbid = newCode.endsWith('_FORBID');
        const baseShiftCode = isForbid ? newCode.replace('_FORBID', '') : newCode;

        const newEntry: any = {
          employee: range.employee,
          from_date: range.from_date,
          to_date: range.to_date,
          shift: baseShiftCode,
          // New assignment after explicit clear.
          force: isForbid ? false : true,
          reason: 'Added via Roster Generator',
        };

        newLocks.push(newEntry);
        hasChanges = true;
      }
    }

    // Apply changes if any
    if (hasChanges) {
      if (rangesToUpdate.length > 0 && onRequestSaveSummary && selectedOption) {
        const parts = rangesToUpdate.map((r) => {
          const d1 = formatDateDDMMYYYY(r.from_date);
          const d2 = formatDateDDMMYYYY(r.to_date);
          const dateStr = r.from_date === r.to_date ? d1 : `${d1}–${d2}`;
          if (selectedOption.type === 'standard') {
            const isForbid = newCode.endsWith('_FORBID');
            const baseShiftCode = isForbid ? newCode.replace('_FORBID', '') : newCode;
            const action = isForbid ? `Cannot work ${baseShiftCode}` : `Must work ${baseShiftCode}`;
            return `${r.employee} · ${dateStr} · ${action}`;
          }
          return `${r.employee} · ${dateStr} · ${newCode}`;
        });
        const msg =
          parts.length === 1
            ? `Saved · ${parts[0]}`
            : `Saved ${parts.length} requests · ${parts[0]}${parts.length > 1 ? '…' : ''}`;
        onRequestSaveSummary(msg);
      }
      // Always call both change handlers if we made changes
      // This ensures that when switching from leave to shift (or vice versa),
      // both arrays are updated correctly
      onTimeOffChange(newTimeOff);
      onLocksChange(newLocks);
    }

    setEditingCell(null);
    setSearchTerm('');
    setSelectedCells([]);
    setRangeStartCell(null);
    if (selectionMode === 'range') {
      setSelectionMode('single');
    }
  };

  // Helper function to get date range between two dates
  const getDateRange = (startDate: string, endDate: string, employee: string): Array<{ employee: string; date: string }> => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const rangeStart = start < end ? start : end;
    const rangeEnd = start < end ? end : start;
    
    const range: Array<{ employee: string; date: string }> = [];
    let current = new Date(rangeStart);
    while (current <= rangeEnd) {
      const dateStr = current.toISOString().split('T')[0];
      range.push({ employee, date: dateStr });
      current.setDate(current.getDate() + 1);
    }
    return range;
  };

  const handleCellMouseDown = (employee: string, date: string, e: React.MouseEvent) => {
    if (selectionMode === 'range') {
      return;
    }
    // Only start drag if no keyboard modifiers and not clicking on dropdown
    const isDropdown = (e.target as HTMLElement).closest('.shift-dropdown-container > div:last-child');
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !isDropdown && e.button === 0) {
      // Left mouse button only
      setIsDragging(true);
      setDragStartCell({ employee, date });
      setSelectedCells([{ employee, date }]);
      setEditingCell(null); // Close dropdown if open
      e.preventDefault(); // Prevent text selection
      e.stopPropagation();
    }
  };

  const handleCellMouseMove = (employee: string, date: string) => {
    if (isDragging && dragStartCell && dragStartCell.employee === employee) {
      // Only allow dragging within the same row (same employee)
      const range = getDateRange(dragStartCell.date, date, employee);
      setSelectedCells(range);
    }
  };

  const handleCellMouseUp = (employee: string, date: string, e: React.MouseEvent) => {
    if (isDragging) {
      setIsDragging(false);
      setDragStartCell(null);
      setJustFinishedDrag(true);
      // Don't open dropdown after drag - user can click again if they want to edit
      e.preventDefault();
      e.stopPropagation();
      // Reset flag after a short delay to allow next click
      setTimeout(() => setJustFinishedDrag(false), 100);
    }
  };

  // Global mouse up handler to end drag if mouse leaves the table
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        setDragStartCell(null);
        setJustFinishedDrag(true);
        setTimeout(() => setJustFinishedDrag(false), 100);
      }
    };
    
    if (isDragging) {
      document.addEventListener('mouseup', handleGlobalMouseUp);
      return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [isDragging]);

  const handleCellClick = (employee: string, date: string, e: React.MouseEvent) => {
    // Don't handle click if we just finished dragging or are currently dragging
    if (isDragging || justFinishedDrag) {
      return;
    }

    if (selectionMode === 'range') {
      e.preventDefault();
      e.stopPropagation();
      setEditingCell(null);
      setSearchTerm('');

      if (!rangeStartCell) {
        setRangeStartCell({ employee, date });
        setSelectedCells([{ employee, date }]);
        return;
      }

      if (rangeStartCell.employee !== employee) {
        onSaveNotification({
          message: '❌ Range selection must stay within one staff row',
          type: 'error',
        });
        setRangeStartCell({ employee, date });
        setSelectedCells([{ employee, date }]);
        return;
      }

      const range = getDateRange(rangeStartCell.date, date, employee);
      setSelectedCells(range);
      setRangeStartCell(null);
      setEditingCell({ employee, date });
      return;
    }

    const cellKey = { employee, date };
    const isSelected = selectedCells.some(c => c.employee === employee && c.date === date);
    
    // Check if this cell has an approved request
    const cell = pivotData[employee]?.[date];
    const cellRequestId = cell?.requestId;
    const hasApprovedRequest = cellRequestId && (
      cellRequestId.startsWith('LR_') || cellRequestId.startsWith('SR_')
    );
    
    // If cell has an approved request, check if it's actually approved.
    let approvedRequestInfo: { requestId: string; employee: string; type: 'leave' | 'shift' } | null = null;
    if (hasApprovedRequest && cellRequestId) {
      if (cellRequestId.startsWith('LR_')) {
        const req = allLeaveRequests.find(r => r.request_id === cellRequestId);
        if (req && req.status === 'Approved' && req.reason !== 'Added via Roster Generator') {
          approvedRequestInfo = {
            requestId: cellRequestId,
            employee: req.employee || employee,
            type: 'leave',
          };
        }
      } else if (cellRequestId.startsWith('SR_')) {
        const req = allShiftRequests.find(r => r.request_id === cellRequestId);
        if (req && req.status === 'Approved' && req.reason !== 'Added via Roster Generator') {
          approvedRequestInfo = {
            requestId: cellRequestId,
            employee: req.employee || employee,
            type: 'shift',
          };
        }
      }
    }

    // Roster-generator-created entries should be deleted first before replacement.
    const rosterGeneratorRequestInfo =
      cellRequestId &&
      cell?.reason === 'Added via Roster Generator' &&
      (cellRequestId.startsWith('LR_') || cellRequestId.startsWith('SR_'))
        ? {
            requestId: cellRequestId,
            employee,
            type: (cell.type === 'leave' ? 'leave' : 'shift') as 'leave' | 'shift',
          }
        : null;
    
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd + Click: Toggle selection
      e.preventDefault();
      if (isSelected) {
        setSelectedCells(selectedCells.filter(c => !(c.employee === employee && c.date === date)));
      } else {
        // Only allow multi-select for same employee
        if (selectedCells.length === 0 || selectedCells[0].employee === employee) {
          setSelectedCells([...selectedCells, cellKey]);
        }
      }
    } else if (e.shiftKey && selectedCells.length > 0) {
      // Shift + Click: Select range (same employee only)
      e.preventDefault();
      const lastSelected = selectedCells[selectedCells.length - 1];
      if (lastSelected.employee === employee) {
        const range = getDateRange(lastSelected.date, date, employee);
        
        // Merge with existing selection, removing duplicates
        const existingKeys = new Set(selectedCells.map(c => `${c.employee}_${c.date}`));
        const newCells = selectedCells.filter(c => c.employee !== employee); // Remove same employee cells
        range.forEach(cell => {
          const key = `${cell.employee}_${cell.date}`;
          if (!existingKeys.has(key)) {
            newCells.push(cell);
          }
        });
        setSelectedCells(newCells);
      }
    } else {
      // Regular click: Check for protected requests first
      if (approvedRequestInfo) {
        const pending = approvedRequestInfo;
        let toastInner: string | undefined;
        if (pending.type === 'leave') {
          const req = allLeaveRequests.find((r) => r.request_id === pending.requestId);
          if (req) {
            const from = (parseDateToISO(req.from_date) || req.from_date).split('T')[0];
            const to = (parseDateToISO(req.to_date) || req.to_date).split('T')[0];
            toastInner = formatPersonDatesDetail(
              req.employee || employee,
              from,
              to,
              req.leave_type || req.code || cell?.code || ''
            );
          }
        } else {
          const req = allShiftRequests.find((r) => r.request_id === pending.requestId);
          if (req) {
            const from = (parseDateToISO(req.from_date) || req.from_date).split('T')[0];
            const to = (parseDateToISO(req.to_date) || req.to_date).split('T')[0];
            const isCannot =
              req.request_type === 'Cannot' ||
              String(req.request_type || '').toLowerCase() === 'cannot';
            const detail = isCannot
              ? `Cannot work ${req.shift}`
              : `Must work ${req.shift}`;
            toastInner = formatPersonDatesDetail(req.employee || employee, from, to, detail);
          }
        }
        setPendingRejection({
          ...pending,
          action: 'reject',
          cell: { employee, date },
          toastInner,
        });
        return;
      }
      if (rosterGeneratorRequestInfo) {
        const tid = rosterGeneratorRequestInfo.requestId;
        const leaveRow = timeOff.find((x: any) => String(x.request_id) === String(tid));
        const lockRow = locks.find((x: any) => String(x.request_id) === String(tid));
        let toastInner: string | undefined;
        if (leaveRow) {
          const from = (parseDateToISO(leaveRow.from_date) || leaveRow.from_date).split('T')[0];
          const to = (parseDateToISO(leaveRow.to_date) || leaveRow.to_date).split('T')[0];
          toastInner = formatPersonDatesDetail(
            leaveRow.employee,
            from,
            to,
            leaveRow.code || ''
          );
        } else if (lockRow) {
          const from = (parseDateToISO(lockRow.from_date) || lockRow.from_date).split('T')[0];
          const to = (parseDateToISO(lockRow.to_date) || lockRow.to_date).split('T')[0];
          const detail = lockRow.force
            ? `Must work ${lockRow.shift}`
            : `Cannot work ${lockRow.shift}`;
          toastInner = formatPersonDatesDetail(lockRow.employee, from, to, detail);
        }
        setPendingRejection({
          ...rosterGeneratorRequestInfo,
          action: 'delete',
          cell: { employee, date },
          toastInner,
        });
        return;
      }
      
      // Regular click: Open dropdown (or close if already open)
      if (editingCell?.employee === employee && editingCell?.date === date) {
        setEditingCell(null);
        setSearchTerm('');
        setSelectedCells([]);
      } else {
        // If clicking on a selected cell, keep selection; otherwise clear it
        if (!isSelected) {
          setSelectedCells([{ employee, date }]);
        }
        setEditingCell({ employee, date });
      }
    }
  };

  const getDayOfWeek = (dateStr: string) => {
    const date = new Date(dateStr);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()];
  };

  const isWeekend = (dateStr: string) => {
    const day = getDayOfWeek(dateStr);
    return day === 'Fri' || day === 'Sat';
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.getDate().toString();
  };

  const groupedOptions = useMemo(() => {
    const options = getDropdownOptions();
    const groups: Record<string, typeof options> = {};
    options.forEach(opt => {
      if (!groups[opt.group]) {
        groups[opt.group] = [];
      }
      groups[opt.group].push(opt);
    });
    return groups;
  }, [searchTerm, leaveTypes, shiftTypes]);

  const handleRejectRequest = async (shouldReject: boolean) => {
    if (!pendingRejection) return;

    if (shouldReject) {
      try {
        if (pendingRejection.action === 'reject') {
          // Reject approved employee request
          if (pendingRejection.type === 'leave') {
            await requestsAPI.rejectLeaveRequest(pendingRejection.requestId);
          } else {
            await requestsAPI.rejectShiftRequest(pendingRejection.requestId);
          }
        } else {
          // Delete roster-generator request; request_id maps to whole range
          if (pendingRejection.type === 'leave') {
            await requestsAPI.deleteLeaveRequest(pendingRejection.requestId);
          } else {
            await requestsAPI.deleteShiftRequest(pendingRejection.requestId);
          }
        }
        
        // Reload requests list to get updated status
        const [leaveReqs, shiftReqs] = await Promise.all([
          requestsAPI.getAllLeaveRequests().catch(() => []),
          requestsAPI.getAllShiftRequests().catch(() => []),
        ]);
        setAllLeaveRequests(leaveReqs);
        setAllShiftRequests(shiftReqs);
        
        // Reload data to reflect the action
        onReload();
        const verb = pendingRejection.action === 'reject' ? 'Rejected' : 'Deleted';
        const msg = pendingRejection.toastInner
          ? `${verb} · ${pendingRejection.toastInner}`
          : pendingRejection.action === 'reject'
            ? 'Request rejected and removed from schedule.'
            : 'Request deleted. You can add a new value.';
        onSaveNotification({
          message: msg,
          type: 'success',
        });
      } catch (error: any) {
        onSaveNotification({ 
          message: `❌ Failed to ${pendingRejection.action === 'reject' ? 'reject' : 'delete'} request: ${error.response?.data?.detail || 'Unknown error'}`,
          type: 'error'
        });
      }
    }
    
    // Clear pending rejection
    setPendingRejection(null);
  };

  return (
    <div className="space-y-4">
      {/* Protected Request Action Dialog */}
      {pendingRejection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {pendingRejection.action === 'reject' ? 'Reject Approved Request?' : 'Delete Existing Request?'}
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              {pendingRejection.action === 'reject' ? (
                <>
                  This cell is linked to an approved request. To change it, delete the request first.
                </>
              ) : (
                <>
                  This cell is linked to an assignment added by admin. To change it, delete this assignment first.
                </>
              )}
            </p>
            {pendingRejection.toastInner && (
              <p className="mb-6 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                {pendingRejection.toastInner}
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => handleRejectRequest(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRejectRequest(true)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                {pendingRejection.action === 'reject' ? 'Reject Request' : 'Delete Request'}
              </button>
            </div>
          </div>
        </div>
      )}
      {isTouchOrSmallScreen && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-gray-300 bg-white p-1">
            <button
              onClick={() => {
                setSelectionMode('single');
                setRangeStartCell(null);
              }}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                selectionMode === 'single' ? 'bg-gray-600 text-white' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              Single
            </button>
            <button
              onClick={() => {
                setSelectionMode('range');
                setEditingCell(null);
                setSearchTerm('');
                setSelectedCells([]);
                setRangeStartCell(null);
              }}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                selectionMode === 'range' ? 'bg-gray-600 text-white' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              Range
            </button>
          </div>
          {selectionMode === 'range' && (
            <p className="text-xs text-gray-600">
              {rangeStartCell
                ? `Start set on ${rangeStartCell.employee} (${formatDate(rangeStartCell.date)}). Tap an end date.`
                : 'Tap start date, then tap end date to select a range.'}
            </p>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <table className={`min-w-full border-2 border-black text-sm ${isDragging ? 'select-none' : ''}`}>
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
                      style={weekend ? { backgroundColor: '#5f8ace' } : undefined}
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
                    const cell = pivotData[employee]?.[dateStr] || { code: '', type: 'leave' as const };
                    const code = cell.code;
                    const color = getShiftColor(code);
                    const weekend = isWeekend(dateStr);
                    const backgroundColor = weekend && !code ? '#5f8ace' : color;
                    const isEditing = editingCell?.employee === employee && editingCell?.date === dateStr;
                    const isSelected = selectedCells.some(c => c.employee === employee && c.date === dateStr);
                    const isInMultiSelect = selectedCells.length > 1 && selectedCells.some(c => c.employee === employee);
                    // If dropdown is open and this cell is selected, show blue outline (applies to all selected cells)
                    const showBlueOutline = editingCell && isSelected;

                    return (
                      <td
                        key={dateStr}
                        data-cell-key={`${employee}_${dateStr}`}
                        className="border border-black px-0.5 py-0.5 text-center font-bold text-[10px] relative"
                        style={{ backgroundColor }}
                        onMouseEnter={() => {
                          if (isDragging && dragStartCell && dragStartCell.employee === employee) {
                            handleCellMouseMove(employee, dateStr);
                          }
                        }}
                      >
                        <div className="shift-dropdown-container relative">
                          <div
                            className={`cursor-pointer transition-all min-h-[18px] flex items-center justify-center leading-tight ${
                              showBlueOutline ? 'ring-2 ring-blue-500 rounded' : 
                              isSelected ? 'ring-2 ring-yellow-400 ring-opacity-75 rounded bg-yellow-50 bg-opacity-30' :
                              'hover:scale-110 hover:bg-gray-100 hover:bg-opacity-50 rounded'
                            } ${!code ? 'border border-dashed border-gray-300' : ''} ${isDragging && dragStartCell?.employee === employee ? 'select-none' : ''}`}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleCellMouseDown(employee, dateStr, e);
                            }}
                            onMouseUp={(e) => {
                              e.stopPropagation();
                              handleCellMouseUp(employee, dateStr, e);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCellClick(employee, dateStr, e);
                            }}
                            title={
                              isInMultiSelect && isSelected 
                                ? `${selectedCells.length} cells selected - Click to assign all` 
                                : code || 'Click to add request (Ctrl/Cmd+Click for multi-select)'
                            }
                          >
                            {code || (isEditing ? '' : <span className="text-gray-400 text-[10px]">+</span>)}
                            {/* Only show pin/🚫 for standard shifts (which have force property) */}
                            {cell.force !== undefined && code && STANDARD_SHIFT_CODES.has(code) && (
                              <span className={`ml-0.5 text-[8px] ${cell.force ? '' : 'text-red-600'}`}>
                                {cell.force ? '📌' : '🚫'}
                              </span>
                            )}
                          </div>
                          {isEditing && (
                            <div 
                              ref={dropdownRef}
                              className="absolute top-full left-0 z-50 bg-white border-2 border-gray-300 rounded-lg shadow-xl mt-1 max-h-64 overflow-y-auto min-w-[200px] shift-dropdown-container"
                            >
                              {selectedCells.length > 1 && (
                                <div className="p-2 bg-yellow-50 border-b border-yellow-200">
                                  <p className="text-xs font-medium text-yellow-800">
                                    Applying to {selectedCells.length} selected cells
                                  </p>
                                </div>
                              )}
                              <div className="p-2 border-b border-gray-200 bg-white">
                                <input
                                  type="text"
                                  placeholder="Search..."
                                  value={searchTerm}
                                  onChange={(e) => setSearchTerm(e.target.value)}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                                  autoFocus
                                />
                              </div>
                              <div className="p-1">
                                {Object.entries(groupedOptions).map(([groupName, groupOptions]) => (
                                  <div key={groupName}>
                                    <div className="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0">
                                      {groupName}
                                    </div>
                                    {groupOptions.map((option) => {
                                      // For standard shifts, check if this option matches the current cell
                                      // Handle both regular codes and _FORBID variants
                                      let isSelected = false;
                                      if (option.type === 'standard') {
                                        const baseCode = option.code.endsWith('_FORBID') ? option.code.replace('_FORBID', '') : option.code;
                                        const isForbidOption = option.code.endsWith('_FORBID');
                                        // Match if code matches and force state matches
                                        isSelected = code === baseCode && (
                                          (isForbidOption && cell.force === false) ||
                                          (!isForbidOption && (cell.force === true || cell.force === undefined))
                                        );
                                      } else {
                                        isSelected = code === option.code;
                                      }
                                      const optionColor = getShiftColor(option.code.endsWith('_FORBID') ? option.code.replace('_FORBID', '') : option.code);
                                      return (
                                        <div
                                          key={option.code || 'empty'}
                                          className={`px-3 py-2 cursor-pointer hover:bg-gray-100 rounded flex items-center justify-between ${
                                            isSelected ? 'bg-blue-50 border border-blue-300' : ''
                                          }`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            // Apply to all selected cells if multi-select, otherwise just this cell
                                            // The handleCellChange function will handle applying to all selected cells
                                            handleCellChange(employee, dateStr, option.code);
                                          }}
                                        >
                                          <div className="flex items-center space-x-2">
                                            <div
                                              className="w-4 h-4 border border-gray-300 rounded"
                                              style={{ backgroundColor: optionColor }}
                                            />
                                            <span className={`text-sm font-medium ${option.code.endsWith('_FORBID') ? '' : ''}`}>
                                              {option.code.endsWith('_FORBID') ? (
                                                <>
                                                  {option.label.replace(' 🚫', '')} <span className="text-red-600">🚫</span>
                                                </>
                                              ) : (
                                                option.label
                                              )}
                                            </span>
                                          </div>
                                          {isSelected && (
                                            <span className="text-blue-600 text-xs">✓</span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
