import React, { useState, useEffect, useMemo, useRef } from 'react';
import { leaveTypesAPI, shiftTypesAPI, LeaveType, ShiftType, requestsAPI, dataAPI } from '../services/api';
import { parseDateToISO } from '../utils/dateFormat';
import { shiftColors as defaultShiftColors } from '../utils/shiftColors';

interface RequestsScheduleProps {
  year: number;
  month: number;
  employees: string[];
  timeOff: any[];
  locks: any[];
  onTimeOffChange: (newData: any[]) => void;
  onLocksChange: (newData: any[]) => void;
  onSaveNotification: (notification: { message: string; type: 'success' | 'error' }) => void;
  onReload: () => void;
}

// Standard working shifts that go to locks
const STANDARD_SHIFT_CODES = new Set(['M', 'IP', 'A', 'N', 'M3', 'M4', 'H', 'CL', 'E']);

export const RequestsSchedule: React.FC<RequestsScheduleProps> = ({
  year,
  month,
  employees,
  timeOff,
  locks,
  onTimeOffChange,
  onLocksChange,
  onSaveNotification,
  onReload,
}) => {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [editingCell, setEditingCell] = useState<{ employee: string; date: string } | null>(null);
  const [selectedCells, setSelectedCells] = useState<Array<{ employee: string; date: string }>>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartCell, setDragStartCell] = useState<{ employee: string; date: string } | null>(null);
  const [justFinishedDrag, setJustFinishedDrag] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadTypes = async () => {
      try {
        const [leaveTypesData, shiftTypesData] = await Promise.all([
          leaveTypesAPI.getLeaveTypes(true),
          shiftTypesAPI.getShiftTypes(true),
        ]);
        setLeaveTypes(leaveTypesData);
        setShiftTypes(shiftTypesData);
      } catch (error) {
        console.error('Failed to load types:', error);
      }
    };
    loadTypes();
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
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  // Get dynamic shift colors
  const getDynamicShiftColors = (): Record<string, string> => {
    const colors: Record<string, string> = { ...defaultShiftColors };
    leaveTypes.forEach(lt => {
      colors[lt.code] = lt.color_hex || '#F5F5F5';
    });
    shiftTypes.forEach(st => {
      colors[st.code] = st.color_hex || '#E5E7EB';
    });
    return colors;
  };

  const getShiftColor = (shift: string): string => {
    const dynamicColors = getDynamicShiftColors();
    return dynamicColors[shift] || '#FFFFFF';
  };

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

  // Create pivot data structure for requests
  const pivotData = useMemo(() => {
    const data: Record<string, Record<string, { code: string; requestId?: string; force?: boolean; type: 'leave' | 'shift' }>> = {};
    
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
    
    // Collect all approved requests to delete (across all cells) before processing
    const allApprovedRequestsToDelete: Array<{ request_id: string; type: 'LR' | 'SR' }> = [];

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

      // Check if we're switching between types (leave <-> shift)
      const isSwitchingToLeave = selectedOption && (selectedOption.type === 'leave' || selectedOption.type === 'non-standard');
      const isSwitchingToShift = selectedOption && selectedOption.type === 'standard';
      
      // Collect approved requests to delete (if selecting Empty or switching types)
      if (newCode === '' || (selectedOption && (
        (isSwitchingToLeave && entriesToRemoveFromLocks.some((item: any) => item.request_id?.startsWith('SR_'))) ||
        (isSwitchingToShift && entriesToRemoveFromTimeOff.some((item: any) => item.request_id?.startsWith('LR_')))
      ))) {
        const approvedRequests = [
          ...entriesToRemoveFromTimeOff.filter((item: any) => item.request_id?.startsWith('LR_')),
          ...entriesToRemoveFromLocks.filter((item: any) => item.request_id?.startsWith('SR_'))
        ];
        
        // Add to collection (avoid duplicates by request_id)
        approvedRequests.forEach((item: any) => {
          if (item.request_id && !allApprovedRequestsToDelete.some(r => r.request_id === item.request_id)) {
            allApprovedRequestsToDelete.push({
              request_id: item.request_id,
              type: item.request_id.startsWith('LR_') ? 'LR' : 'SR'
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
    if (allApprovedRequestsToDelete.length > 0) {
      try {
        await Promise.all(allApprovedRequestsToDelete.map(async (req) => {
          if (req.type === 'LR') {
            await requestsAPI.deleteLeaveRequest(req.request_id);
          } else if (req.type === 'SR') {
            await requestsAPI.deleteShiftRequest(req.request_id);
          }
        }));
        if (newCode === '') {
          // For Empty option, we're done after deleting and removing entries
          onSaveNotification({ message: '✅ Request(s) deleted successfully!', type: 'success' });
          onReload();
          setEditingCell(null);
          setSearchTerm('');
          setSelectedCells([]);
          return;
        }
        // If switching types, continue to create new requests below
      } catch (error: any) {
        onSaveNotification({ 
          message: `❌ Failed to delete request: ${error.response?.data?.detail || 'Unknown error'}`,
          type: 'error'
        });
        return;
      }
    } else if (newCode === '') {
      // Empty option but no approved requests to delete - just save the changes
      if (hasChanges) {
        onTimeOffChange(newTimeOff);
        onLocksChange(newLocks);
        onSaveNotification({ message: '✅ Cells cleared successfully!', type: 'success' });
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

    const leaveTypeCodes = new Set(leaveTypes.map(lt => lt.code));

    // Process each cell to add new assignments
    for (const cell of cellsToUpdate) {
      const dateStr = parseDateToISO(cell.date) || cell.date;
      const currentDateStr = dateStr.split('T')[0];

      // Find what was removed for this cell to preserve request_id/force
      // We need to check the original arrays before removal
      const entriesRemovedFromTimeOff = timeOff.filter((item: any) => {
        const itemFromStr = normalizeDate(item.from_date);
        const itemToStr = normalizeDate(item.to_date);
        if (!itemFromStr || !itemToStr) return false;
        return item.employee === cell.employee && 
               currentDateStr >= itemFromStr && 
               currentDateStr <= itemToStr;
      });
      
      const entriesRemovedFromLocks = locks.filter((item: any) => {
        const itemFromStr = normalizeDate(item.from_date);
        const itemToStr = normalizeDate(item.to_date);
        if (!itemFromStr || !itemToStr) return false;
        return item.employee === cell.employee && 
               currentDateStr >= itemFromStr && 
               currentDateStr <= itemToStr;
      });

      // Find existing item based on the destination type
      // Only preserve request_id when switching within the same type (leave->leave or shift->shift)
      let existingItem: any = null;
      
      if (selectedOption.type === 'leave' || selectedOption.type === 'non-standard') {
        // Going to time_off - only preserve request_id if coming from time_off (leave/non-standard)
        existingItem = entriesRemovedFromTimeOff.find((item: any) => 
          item.code && (leaveTypeCodes.has(item.code) || !STANDARD_SHIFT_CODES.has(item.code))
        ) || null;
      } else if (selectedOption.type === 'standard') {
        // Going to locks - only preserve request_id if coming from locks (standard shift)
        existingItem = entriesRemovedFromLocks.find((item: any) =>
          (item.shift && STANDARD_SHIFT_CODES.has(item.shift)) ||
          (item.code && STANDARD_SHIFT_CODES.has(item.code))
        ) || null;
      }

      if (selectedOption.type === 'leave' || selectedOption.type === 'non-standard') {
        // Go to time_off
        const newEntry: any = {
          employee: cell.employee,
          from_date: dateStr,
          to_date: dateStr,
          code: newCode,
          reason: 'Added via Roster Generator',
        };

        // Only preserve request_id if switching within leave types (not from shift to leave)
        if (existingItem?.request_id && existingItem.request_id.startsWith('LR_')) {
          newEntry.request_id = existingItem.request_id;
        }

        newTimeOff.push(newEntry);
        hasChanges = true;
      } else if (selectedOption.type === 'standard') {
        // Go to locks
        // Handle "Cannot" option - codes ending with "_FORBID" mean force: false
        const isForbid = newCode.endsWith('_FORBID');
        const baseShiftCode = isForbid ? newCode.replace('_FORBID', '') : newCode;
        
        const newEntry: any = {
          employee: cell.employee,
          from_date: dateStr,
          to_date: dateStr,
          shift: baseShiftCode,
          // If explicitly selecting "Cannot", set force to false; otherwise preserve existing or default to true
          force: isForbid ? false : (existingItem?.force ?? true),
          reason: 'Added via Roster Generator',
        };

        // Only preserve request_id if switching within shift types (not from leave to shift)
        if (existingItem?.request_id && existingItem.request_id.startsWith('SR_')) {
          newEntry.request_id = existingItem.request_id;
        }

        newLocks.push(newEntry);
        hasChanges = true;
      }
    }

    // Apply changes if any
    if (hasChanges) {
      // Always call both change handlers if we made changes
      // This ensures that when switching from leave to shift (or vice versa),
      // both arrays are updated correctly
      onTimeOffChange(newTimeOff);
      onLocksChange(newLocks);
    }

    setEditingCell(null);
    setSearchTerm('');
    setSelectedCells([]);
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

    const cellKey = { employee, date };
    const isSelected = selectedCells.some(c => c.employee === employee && c.date === date);
    
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

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <table className={`min-w-full border-2 border-black text-sm ${isDragging ? 'select-none' : ''}`}>
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-black px-1 py-1 text-left font-bold sticky left-0 bg-gray-100 z-10 text-[10px]">
                  Employee
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
                      <div className="text-[10px] text-gray-500 leading-tight">{getDayOfWeek(dateStr)[0]}</div>
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
