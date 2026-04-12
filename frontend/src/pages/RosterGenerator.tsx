import React, { useState, useEffect, useRef, useMemo } from 'react';
import { dataAPI, solverAPI, schedulesAPI, SolveRequest, JobStatus, leaveTypesAPI, LeaveType, shiftTypesAPI, ShiftType, requestsAPI } from '../services/api';
import { ScheduleTable } from '../components/ScheduleTable';
import { EditableTable } from '../components/EditableTable';
import { DemandsTab } from '../components/DemandsTab';
import { ScheduleAnalysis } from '../components/ScheduleAnalysis';
import { RequestsSchedule } from '../components/RequestsSchedule';
import { useAuth } from '../contexts/AuthContext';
import { CalendarDatePicker } from '../components/CalendarDatePicker';
import { formatDateDDMMYYYY, parseDateToISO } from '../utils/dateFormat';
import { calculatePendingOff } from '../utils/pendingOffCalculation';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Local calendar date YYYY-MM-DD (for comparing to fixed Ramadan 2026 boundaries). */
function formatLocalYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type RosterMonthOption = {
  month: string;
  number: number;
  isPeriod?: boolean;
  periodId?: string;
};

/** Month/period choices for Roster Generator: from today onward only (current month included). */
function getAvailableMonthOptions(
  year: number | null,
  now: Date,
  names: readonly string[] = MONTH_NAMES
): RosterMonthOption[] {
  if (!year) return [];
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const todayStr = formatLocalYMD(now);

  if (year === 2026) {
    const months: RosterMonthOption[] = [];
    if (todayStr <= '2026-02-18') {
      months.push({ month: 'February (Pre-Ramadan)', number: 2, isPeriod: true, periodId: 'pre-ramadan' });
    }
    if (todayStr <= '2026-03-18') {
      months.push({ month: 'Ramadan', number: 2, isPeriod: true, periodId: 'ramadan' });
    }
    if (todayStr <= '2026-03-31') {
      months.push({ month: 'March (Post-Ramadan)', number: 3, isPeriod: true, periodId: 'post-ramadan' });
    }
    names.forEach((month, index) => {
      const monthNum = index + 1;
      if (monthNum < 4) return;
      if (year === currentYear && monthNum < currentMonth) return;
      months.push({ month, number: monthNum, isPeriod: false, periodId: undefined });
    });
    return months;
  }

  if (year === currentYear) {
    return names
      .map((month, index) => ({ month, number: index + 1, isPeriod: false as boolean, periodId: undefined }))
      .filter(({ number }) => number >= currentMonth);
  }

  if (year > currentYear) {
    return names.map((month, index) => ({ month, number: index + 1, isPeriod: false, periodId: undefined }));
  }

  return [];
}

function isSelectionValidForYear(
  year: number,
  month: number | null,
  period: string | null,
  now: Date
): boolean {
  if (month == null) return false;
  const opts = getAvailableMonthOptions(year, now, MONTH_NAMES);
  return opts.some((opt) => {
    if (opt.isPeriod && opt.periodId) {
      return period === opt.periodId && opt.number === month;
    }
    return !period && opt.number === month;
  });
}

export const RosterGenerator: React.FC = () => {
  const [activeTab, setActiveTab] = useState('employees');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null); // 'pre-ramadan', 'ramadan', 'post-ramadan', or null for full month
  const [rosterData, setRosterData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [solving, setSolving] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [generatedSchedule, setGeneratedSchedule] = useState<any[] | null>(null);
  const [originalGeneratedSchedule, setOriginalGeneratedSchedule] = useState<any[] | null>(null);
  const [generatedEmployees, setGeneratedEmployees] = useState<any[] | null>(null);
  const [scheduleMetrics, setScheduleMetrics] = useState<any>(null);
  const [showAddTimeOff, setShowAddTimeOff] = useState(false);
  const [showAddLock, setShowAddLock] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [allShiftRequests, setAllShiftRequests] = useState<any[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const jobNotFoundCountRef = useRef<number>(0);
  const hasShownFailureAlertRef = useRef<boolean>(false);
  const defaultSelectionAppliedRef = useRef(false);

  // Wait for auth to be ready before loading data
  const { loading: authLoading } = useAuth();
  
  useEffect(() => {
    // CRITICAL: Don't load data until auth is fully ready
    // This prevents 401 errors during initial load
    if (!authLoading) {
      loadRosterData(0);
      loadLeaveTypes();
      loadShiftTypes();
      loadAllShiftRequests();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // Default year/month to first option from today (current month or next available period)
  useEffect(() => {
    if (loading || authLoading || defaultSelectionAppliedRef.current) return;
    if (selectedYear !== null || selectedMonth !== null) return;

    const now = new Date();
    const firstYear = Math.max(2026, now.getFullYear());
    const months = getAvailableMonthOptions(firstYear, now, MONTH_NAMES);
    if (months.length === 0) return;

    defaultSelectionAppliedRef.current = true;
    setSelectedYear(firstYear);
    const first = months[0];
    if (first.isPeriod && first.periodId) {
      setSelectedPeriod(first.periodId);
      setSelectedMonth(first.number);
    } else {
      setSelectedPeriod(null);
      setSelectedMonth(first.number);
    }
  }, [loading, authLoading, selectedYear, selectedMonth]);

  const loadLeaveTypes = async () => {
    try {
      const types = await leaveTypesAPI.getLeaveTypes(true); // Only active types
      setLeaveTypes(types);
    } catch (error) {
      console.error('Failed to load leave types:', error);
    }
  };

  const loadShiftTypes = async () => {
    try {
      const types = await shiftTypesAPI.getShiftTypes(true); // Only active types
      console.log('Loaded shift types:', types); // Debug log
      console.log('Shift type codes:', types.map(t => t.code)); // Debug log - show all codes
      setShiftTypes(types);
    } catch (error) {
      console.error('Failed to load shift types:', error);
    }
  };

  const loadAllShiftRequests = async () => {
    try {
      const requests = await requestsAPI.getAllShiftRequests(); // Get all shift requests (manager only)
      setAllShiftRequests(requests);
    } catch (error) {
      console.error('Failed to load shift requests:', error);
      setAllShiftRequests([]);
    }
  };

  // Reload roster data when switching to requests step to show newly approved requests
  useEffect(() => {
    if (activeTab === 'requests') {
      // Small delay to ensure previous operations complete
      const timer = setTimeout(() => {
        loadRosterData(0);
        loadShiftTypes(); // Reload shift types when switching to requests tab to get latest types
        loadAllShiftRequests(); // Reload shift requests to get latest data
      }, 100);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Reset active step when year/month are not selected
  useEffect(() => {
    if (!selectedYear || !selectedMonth) {
      setActiveTab('employees');
    }
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    clearGeneratedResults();
    setSolving(false);
    // Reset period selection when year/month changes (unless it's still 2026 Feb/Mar)
    if (!(selectedYear === 2026 && (selectedMonth === 2 || selectedMonth === 3))) {
      setSelectedPeriod(null);
    }
  }, [selectedYear, selectedMonth, selectedPeriod]);

  useEffect(() => {
    if (jobId && solving) {
      const interval = setInterval(() => {
        checkJobStatus(jobId);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [jobId, solving]);

  const loadRosterData = async (retryCount = 0): Promise<void> => {
    const maxRetries = 2;
    try {
      setLoading(true);
      const data = await dataAPI.getRosterData();
      
      // Log request_ids for debugging
      const timeOffWithIds = (data.time_off || []).filter((item: any) => item.request_id);
      const locksWithIds = (data.locks || []).filter((item: any) => item.request_id);
      
      setRosterData(data);
    } catch (error: any) {
      console.error('Failed to load roster data:', error);
      
      // Retry on 500 errors (server errors might be transient)
      if (error.response?.status === 500 && retryCount < maxRetries) {
        console.log(`Retrying loadRosterData (attempt ${retryCount + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
        return loadRosterData(retryCount + 1);
      }
      
      // Show user-friendly error message only on final failure
      if (retryCount >= maxRetries) {
        const errorMessage = error.response?.data?.detail || error.message || 'Failed to load roster data';
        console.error('Final failure after retries:', errorMessage);
        // Don't show alert on every failure - just log it
        // The user can manually retry by navigating away and back
      }
    } finally {
      setLoading(false);
    }
  };

  const checkJobStatus = async (id: string) => {
    try {
      const status = await solverAPI.getJobStatus(id);
      // Reset not found count on successful check
      jobNotFoundCountRef.current = 0;
      setJobStatus(status);

      if (status.status === 'completed' && status.result) {
        setSolving(false);
        setGeneratedSchedule(status.result.schedule);
        setOriginalGeneratedSchedule(JSON.parse(JSON.stringify(status.result.schedule))); // Store original for reverse calculation
        setGeneratedEmployees(status.result.employees || null);
        setScheduleMetrics(status.result.metrics || { solve_time: 0, status: 'completed' });
        setActiveTab('schedule');
      } else if (status.status === 'failed') {
        setSolving(false);
        // Brief alert - detailed issues will be shown in the red box below
        // Only show alert once to avoid duplicate popups
        if (!hasShownFailureAlertRef.current) {
          hasShownFailureAlertRef.current = true;
          alert('Solver failed. Check below for potential cause(s).');
        }
      }
    } catch (error: any) {
      // Handle 404 gracefully - job might not exist yet (race condition) or was lost
      if (error.response?.status === 404) {
        jobNotFoundCountRef.current += 1;
        // Only stop polling after 3 consecutive 404s (6 seconds) to handle race conditions
        if (jobNotFoundCountRef.current >= 3) {
          setSolving(false);
          setJobId(null);
          jobNotFoundCountRef.current = 0;
          alert('Job not found. The backend may have restarted. Please try generating the schedule again.');
        }
        // Don't log every 404 to avoid spam - only log the first one
        if (jobNotFoundCountRef.current === 1) {
          console.warn('Job not found (may be a race condition or backend restart). Retrying...');
        }
      } else {
        // Other errors - log but don't spam console
        if (error.response?.status !== 429) { // Don't log rate limit errors
      console.error('Failed to check job status:', error);
        }
      }
    }
  };

  const clearGeneratedResults = () => {
    setGeneratedSchedule(null);
    setOriginalGeneratedSchedule(null);
    setGeneratedEmployees(null);
    setScheduleMetrics(null);
    setJobId(null);
    setJobStatus(null);
    hasShownFailureAlertRef.current = false; // Reset alert flag when clearing results
  };

  const handleGenerate = async () => {
    if (!selectedYear || !selectedMonth) {
      alert('Please select both year and month');
      return;
    }

    try {
      setSolving(true);
      
      // Determine date range based on selected period (for 2026 February/March)
      let startDate: string | undefined;
      let endDate: string | undefined;
      
      if (selectedYear === 2026 && (selectedMonth === 2 || selectedMonth === 3) && selectedPeriod) {
        if (selectedPeriod === 'pre-ramadan') {
          // February (Pre-Ramadan): Feb 1-18, 2026
          startDate = '2026-02-01';
          endDate = '2026-02-18';
        } else if (selectedPeriod === 'ramadan') {
          // Ramadan: Feb 19 - March 18, 2026
          startDate = '2026-02-19';
          endDate = '2026-03-18';
        } else if (selectedPeriod === 'post-ramadan') {
          // March (Post-Ramadan): March 19-31, 2026
          startDate = '2026-03-19';
          endDate = '2026-03-31';
        }
      }
      
      const request: SolveRequest = {
        year: selectedYear,
        month: selectedMonth,
        time_limit: 120,
        unfilled_penalty: 1000.0,
        fairness_weight: 5.0,
        ...(startDate && endDate ? { start_date: startDate, end_date: endDate } : {}),
      };

      const response = await solverAPI.solve(request);
      setJobId(response.job_id);
      setJobStatus({ job_id: response.job_id, status: 'pending' });
      jobNotFoundCountRef.current = 0; // Reset not found counter when starting new job
      hasShownFailureAlertRef.current = false; // Reset alert flag when starting new generation
    } catch (error: any) {
      setSolving(false);
      alert(error.response?.data?.detail || 'Failed to start solver');
    }
  };

  const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const initialEmployeesRef = React.useRef<any[] | null>(null);
  const timeOffSaveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const locksSaveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const isSavingTimeOffRef = React.useRef<boolean>(false);
  const [saveNotification, setSaveNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Store initial employees data when it's loaded
  useEffect(() => {
    if (rosterData?.employees && !initialEmployeesRef.current) {
      initialEmployeesRef.current = JSON.parse(JSON.stringify(rosterData.employees));
    }
  }, [rosterData?.employees]);

  const handleEmployeesChange = async (newData: any[]) => {
    // Check for duplicate employee names
    const employeeNames = newData.map(emp => emp.employee?.trim()).filter(name => name);
    const duplicates = employeeNames.filter((name, index) => employeeNames.indexOf(name) !== index);
    
    if (duplicates.length > 0) {
      const uniqueDuplicates = Array.from(new Set(duplicates));
      setSaveNotification({ 
        message: `❌ Duplicate employee names found: ${uniqueDuplicates.join(', ')}. Each employee must have a unique name.`,
        type: 'error'
      });
      setTimeout(() => setSaveNotification(null), 5000);
      return;
    }

    // Check for empty employee names
    const emptyNames = newData.filter(emp => !emp.employee || !emp.employee.trim());
    if (emptyNames.length > 0) {
      setSaveNotification({ 
        message: '❌ Employee names cannot be empty. Please enter a name for all employees.',
        type: 'error'
      });
      setTimeout(() => setSaveNotification(null), 5000);
      return;
    }

    // Check if data actually changed from initial load
    const initialData = initialEmployeesRef.current || [];
    const hasChanged = JSON.stringify(initialData) !== JSON.stringify(newData);
    
    if (!hasChanged) {
      // Data hasn't changed, don't save or show notification
      return;
    }

    clearGeneratedResults();

    // Clear any existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Delay the save - only save after user stops typing for 2 seconds
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        // Save employees permanently to backend
        await dataAPI.updateEmployees(newData);
        setRosterData({ ...rosterData, employees: newData });
        // Update initial reference to current data
        initialEmployeesRef.current = JSON.parse(JSON.stringify(newData));
        // Show success notification (auto-dismisses)
        setSaveNotification({ message: '✅ Employees saved successfully!', type: 'success' });
        setTimeout(() => setSaveNotification(null), 2000);
      } catch (error: any) {
        console.error('Failed to save employees:', error);
        setSaveNotification({ 
          message: `❌ ${error.response?.data?.detail || 'Failed to save employees'}`,
          type: 'error'
        });
        setTimeout(() => setSaveNotification(null), 4000);
      }
    }, 2000); // 2 second delay after user stops typing
  };

  const handleDemandsChange = async (newData: any[]) => {
    // TODO: Implement API call to save demands
    clearGeneratedResults();
    setRosterData({ ...rosterData, demands: newData });
  };

  const handleCommitSchedule = async () => {
    if (!generatedSchedule || !selectedYear || !selectedMonth) {
      alert('No schedule to commit');
      return;
    }

    try {
      // Normalize all dates to ISO format (YYYY-MM-DDTHH:MM:SS) before sending
      const normalizedSchedule = generatedSchedule.map(entry => ({
        ...entry,
        date: entry.date.includes('T') ? entry.date : `${entry.date.split('T')[0]}T00:00:00`
      }));
      
      await schedulesAPI.commitSchedule(
        selectedYear,
        selectedMonth,
        normalizedSchedule,
        generatedEmployees || undefined,
        scheduleMetrics || undefined
      );
      alert('✅ Schedule committed successfully! It will now appear in Monthly Roster and Reports pages.');
    } catch (error: any) {
      alert(error.response?.data?.detail || 'Failed to commit schedule');
    }
  };

  const handleTimeOffChange = async (newData: any[]) => {
    // Prevent concurrent API calls - if we're already in the middle of an API call, skip
    // But allow new saves if we're just waiting for debounce timeout
    if (isSavingTimeOffRef.current) {
      console.log('⏭️ Skipping save - API call in progress');
      // Still update local state so UI reflects the change
      setRosterData((prev: any) => (prev ? { ...prev, time_off: newData } : prev));
      return;
    }
    
    console.log('handleTimeOffChange called with', newData.length, 'items:', newData);
    
    // Store original data BEFORE updating state (needed for change detection)
    const originalTimeOff = rosterData?.time_off || [];
    
    clearGeneratedResults();
    setRosterData((prev: any) => (prev ? { ...prev, time_off: newData } : prev));

    if (timeOffSaveTimeoutRef.current) {
      clearTimeout(timeOffSaveTimeoutRef.current);
      // If we cleared a timeout, that means we're starting a new save cycle
      // The previous save never actually executed, so it's safe to proceed
    }

    timeOffSaveTimeoutRef.current = setTimeout(async () => {
      // Set flag at the start of actual API operations
      isSavingTimeOffRef.current = true;
      try {
        // Normalize dates to ensure YYYY-MM-DD format before saving
        const normalizedData = newData.map((item: any) => {
          const isoFromDate = parseDateToISO(item.from_date);
          const isoToDate = parseDateToISO(item.to_date);
          
          // Validate dates
          if (!isoFromDate || !isoToDate || !isoFromDate.match(/^\d{4}-\d{2}-\d{2}$/) || !isoToDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
            console.error('Invalid date format in time-off item:', item);
            return item; // Return original if invalid
          }
          
          return {
            ...item,
            from_date: isoFromDate,
            to_date: isoToDate,
          };
        });
        
        // Group items by request_id to handle multi-day requests correctly
        // A single leave request can span multiple days, so we need to group by request_id
        const leaveRequestsByRequestId = new Map<string, any[]>();
        const leaveRequestsToCreate: any[] = [];
        const leaveTypeCodes = new Set(leaveTypes.map(lt => lt.code));
        
        normalizedData.forEach((item: any) => {
          // Only process leave types (not shift codes)
          if (!leaveTypeCodes.has(item.code)) {
            leaveRequestsToCreate.push(item); // Shift codes go to create list
            return;
          }
          
          // Check if this is a range (from_date != to_date) - these are already grouped correctly
          const isRange = item.from_date !== item.to_date;
          
          // Check if this is an edit (has request_id and reason is 'Added via Roster Generator')
          // For leave requests, only accept LR_ prefix (not SR_ which is for shift requests)
          const hasRequestId = item.request_id && (
            item.request_id.toString().startsWith('LR_') ||
            item.request_id.toString().trim() !== ''
          );
          
          // Check if reason indicates it's a Roster Generator request
          const isRosterGeneratorRequest = item.reason === 'Added via Roster Generator' || !item.reason;
          
          if (hasRequestId && isRosterGeneratorRequest) {
            // This is an existing request - if it's a range, use it directly
            // If it's a single day, we might need to group with other days (from old expanded data)
            const reqId = item.request_id.toString();
            
            if (isRange) {
              // Range - this is already one request, use it directly
              if (!leaveRequestsByRequestId.has(reqId)) {
                leaveRequestsByRequestId.set(reqId, []);
              }
              leaveRequestsByRequestId.get(reqId)!.push(item);
            } else {
              // Single day - might be from old expanded data, group by request_id
              if (!leaveRequestsByRequestId.has(reqId)) {
                leaveRequestsByRequestId.set(reqId, []);
              }
              leaveRequestsByRequestId.get(reqId)!.push(item);
            }
          } else if (item.request_ids && Array.isArray(item.request_ids) && item.request_ids.length > 0) {
            // If we have multiple request_ids, group by each one
            item.request_ids.forEach((reqId: string) => {
              if (reqId) {
                if (!leaveRequestsByRequestId.has(reqId)) {
                  leaveRequestsByRequestId.set(reqId, []);
                }
                leaveRequestsByRequestId.get(reqId)!.push({
                  ...item,
                  request_id: reqId,
                });
              }
            });
          } else {
            // New request (no request_id) - will be created as a range
            leaveRequestsToCreate.push(item);
          }
        });
        
        // Update existing leave requests via API - ONLY if dates actually changed
        // For each request_id, find the min from_date and max to_date to update the single request
        let hadSuccessfulUpdates = false;
        if (leaveRequestsByRequestId.size > 0) {
          // Get original data to compare against (use the stored original, not current state)
          const filteredTimeOff = originalTimeOff.filter((item: any) => 
            leaveTypes.some(lt => lt.code === item.code)
          );
          const originalMap = new Map<string, any>();
          filteredTimeOff.forEach((item: any) => {
            if (item.request_id) {
              originalMap.set(item.request_id.toString(), item);
            }
          });
          
          const requestsToUpdate: Array<[string, any[]]> = [];
          
          // Update requests where dates OR leave type (code) changed
          Array.from(leaveRequestsByRequestId.entries()).forEach(([requestId, items]) => {
            const originalItem = originalMap.get(requestId);
            
            if (!originalItem) {
              // No original found, need to update
              requestsToUpdate.push([requestId, items]);
              return;
            }
            
            // Normalize new dates
            const normalizedItems = items.map((item: any) => ({
              ...item,
              from_date: parseDateToISO(item.from_date) || item.from_date,
              to_date: parseDateToISO(item.to_date) || item.to_date,
            }));
            
            const hasRange = normalizedItems.some((item: any) => item.from_date !== item.to_date);
            let newFromDate: string;
            let newToDate: string;
            
            if (hasRange) {
              let widestRange = normalizedItems[0];
              let widestSpan = 0;
              normalizedItems.forEach((item: any) => {
                const span = new Date(item.to_date).getTime() - new Date(item.from_date).getTime();
                if (span > widestSpan) {
                  widestSpan = span;
                  widestRange = item;
                }
              });
              newFromDate = widestRange.from_date;
              newToDate = widestRange.to_date;
            } else {
              const fromDates = normalizedItems.map((item: any) => item.from_date).filter(Boolean).sort();
              const toDates = normalizedItems.map((item: any) => item.to_date).filter(Boolean).sort();
              newFromDate = fromDates[0];
              newToDate = toDates[toDates.length - 1];
            }
            
            // Compare with original - check both dates AND leave type (code)
            const origFrom = parseDateToISO(originalItem.from_date);
            const origTo = parseDateToISO(originalItem.to_date);
            const origCode = originalItem.code;
            
            // Get the new code from the items (should be the same across all items in the group)
            const newCode = normalizedItems[0]?.code;
            
            // Update if dates changed OR leave type changed
            if (newFromDate !== origFrom || newToDate !== origTo || newCode !== origCode) {
              requestsToUpdate.push([requestId, items]);
            }
          });
          
          if (requestsToUpdate.length > 0) {
            // Use Promise.allSettled to handle individual failures without stopping all updates
            const updateResults = await Promise.allSettled(
              requestsToUpdate.map(async ([requestId, items]) => {
                try {
                  // Normalize all dates to ISO format (YYYY-MM-DD) before finding min/max
                  const normalizedItems = items.map((item: any) => {
                    const isoFrom = parseDateToISO(item.from_date);
                    const isoTo = parseDateToISO(item.to_date);
                    return {
                      ...item,
                      from_date: isoFrom || item.from_date,
                      to_date: isoTo || item.to_date,
                    };
                  });
                  
                  const hasRange = normalizedItems.some((item: any) => item.from_date !== item.to_date);
                  
                  let minFromDate: string;
                  let maxToDate: string;
                  
                  if (hasRange) {
                    let widestRange = normalizedItems[0];
                    let widestSpan = 0;
                    normalizedItems.forEach((item: any) => {
                      const span = new Date(item.to_date).getTime() - new Date(item.from_date).getTime();
                      if (span > widestSpan) {
                        widestSpan = span;
                        widestRange = item;
                      }
                    });
                    minFromDate = widestRange.from_date;
                    maxToDate = widestRange.to_date;
                  } else {
                    const fromDates = normalizedItems.map((item: any) => item.from_date).filter(Boolean).sort();
                    const toDates = normalizedItems.map((item: any) => item.to_date).filter(Boolean).sort();
                    minFromDate = fromDates[0];
                    maxToDate = toDates[toDates.length - 1];
                  }
                  
                  if (minFromDate > maxToDate) {
                    throw new Error(`Invalid date range for request ${requestId}: from_date (${minFromDate}) cannot be after to_date (${maxToDate})`);
                  }
                  
                  const firstItem = normalizedItems[0];
                  const updatePayload = {
                    from_date: minFromDate,
                    to_date: maxToDate,
                    leave_type: firstItem.code,
                    reason: firstItem.reason || 'Added via Roster Generator',
                    employee: firstItem.employee,
                  };
                  
                  console.log(`📤 API payload:`, JSON.stringify(updatePayload, null, 2));
                  console.log(`🌐 API URL will be: PUT /api/requests/leave/${requestId}`);
                  
                  try {
                    const startTime = Date.now();
                    console.log(`⏳ Making API call now...`);
                    
                    // Add timeout wrapper to catch hanging requests (30 seconds should be enough)
                    const timeoutPromise = new Promise((_, reject) => {
                      setTimeout(() => reject(new Error('API call timeout after 30 seconds')), 30000);
                    });
                    
                    console.log(`📡 Calling axios.put for /api/requests/leave/${requestId}`);
                    const apiPromise = requestsAPI.updateLeaveRequest(requestId, updatePayload);
                    console.log(`⏱️ Waiting for API response or timeout...`);
                    const result = await Promise.race([apiPromise, timeoutPromise]);
                    console.log(`📥 API promise resolved/rejected, result:`, result);
                    
                    const duration = Date.now() - startTime;
                    // Don't set hadSuccessfulUpdates here - we'll check results after Promise.allSettled
                  } catch (apiError: any) {
                    console.error(`❌ API call failed for ${requestId}:`, apiError);
                    console.error('API error details:', {
                      message: apiError.message,
                      response: apiError.response?.data,
                      status: apiError.response?.status,
                      statusText: apiError.response?.statusText,
                    });
                    // IMPORTANT: Don't create a duplicate request when update fails!
                    // If the update times out or fails, we should NOT add it to leaveRequestsToCreate
                    // because:
                    // 1. The update might have actually succeeded on the backend (slow response)
                    // 2. Creating a duplicate would cause data integrity issues
                    // Instead, we'll show an error and let the user retry
                    console.warn(`⚠️ Update failed for ${requestId} - NOT creating duplicate. User should retry.`);
                    // Don't add to leaveRequestsToCreate - this prevents duplicate creation
                    throw apiError; // Re-throw to be caught by Promise.allSettled
                  }
                } catch (itemError: any) {
                  // Handle errors in processing individual items (non-API errors like date validation)
                  console.error(`❌ Error processing request ${requestId}:`, itemError);
                  // Don't create duplicates for processing errors either - re-throw to be caught
                  throw itemError;
                }
              })
            );
            
            // Check results and count successes/failures
            const successfulUpdates = updateResults.filter(r => r.status === 'fulfilled').length;
            const failedUpdates = updateResults.filter(r => r.status === 'rejected').length;
            
            if (failedUpdates > 0) {
              console.error(`❌ ${failedUpdates} out of ${requestsToUpdate.length} update(s) failed`);
              const errorMessages: string[] = [];
              updateResults.forEach((result, index) => {
                if (result.status === 'rejected') {
                  const [requestId] = requestsToUpdate[index];
                  const reason = result.reason?.message || result.reason || 'Unknown error';
                  console.error(`  - Failed: ${requestId} - ${reason}`);
                  errorMessages.push(`${requestId}: ${reason}`);
                }
              });
              // Show error to user - don't create duplicates!
              const errorMsg = `${failedUpdates} leave request update(s) failed:\n${errorMessages.join('\n')}\n\nPlease try again.`;
              throw new Error(errorMsg);
            }
            
            hadSuccessfulUpdates = successfulUpdates > 0;
          }
        }
        
        // Create new leave requests via updateTimeOff (which handles creation)
        // IMPORTANT: Remove request_id from items going to create endpoint (backend will assign new ones)
        const leaveRequestsToCreateClean = leaveRequestsToCreate.map((item: any) => {
          const { request_id, request_ids, ...cleanItem } = item;
          return cleanItem;
        });
        
        if (leaveRequestsToCreateClean.length > 0) {
          console.log('Creating new leave requests:', leaveRequestsToCreateClean.length);
          const createResponse = await dataAPI.updateTimeOff(leaveRequestsToCreateClean);
          const createdRequests = createResponse.created_leave_requests || [];
          
          // Update local state with new request_ids immediately
          if (createdRequests.length > 0) {
            setRosterData((prev: any) => {
              if (!prev || !prev.time_off) return prev;
              
              const updatedTimeOff = prev.time_off.map((item: any) => {
                // Match created requests by employee, dates, and code
                const matched = createdRequests.find((cr: any) => 
                  cr.employee === item.employee &&
                  cr.from_date === item.from_date &&
                  cr.to_date === item.to_date &&
                  cr.code === item.code &&
                  !item.request_id // Only update items without request_id
                );
                
                if (matched) {
                  return { ...item, request_id: matched.request_id };
                }
                return item;
              });
              
              return { ...prev, time_off: updatedTimeOff };
            });
          }
        }
        
        console.log('Successfully saved time-off data');
        setSaveNotification({ message: '✅ Leave data saved successfully!', type: 'success' });
        setTimeout(() => setSaveNotification(null), 2000);
        
        // Only reload if we actually made updates (to avoid unnecessary reloads)
        const hadUpdates = hadSuccessfulUpdates || leaveRequestsToCreateClean.length > 0;
        if (hadUpdates) {
          console.log('🔄 Reloading roster data to sync with server...');
          await loadRosterData();
          console.log('✅ Roster data reloaded, UI should now reflect saved dates');
        } else {
          console.log('⏭️ No updates made, skipping reload');
        }
      } catch (error: any) {
        console.error('Failed to save time off:', error);
        setSaveNotification({
          message: `❌ ${error.response?.data?.detail || 'Failed to save leave data'}`,
          type: 'error',
        });
        setTimeout(() => setSaveNotification(null), 4000);
        // Reload on error to get correct state from server
        await loadRosterData();
      } finally {
        isSavingTimeOffRef.current = false;
      }
    }, 800);
  };

  const handleLocksChange = async (newData: any[]) => {
    // Normalize locks: ensure dates are in ISO format (YYYY-MM-DD) and force is boolean
    const normalizedLocks = newData.map((lock: any) => {
      const isoFromDate = parseDateToISO(lock.from_date);
      const isoToDate = parseDateToISO(lock.to_date);
      
      // Validate dates before sending
      if (!isoFromDate || !isoToDate || !isoFromDate.match(/^\d{4}-\d{2}-\d{2}$/) || !isoToDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        console.error('Invalid date format in lock:', lock);
        return null; // Will be filtered out
      }
      
      return {
      ...lock,
        from_date: isoFromDate,
        to_date: isoToDate,
      force: !!lock.force,
      };
    }).filter((lock: any) => lock !== null); // Remove any invalid entries

    clearGeneratedResults();
    setRosterData((prev: any) => (prev ? { ...prev, locks: normalizedLocks } : prev));

    if (locksSaveTimeoutRef.current) {
      clearTimeout(locksSaveTimeoutRef.current);
    }

    locksSaveTimeoutRef.current = setTimeout(async () => {
      try {
        // Group locks by request_id to handle multi-day requests correctly
        // A single shift request can span multiple days, so we need to group by request_id
        const locksByRequestId = new Map<string, any[]>();
        const locksToCreate: any[] = [];
        
        normalizedLocks.forEach((lock: any) => {
          // Check if request_id exists and is valid (format LR_xxx, SR_xxx, or any non-empty string)
          const hasRequestId = lock.request_id && (
            lock.request_id.toString().startsWith('LR_') || 
            lock.request_id.toString().startsWith('SR_') ||
            lock.request_id.toString().trim() !== ''
          );
          
          if (hasRequestId && (lock.reason === 'Added via Roster Generator' || !lock.reason)) {
            // This is an edit - group by request_id
            const reqId = lock.request_id.toString();
            if (!locksByRequestId.has(reqId)) {
              locksByRequestId.set(reqId, []);
            }
            locksByRequestId.get(reqId)!.push(lock);
          } else {
            // This is a new lock - will be created via updateLocks
            locksToCreate.push(lock);
          }
        });
        
        // Update existing requests via API
        // For each request_id, find the min from_date and max to_date to update the single request
        if (locksByRequestId.size > 0) {
          await Promise.all(
            Array.from(locksByRequestId.entries()).map(async ([requestId, locks]) => {
              try {
                // Normalize all dates to ISO format (YYYY-MM-DD) before finding min/max
                const normalizedLocks = locks.map((lock: any) => {
                  const isoFrom = parseDateToISO(lock.from_date);
                  const isoTo = parseDateToISO(lock.to_date);
                  return {
                    ...lock,
                    from_date: isoFrom || lock.from_date,
                    to_date: isoTo || lock.to_date,
                  };
                });
                
                // CRITICAL: All locks with the same request_id came from the same original request
                // When user edits a range's dates, we should use the range's from_date and to_date directly
                // NOT recalculate from expanded individual days
                
                // Strategy: If we have a range (from_date != to_date), use it directly
                // Otherwise, if all items are single days, find min/max
                const hasRange = normalizedLocks.some((lock: any) => lock.from_date !== lock.to_date);
                
                let minFromDate: string;
                let maxToDate: string;
                
                if (hasRange) {
                  // We have at least one range - find the range with the widest span
                  // This handles the case where user edited a range's dates
                  let widestRange = normalizedLocks[0];
                  let widestSpan = 0;
                  
                  normalizedLocks.forEach((lock: any) => {
                    const fromDate = new Date(lock.from_date);
                    const toDate = new Date(lock.to_date);
                    const span = toDate.getTime() - fromDate.getTime();
                    if (span > widestSpan) {
                      widestSpan = span;
                      widestRange = lock;
                    }
                  });
                  
                  minFromDate = widestRange.from_date;
                  maxToDate = widestRange.to_date;
                } else {
                  // All items are single days - find min/max across all days
                  const fromDates = normalizedLocks.map((lock: any) => lock.from_date).filter(Boolean).sort();
                  const toDates = normalizedLocks.map((lock: any) => lock.to_date).filter(Boolean).sort();
                  
                  if (fromDates.length === 0 || toDates.length === 0) {
                    throw new Error(`Invalid dates for request ${requestId}: fromDates=${fromDates.length}, toDates=${toDates.length}`);
                  }
                  
                  minFromDate = fromDates[0];
                  maxToDate = toDates[toDates.length - 1];
                }
                
                // Validate: from_date must be <= to_date
                if (minFromDate > maxToDate) {
                  throw new Error(`Invalid date range for request ${requestId}: from_date (${minFromDate}) cannot be after to_date (${maxToDate})`);
                }
                
                const firstLock = normalizedLocks[0];
                
                await requestsAPI.updateShiftRequest(requestId, {
                  from_date: minFromDate,
                  to_date: maxToDate,
                  shift: firstLock.shift,
                  request_type: firstLock.force ? 'Must' : 'Cannot',
                  reason: firstLock.reason || 'Added via Roster Generator',
                  employee: firstLock.employee, // Include employee so backend can update user_id if changed
                });
                
              } catch (error: any) {
                console.error(`❌ Failed to update shift request ${requestId}:`, error);
                console.error('Error details:', error.response?.data);
                // If update fails, add locks to create list as fallback (but remove request_id)
                locks.forEach((lock: any) => {
                  const { request_id, ...cleanLock } = lock;
                  locksToCreate.push(cleanLock);
                });
              }
            })
          );
        }
        
        // Create new locks via updateLocks (which handles creation)
        // IMPORTANT: Remove request_id from items going to create endpoint (backend will assign new ones)
        const locksToCreateClean = locksToCreate.map((lock: any) => {
          const { request_id, ...cleanLock } = lock;
          return cleanLock;
        });
        
        if (locksToCreateClean.length > 0) {
          console.log('Creating new shift requests:', locksToCreateClean.length);
          await dataAPI.updateLocks(locksToCreateClean);
        }
        
        setSaveNotification({ message: '✅ Shift requests saved successfully!', type: 'success' });
        setTimeout(() => setSaveNotification(null), 2000);
        
        // Reload data to get updated request_ids - CRITICAL for future edits
        await loadRosterData();
        await loadAllShiftRequests();
      } catch (error: any) {
        console.error('Failed to save shift requests:', error);
        setSaveNotification({
          message: `❌ ${error.response?.data?.detail || 'Failed to save shift requests'}`,
          type: 'error',
        });
        setTimeout(() => setSaveNotification(null), 4000);
        // Reload on error to get correct state from server
        await loadRosterData();
      }
    }, 800);
  };


  const addTimeOff = async (employee: string, fromDate: string, toDate: string, code: string) => {
    // Date inputs already return YYYY-MM-DD format, but handle both formats for safety
    const isoFromDate = fromDate.match(/^\d{4}-\d{2}-\d{2}$/) ? fromDate : parseDateToISO(fromDate);
    const isoToDate = toDate.match(/^\d{4}-\d{2}-\d{2}$/) ? toDate : parseDateToISO(toDate);
    
    // Validate dates
    if (!isoFromDate || !isoToDate || !isoFromDate.match(/^\d{4}-\d{2}-\d{2}$/) || !isoToDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      alert(`Invalid date format. Please select valid dates.\nFrom: ${fromDate} → ${isoFromDate}\nTo: ${toDate} → ${isoToDate}`);
      return;
    }
    
    try {
      setShowAddTimeOff(false);
      setSaveNotification({ message: '💾 Saving leave request...', type: 'success' });
      
      // Save directly via API (like shift requests do)
      const newTimeOff = {
        employee,
        from_date: isoFromDate,
        to_date: isoToDate,
        code,
      };
      
      console.log('Adding time off directly via API:', newTimeOff);
      const createResponse = await dataAPI.updateTimeOff([newTimeOff]);
      
      setSaveNotification({ message: '✅ Leave request added successfully!', type: 'success' });
      setTimeout(() => setSaveNotification(null), 2000);
      
      // Reload data to get the new request_id
      await loadRosterData();
    } catch (error: any) {
      console.error('Failed to add leave request:', error);
      setSaveNotification({
        message: `❌ ${error.response?.data?.detail || 'Failed to add leave request'}`,
        type: 'error',
      });
      setTimeout(() => setSaveNotification(null), 4000);
    }
  };

  const addLock = (employee: string, fromDate: string, toDate: string, shift: string, force: boolean) => {
    // Date inputs already return YYYY-MM-DD format, but handle both formats for safety
    const isoFromDate = fromDate.match(/^\d{4}-\d{2}-\d{2}$/) ? fromDate : parseDateToISO(fromDate);
    const isoToDate = toDate.match(/^\d{4}-\d{2}-\d{2}$/) ? toDate : parseDateToISO(toDate);
    
    // Validate dates
    if (!isoFromDate || !isoToDate || !isoFromDate.match(/^\d{4}-\d{2}-\d{2}$/) || !isoToDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      alert(`Invalid date format. Please select valid dates.\nFrom: ${fromDate} → ${isoFromDate}\nTo: ${toDate} → ${isoToDate}`);
      return;
    }
    
    const newLock = {
      employee,
      from_date: isoFromDate,
      to_date: isoToDate,
      shift,
      force,
    };
    console.log('Adding lock:', newLock);
    const newData = [...(rosterData?.locks || []), newLock];
    handleLocksChange(newData);
    setShowAddLock(false);
  };

  // Years from max(2026, current year) through +10 (roster planning horizon)
  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years: number[] = [];
    const startYear = Math.max(2026, currentYear);
    for (let year = startYear; year <= currentYear + 10; year++) {
      years.push(year);
    }
    return years;
  }, []);

  const availableMonths = useMemo(
    () => getAvailableMonthOptions(selectedYear, new Date(), MONTH_NAMES),
    [selectedYear]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const steps = [
    {
      id: 'employees',
      name: 'Employees',
      description: 'Add, edit, or remove staff members and their skills.',
    },
    {
      id: 'demands',
      name: 'Staffing Needs',
      description: 'Configure daily demand for each shift type.',
    },
    {
      id: 'requests',
      name: 'Requests',
      description: 'Review and manage leave and shift requests in a unified schedule view.',
    },
    {
      id: 'schedule',
      name: 'Generate Schedule',
      description: 'Run the solver and review results before committing.',
    },
  ];

  // Filter data for selected month
  const getMonthData = (data: any[], dateField: string) => {
    if (!selectedYear || !selectedMonth || !data) return [];
    return data.filter((item: any) => {
      const date = new Date(item[dateField]);
      // Filter by period if selected
      if (selectedYear === 2026 && (selectedMonth === 2 || selectedMonth === 3) && selectedPeriod) {
        if (selectedPeriod === 'pre-ramadan') {
          return date >= new Date('2026-02-01') && date <= new Date('2026-02-18');
        } else if (selectedPeriod === 'ramadan') {
          return date >= new Date('2026-02-19') && date <= new Date('2026-03-19');
        } else if (selectedPeriod === 'post-ramadan') {
          return date >= new Date('2026-03-20') && date <= new Date('2026-03-31');
        }
      }
      return date.getFullYear() === selectedYear && date.getMonth() + 1 === selectedMonth;
    });
  };

  // Group consecutive days with same employee and code into continuous ranges

  // Expand ranges back into individual days (ONLY for solver - backend handles this automatically)
  // NOTE: We now save ranges directly to database, not expanded days
  // This function is kept for potential future use but is NOT called when saving
  const expandRangesToDays = (ranges: any[]): any[] => {
    const days: any[] = [];

    for (const range of ranges) {
      if (!range || !range.employee || !range.code || !range.from_date || !range.to_date) {
        console.warn('Skipping invalid range:', range);
        continue;
      }

      try {
        const fromDate = new Date(range.from_date);
        const toDate = new Date(range.to_date);
        
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
          console.warn('Invalid dates in range:', range);
          continue;
        }

        if (fromDate > toDate) {
          console.warn('from_date > to_date in range:', range);
          continue;
        }
        
        let currentDate = new Date(fromDate);
        while (currentDate <= toDate) {
          const dayEntry: any = {
            employee: range.employee,
            code: range.code,
            from_date: currentDate.toISOString().split('T')[0],
            to_date: currentDate.toISOString().split('T')[0],
          };
          
          // Preserve request_id and reason if they exist in the range
          if (range.request_id) {
            dayEntry.request_id = range.request_id;
          }
          if (range.reason) {
            dayEntry.reason = range.reason;
          }
          
          days.push(dayEntry);
          const nextDate = new Date(currentDate);
          nextDate.setDate(nextDate.getDate() + 1);
          currentDate = nextDate;
        }
      } catch (error) {
        console.error('Error expanding range to days:', range, error);
        // Skip invalid ranges
        continue;
      }
    }

    return days;
  };

  const selectionControls = (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Year</label>
          <select
            value={selectedYear || ''}
            onChange={(e) => {
              const newYear = e.target.value ? parseInt(e.target.value) : null;
              setSelectedYear(newYear);
              if (!newYear) {
                setSelectedMonth(null);
                setSelectedPeriod(null);
                return;
              }
              const now = new Date();
              if (
                selectedMonth != null &&
                !isSelectionValidForYear(newYear, selectedMonth, selectedPeriod, now)
              ) {
                setSelectedMonth(null);
                setSelectedPeriod(null);
              }
            }}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
          >
            <option value="">Select Year...</option>
            {availableYears.map((year: number) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Month</label>
          <select
            value={
              selectedYear === 2026 && selectedPeriod
                ? selectedPeriod
                : selectedMonth?.toString() || ''
            }
            onChange={(e) => {
              const value = e.target.value;
              if (!value) {
                setSelectedMonth(null);
                setSelectedPeriod(null);
                return;
              }
              
              // Auto-select period for 2026 periods
              if (selectedYear === 2026) {
                // Check if this is a period (starts with period identifier)
                const option = availableMonths.find(m => {
                  if (m.isPeriod && m.periodId) {
                    return value === m.periodId;
                  }
                  return value === m.number.toString();
                });
                
                if (option?.isPeriod && option.periodId) {
                  // This is a period - use the periodId as the value
                  setSelectedPeriod(option.periodId);
                  // Set the month number based on the period
                  setSelectedMonth(option.number);
                } else {
                  // Regular month
                  const monthNum = parseInt(value);
                  setSelectedMonth(monthNum);
                  setSelectedPeriod(null);
                }
              } else {
                // Regular year - just set the month
                const monthNum = parseInt(value);
                setSelectedMonth(monthNum);
                setSelectedPeriod(null);
              }
            }}
            disabled={!selectedYear}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100"
          >
            <option value="">Select Month...</option>
            {availableMonths.map(({ month, number, isPeriod, periodId }: { month: string; number: number; isPeriod?: boolean; periodId?: string }) => (
              <option key={`${number}-${month}`} value={isPeriod && periodId ? periodId : number.toString()}>{month}</option>
            ))}
          </select>
        </div>
        {/* Show period info when a period is selected */}
        {selectedYear === 2026 && selectedPeriod && (
          <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded">
            <p className="font-semibold">Selected Period:</p>
            <p className="text-sm">
              {selectedPeriod === 'pre-ramadan' && 'February (Pre-Ramadan) - Feb 1-18, 2026'}
              {selectedPeriod === 'ramadan' && 'Ramadan - Feb 19 to Mar 18, 2026'}
              {selectedPeriod === 'post-ramadan' && 'March (Post-Ramadan) - Mar 19-31, 2026'}
            </p>
          </div>
        )}
      </div>
      {(!selectedYear || !selectedMonth) && (
        <div className="mt-4 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded">
          Please select both a year and month to generate the roster.
        </div>
      )}
    </div>
  );

  if (!selectedYear || !selectedMonth) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Roster Generator</h2>
        {selectionControls}
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Roster Generator</h2>
      {selectionControls}

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex flex-col md:flex-row">
          <aside className="md:w-48 md:pr-4 md:border-r md:border-gray-200 mb-6 md:mb-0 flex-shrink-0">
            <div className="space-y-2">
              {steps.map((step, index) => {
                const isActive = activeTab === step.id;
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => setActiveTab(step.id)}
                    className={`w-full flex items-start space-x-2 rounded-lg border px-2 py-2 text-left transition ${
                      isActive
                        ? 'border-primary-500 bg-primary-50 text-primary-700 shadow-sm'
                        : 'border-gray-200 hover:border-primary-300 hover:shadow-sm'
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center w-6 h-6 mt-0.5 rounded-full border text-xs ${
                        isActive
                          ? 'bg-primary-500 border-primary-500 text-white'
                          : 'border-gray-300 text-gray-500'
                      }`}
                    >
                      {index + 1}
                    </span>
                    <div>
                      <p className={`text-sm font-medium ${isActive ? 'text-primary-700' : 'text-gray-800'}`}>
                        {step.name}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="flex-1 md:pl-8 space-y-8 min-w-0" ref={contentRef}>
          {/* Employees Tab */}
          {activeTab === 'employees' && (
            <div className="min-w-0">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Employee Skills Management</h3>
                  <p className="text-gray-600">Edit staff skills. To add new staff, create a Staff user in User Management.</p>
                </div>
              </div>
              
              {/* Auto-dismissing notification toast */}
              {saveNotification && (
                <div 
                  className={`fixed top-20 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
                    saveNotification.type === 'success' 
                      ? 'bg-green-500 text-white' 
                      : 'bg-red-500 text-white'
                  }`}
                  style={{ animation: 'slideIn 0.3s ease-out' }}
                >
                  {saveNotification.message}
                </div>
              )}
              {rosterData?.employees && rosterData.employees.length > 0 ? (
                <>
                  {/* Info Cards */}
                  <div className="grid grid-cols-4 gap-4 mb-6">
                    <div className="bg-white border border-gray-200 p-4 rounded-lg shadow-sm">
                      <p className="text-sm text-gray-600 mb-1">Total Employees</p>
                      <p className="text-2xl font-bold text-gray-900">{rosterData.employees.length}</p>
                    </div>
                    <div className="bg-white border border-gray-200 p-4 rounded-lg shadow-sm">
                      <p className="text-sm text-gray-600 mb-1">Can Work Nights</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {rosterData.employees.filter((e: any) => e.skill_N).length}
                      </p>
                    </div>
                    <div className="bg-white border border-gray-200 p-4 rounded-lg shadow-sm">
                      <p className="text-sm text-gray-600 mb-1">Can Work Afternoons</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {rosterData.employees.filter((e: any) => e.skill_A).length}
                      </p>
                    </div>
                    <div className="bg-white border border-gray-200 p-4 rounded-lg shadow-sm">
                      <p className="text-sm text-gray-600 mb-1">Can Work All Shifts</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {rosterData.employees.filter((e: any) => 
                          e.skill_M && e.skill_IP && e.skill_A && e.skill_N && e.skill_M3 && e.skill_M4 && e.skill_H && e.skill_CL && e.skill_E && e.skill_IP_P && e.skill_P && e.skill_M_P
                        ).length}
                      </p>
                    </div>
                  </div>
                  
                  <div className="overflow-x-auto w-full">
                  <EditableTable
                    data={rosterData.employees}
                    columns={[
                        { key: 'employee', label: 'Employee', type: 'text', readOnly: true },
                        { key: 'skill_M', label: 'M', type: 'checkbox' },
                        { key: 'skill_IP', label: 'IP', type: 'checkbox' },
                        { key: 'skill_A', label: 'A', type: 'checkbox' },
                        { key: 'skill_N', label: 'N', type: 'checkbox' },
                      { key: 'skill_M3', label: 'M3', type: 'checkbox' },
                      { key: 'skill_M4', label: 'M4', type: 'checkbox' },
                        { key: 'skill_H', label: 'H', type: 'checkbox' },
                        { key: 'skill_CL', label: 'CL', type: 'checkbox' },
                        { key: 'skill_E', label: 'E', type: 'checkbox' },
                        { key: 'skill_IP_P', label: 'IP+P', type: 'checkbox' },
                        { key: 'skill_P', label: 'P', type: 'checkbox' },
                        { key: 'skill_M_P', label: 'M+P', type: 'checkbox' },
                        { key: 'pending_off', label: 'P/O', type: 'number', min: -50, max: 50 },
                    ]}
                    onDataChange={handleEmployeesChange}
                    draggable={true}
                    onDeleteRow={async (index) => {
                      const employeeToDelete = rosterData.employees[index];
                      const newData = rosterData.employees.filter((_: any, i: number) => i !== index);
                      try {
                        // Delete from backend
                        await dataAPI.deleteEmployee(employeeToDelete.employee);
                        // Update local state
                        await handleEmployeesChange(newData);
                      } catch (error: any) {
                        alert(error.response?.data?.detail || 'Failed to delete employee');
                      }
                    }}
                  />
                  </div>
                </>
              ) : (
                <p className="text-gray-600">No employees data available.</p>
              )}
            </div>
          )}

          {/* Demands Tab */}
          {activeTab === 'demands' && (
            <DemandsTab
              selectedYear={selectedYear}
              selectedMonth={selectedMonth}
              monthNames={[...MONTH_NAMES]}
              selectedPeriod={selectedPeriod}
            />
          )}

          {/* Unified Requests Tab */}
          {activeTab === 'requests' && (
            <div>
              <div className="mb-4">
                <h3 className="text-xl font-bold text-gray-900">Requests</h3>
                <p className="text-gray-600">Manage leave and shift requests in a unified schedule view. Click any cell to assign or change requests.</p>
              </div>
              <RequestsSchedule
                year={selectedYear || 2025}
                month={selectedMonth || 1}
                employees={rosterData?.employees?.map((e: any) => e.employee) || []}
                timeOff={rosterData?.time_off || []}
                locks={rosterData?.locks || []}
                onTimeOffChange={handleTimeOffChange}
                onLocksChange={handleLocksChange}
                onSaveNotification={setSaveNotification}
                onReload={loadRosterData}
                selectedPeriod={selectedPeriod}
              />
            </div>
          )}

          {/* Old Time Off Tab - REMOVED - Now part of unified requests tab */}
          {false && activeTab === 'time-off' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Leave Requests</h3>
                  <p className="text-gray-600">Submit and approve vacation, sick leave, and other time off requests</p>
                </div>
                <button
                  onClick={() => setShowAddTimeOff(true)}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  ➕ Add Leave
                </button>
              </div>
              {showAddTimeOff && (
                <AddTimeOffForm
                  employees={rosterData?.employees?.map((e: any) => e.employee) || []}
                  leaveTypes={leaveTypes}
                  year={selectedYear || 2025}
                  month={selectedMonth || 1}
                  onSubmit={addTimeOff}
                  onCancel={() => setShowAddTimeOff(false)}
                />
              )}
                <EditableTable
                data={(() => {
                  // Filter to only leave types (not shift codes like MS, C)
                  const filteredTimeOff = (rosterData?.time_off || []).filter((item: any) => 
                    leaveTypes.some(lt => lt.code === item.code)
                  );
                  
                  // Log entries without request_ids
                  const entriesWithoutIds = filteredTimeOff.filter((item: any) => !item.request_id);
                  if (entriesWithoutIds.length > 0) {
                    console.warn(`⚠️ Found ${entriesWithoutIds.length} leave entries without request_id:`, entriesWithoutIds);
                  }
                  
                  // Get month data - use ranges directly as they come from backend
                  const monthData = getMonthData(filteredTimeOff, 'from_date');
                  
                  // Preserve original values for matching during edits
                  return monthData.map((range: any) => ({
                    ...range,
                    _originalRequestId: range.request_id,
                    _originalRequestIds: range.request_ids || (range.request_id ? [range.request_id] : []),
                    _originalFromDate: range.from_date,
                    _originalToDate: range.to_date,
                    _originalCode: range.code,
                    _originalEmployee: range.employee,
                    _originalReason: range.reason, // Also preserve reason
                  }));
                })()}
                  columns={[
                  { key: 'employee', label: 'Employee', type: 'select', options: rosterData?.employees?.map((e: any) => e.employee) || [] },
                    { key: 'from_date', label: 'From Date', type: 'text' },
                    { key: 'to_date', label: 'To Date', type: 'text' },
                  { key: 'code', label: 'Code', type: 'select', options: leaveTypes.map(lt => lt.code) },
                  ]}
                  onDataChange={(groupedData) => {
                    
                    // Get original time_off data to match and preserve request_ids
                    const filteredTimeOff = (rosterData?.time_off || []).filter((item: any) => 
                      leaveTypes.some(lt => lt.code === item.code)
                    );
                    const monthData = getMonthData(filteredTimeOff, 'from_date');
                    
                    // Create a map of original ranges by their unique key for faster lookup
                    const originalMap = new Map<string, any>();
                    monthData.forEach((orig: any, idx: number) => {
                      // Use multiple keys for matching: by index, by original values, and by request_id
                      if (orig.request_id) {
                        originalMap.set(`req_${orig.request_id}`, orig);
                      }
                      originalMap.set(`idx_${idx}`, orig);
                      const origFrom = parseDateToISO(orig.from_date);
                      const origTo = parseDateToISO(orig.to_date);
                      if (origFrom && origTo) {
                        originalMap.set(`key_${orig.employee}_${orig.code}_${origFrom}_${origTo}`, orig);
                      }
                    });
                    
                    // Normalize dates in groupedData to YYYY-MM-DD format
                    const normalizedGroupedData = groupedData.map((item: any, index: number) => {
                      const isoFromDate = parseDateToISO(item.from_date);
                      const isoToDate = parseDateToISO(item.to_date);
                      
                      // Log if dates changed during normalization
                      if (item.from_date !== isoFromDate || item.to_date !== isoToDate) {
                        console.log(`📅 Date normalization for range ${index}:`, {
                          original_from: item.from_date,
                          normalized_from: isoFromDate,
                          original_to: item.to_date,
                          normalized_to: isoToDate,
                        });
                      }
                      
                      // Try multiple matching strategies
                      let matchingRange: any = null;
                      
                      // Strategy 1: Match by request_id (if we have _originalRequestId) - highest priority
                      if (item._originalRequestId) {
                        matchingRange = originalMap.get(`req_${item._originalRequestId}`);
                      }
                      
                      // Strategy 2: Match by index (if row order hasn't changed)
                      if (!matchingRange) {
                        matchingRange = originalMap.get(`idx_${index}`);
                        if (!matchingRange || 
                            matchingRange.employee !== item.employee ||
                            matchingRange.code !== item.code) {
                          matchingRange = null;
                        }
                      }
                      
                      // Strategy 3: Match by original values (employee, code, original dates)
                      if (!matchingRange && item._originalEmployee && item._originalCode && item._originalFromDate) {
                        const origFrom = parseDateToISO(item._originalFromDate);
                        const origTo = parseDateToISO(item._originalToDate || item._originalFromDate);
                        if (origFrom && origTo) {
                          matchingRange = originalMap.get(`key_${item._originalEmployee}_${item._originalCode}_${origFrom}_${origTo}`);
                        }
                      }
                      
                      // Strategy 4: Match by current values (in case it's a new entry that matches an existing one)
                      if (!matchingRange && isoFromDate && isoToDate) {
                        matchingRange = originalMap.get(`key_${item.employee}_${item.code}_${isoFromDate}_${isoToDate}`);
                      }
                      
                      // CRITICAL: If we have _originalRequestId, ALWAYS use it - this is the source of truth
                      // Even if matching fails, we know this is an edit of an existing request
                      const requestId = item._originalRequestId || matchingRange?.request_id;
                      const requestIds = item._originalRequestIds || matchingRange?.request_ids || (requestId ? [requestId] : []);
                      // Use reason from matching range if available, otherwise preserve original or default
                      const reason = matchingRange?.reason || item._originalReason || item.reason || 'Added via Roster Generator';
                      
                      // If we have _originalRequestId but no requestId, that's a problem - log it
                      if (item._originalRequestId && !requestId) {
                        console.error(`❌ CRITICAL: Had _originalRequestId ${item._originalRequestId} but couldn't preserve it!`, {
                          employee: item.employee,
                          code: item.code,
                          from_date: isoFromDate,
                          to_date: isoToDate,
                          _originalRequestId: item._originalRequestId,
                          matchingRange: matchingRange,
                        });
                        // Force use the original request_id even if matching failed
                        const forcedRequestId = item._originalRequestId;
                        console.log(`🔧 Forcing request_id to ${forcedRequestId} based on _originalRequestId`);
                        return {
                          ...item,
                          from_date: isoFromDate || item.from_date,
                          to_date: isoToDate || item.to_date,
                          request_id: forcedRequestId,
                          request_ids: item._originalRequestIds || [forcedRequestId],
                          reason: reason,
                          // Remove temporary fields
                          _originalRequestId: undefined,
                          _originalRequestIds: undefined,
                          _originalFromDate: undefined,
                          _originalToDate: undefined,
                          _originalCode: undefined,
                          _originalEmployee: undefined,
                        };
                      }
                      
                      if (!requestId) {
                        console.warn(`⚠️ No request_id found for leave request (new entry?):`, {
                          employee: item.employee,
                          code: item.code,
                          from_date: isoFromDate,
                          to_date: isoToDate,
                          _originalRequestId: item._originalRequestId,
                          matchingRange: matchingRange,
                        });
                      } else {
                        console.log(`📝 Preserving request_id for leave: ${requestId}`, {
                          employee: item.employee,
                          code: item.code,
                          from_date: isoFromDate,
                          to_date: isoToDate,
                          hadOriginalRequestId: !!item._originalRequestId,
                        });
                      }
                      
                      const normalizedItem = {
                        ...item,
                        from_date: isoFromDate || item.from_date,
                        to_date: isoToDate || item.to_date,
                        request_id: requestId,
                        request_ids: requestIds,
                        reason: reason,
                        // Remove temporary fields
                        _originalRequestId: undefined,
                        _originalRequestIds: undefined,
                        _originalFromDate: undefined,
                        _originalToDate: undefined,
                        _originalCode: undefined,
                        _originalEmployee: undefined,
                      };
                      
                      // Log if this item has a request_id and dates
                      if (requestId && (normalizedItem.from_date !== item._originalFromDate || normalizedItem.to_date !== item._originalToDate)) {
                        console.log(`✏️ Range ${index} dates changed:`, {
                          request_id: requestId,
                          old_from: item._originalFromDate,
                          new_from: normalizedItem.from_date,
                          old_to: item._originalToDate,
                          new_to: normalizedItem.to_date,
                        });
                      }
                      
                      return normalizedItem;
                    });
                    
                    console.log('📦 Normalized grouped data:', normalizedGroupedData.length, 'ranges');
                    console.log('📅 Sample normalized ranges:', normalizedGroupedData.slice(0, 3).map((r: any) => ({
                      employee: r.employee,
                      code: r.code,
                      from_date: r.from_date,
                      to_date: r.to_date,
                      request_id: r.request_id,
                    })));
                    
                    // IMPORTANT: Keep ranges as ranges when saving - don't expand to individual days
                    // Expansion only happens when generating schedule (for solver)
                    // This prevents requests from being split into multiple database entries
                    
                    // Get all time_off data (including shift codes for solver)
                    const allTimeOff = rosterData?.time_off || [];
                    const leaveTypeCodes = new Set(leaveTypes.map(lt => lt.code));
                    
                    // Filter out old leave type entries for this month, keep shift codes
                    const otherTimeOff = allTimeOff.filter((item: any) => {
                      if (!leaveTypeCodes.has(item.code)) {
                        // Keep non-leave-type entries (shift codes)
                        return true;
                      }
                      // For leave types, check if they're in the selected month
                      const itemDateStr = parseDateToISO(item.from_date);
                      const itemDate = new Date(itemDateStr);
                      if (isNaN(itemDate.getTime())) {
                        // Invalid date, keep it (might be in different format)
                        return true;
                      }
                      const inMonth = itemDate.getFullYear() === selectedYear && 
                                     itemDate.getMonth() + 1 === selectedMonth;
                      // Remove leave types that are in this month (we'll replace them with ranges)
                      return !inMonth;
                    });
                    
                    // Combine with ranges (NOT expanded days) - backend will handle ranges correctly
                    const newData = [...otherTimeOff, ...normalizedGroupedData];
                    handleTimeOffChange(newData);
                  }}
                  onDeleteRow={async (index) => {
                    // Filter to only leave types (not shift codes) for display
                    const filteredTimeOff = (rosterData?.time_off || []).filter((item: any) => 
                      leaveTypes.some(lt => lt.code === item.code)
                    );
                    const monthData = getMonthData(filteredTimeOff, 'from_date');
                    
                    if (index >= 0 && index < monthData.length) {
                      const rangeToDelete = monthData[index];
                      console.log('🗑️ Deleting time-off range:', rangeToDelete);
                      
                      // Normalize dates to ISO strings (YYYY-MM-DD) for comparison
                      const normalizeDate = (d: any): string => {
                        if (!d) return '';
                        if (typeof d === 'string') {
                          return d.split('T')[0];
                        }
                        if (d instanceof Date) {
                          return d.toISOString().split('T')[0];
                        }
                        return String(d);
                      };
                      
                      const deleteFromDate = normalizeDate(rangeToDelete.from_date);
                      const deleteToDate = normalizeDate(rangeToDelete.to_date);
                      
                      // First, check if the grouped range has request_id information
                      // This is more efficient than searching through all items
                      const requestIdsToDelete = new Set<string>();
                      
                      // If the range has request_ids array, use it (for grouped consecutive days)
                      if (rangeToDelete.request_ids && Array.isArray(rangeToDelete.request_ids) && rangeToDelete.request_ids.length > 0) {
                        // Check if it's not a Roster Generator request
                        const isRosterGeneratorRequest = rangeToDelete.reason === 'Added via Roster Generator';
                        if (!isRosterGeneratorRequest) {
                          rangeToDelete.request_ids.forEach((id: string) => {
                            if (id && id.trim() !== '') {
                              requestIdsToDelete.add(id);
                            }
                          });
                        }
                      }
                      // Also check the main request_id if it exists
                      else if (rangeToDelete.request_id && rangeToDelete.request_id.trim() !== '') {
                        const isRosterGeneratorRequest = rangeToDelete.reason === 'Added via Roster Generator';
                        if (!isRosterGeneratorRequest) {
                          requestIdsToDelete.add(rangeToDelete.request_id);
                        }
                      }
                      
                      // IMPORTANT: Use ONLY the request_id from the row being deleted
                      // Do NOT search for other matching items, as this would delete duplicates too!
                      // If the row doesn't have a request_id, we'll handle it via time_off update below
                      
                      // If we have employee-requested leave requests, delete them immediately from UI, then sync with API
                      if (requestIdsToDelete.size > 0) {
                        // IMMEDIATE UI UPDATE: Remove items from local state right away
                      const allTimeOff = rosterData?.time_off || [];
                      const newData = allTimeOff.filter((item: any) => {
                        // Keep non-leave-type entries
                        if (!leaveTypes.some(lt => lt.code === item.code)) {
                          return true;
                        }
                        
                          // Only remove items that have the EXACT request_id we're deleting
                          // IMPORTANT: Match by request_id ONLY, not by dates/employee/code
                          // This prevents deleting duplicates with the same dates/employee/code
                          if (item.request_id && requestIdsToDelete.has(item.request_id)) {
                            return false; // Remove this item
                          }
                          return true; // Keep all other items
                        });
                        
                        // Update UI immediately
                        handleTimeOffChange(newData);
                        setSaveNotification({ message: '✅ Leave request(s) deleted!', type: 'success' });
                        setTimeout(() => setSaveNotification(null), 2000);
                        
                        // Sync with backend in the background (don't await - fire and forget)
                        // Delete only the specific request_id(s) from the row being deleted
                        Promise.all(
                          Array.from(requestIdsToDelete).map(requestId => 
                            requestsAPI.deleteLeaveRequest(requestId)
                          )
                        ).then(() => {
                          console.log('Successfully deleted leave requests from backend');
                          // Optionally reload to ensure sync, but don't block UI
                          loadRosterData().catch(err => console.error('Failed to reload after delete:', err));
                        }).catch((error: any) => {
                          console.error('Failed to delete leave request(s) via API:', error);
                          // Show error but don't revert UI (user already saw it deleted)
                          setSaveNotification({
                            message: `⚠️ Deleted locally but sync failed: ${error.response?.data?.detail || 'Please refresh'}`,
                            type: 'error',
                          });
                          setTimeout(() => setSaveNotification(null), 4000);
                          // Reload to get correct state from server
                          loadRosterData().catch(err => console.error('Failed to reload after error:', err));
                        });
                        
                        return; // Exit early - UI already updated
                      }
                      
                      // If it has request_id but reason is 'Added via Roster Generator' or missing, try API delete first
                      // (in case the reason field wasn't properly set)
                      // Get allTimeOff for use in fallback and final deletion
                      const allTimeOff = rosterData?.time_off || [];
                      
                      // This section is only for "Added via Roster Generator" requests that need to be deleted via time_off update
                      // If the row has a request_id but reason is "Added via Roster Generator", use the request_id directly
                      // IMPORTANT: Only use the request_id from rangeToDelete, don't search for matches!
                      // This prevents deleting duplicates when multiple requests have the same dates/employee/code
                      if (rangeToDelete.request_id && rangeToDelete.request_id.trim() !== '') {
                        // Try API delete first even for "Added via Roster Generator" requests
                        // (they can still be deleted via API if they exist in the database)
                        try {
                          console.log('Attempting API delete for request:', rangeToDelete.request_id);
                          await requestsAPI.deleteLeaveRequest(rangeToDelete.request_id);
                          console.log('Successfully deleted via API');
                          setSaveNotification({ message: '✅ Leave request deleted!', type: 'success' });
                          setTimeout(() => setSaveNotification(null), 2000);
                          await loadRosterData();
                          return;
                        } catch (apiError: any) {
                          console.log('API delete failed, will use time_off update method:', apiError.response?.data?.detail);
                          // Fall through to time_off update method
                        }
                      }
                      
                      // Fallback: Delete via time_off update (for "Added via Roster Generator" requests without request_id or if API failed)
                      // IMPORTANT: Only delete items with matching request_id OR items without request_id that match the exact range
                      // This prevents deleting duplicates
                      // allTimeOff is already defined above at line 1777
                      const newData = allTimeOff.filter((item: any) => {
                        // Keep non-leave-type entries
                        if (!leaveTypes.some(lt => lt.code === item.code)) {
                          return true;
                        }
                        
                        // If the row being deleted has a request_id, only delete items with that exact request_id
                        if (rangeToDelete.request_id && rangeToDelete.request_id.trim() !== '') {
                          if (item.request_id === rangeToDelete.request_id) {
                            return false; // Delete this item
                          }
                          return true; // Keep all other items
                        }
                        
                        // Otherwise, match by exact date range, employee, and code (only for items without request_id)
                        const itemFromDate = normalizeDate(item.from_date);
                        const itemToDate = normalizeDate(item.to_date);
                        const deleteFrom = normalizeDate(deleteFromDate);
                        const deleteTo = normalizeDate(deleteToDate);
                        
                        // Only delete if it matches exactly AND doesn't have a request_id
                        return !(
                          !item.request_id && // Only delete items without request_id
                          item.employee === rangeToDelete.employee &&
                          item.code === rangeToDelete.code &&
                          itemFromDate === deleteFrom &&
                          itemToDate === deleteTo
                        );
                      });
                      
                      // Update UI immediately
                      handleTimeOffChange(newData);
                      setSaveNotification({ message: '✅ Leave request(s) deleted!', type: 'success' });
                      setTimeout(() => setSaveNotification(null), 2000);
                      
                      // Try API delete for the specific request_id if it exists
                      if (rangeToDelete.request_id && rangeToDelete.request_id.trim() !== '') {
                        requestsAPI.deleteLeaveRequest(rangeToDelete.request_id)
                          .then(() => {
                            console.log('Successfully deleted leave request from backend');
                            loadRosterData().catch(err => console.error('Failed to reload after delete:', err));
                          })
                          .catch((error: any) => {
                            console.log('API delete failed (but UI already updated):', error.response?.data?.detail);
                            // Don't show error to user since UI is already updated - just reload to sync
                            loadRosterData().catch(err => console.error('Failed to reload after error:', err));
                          });
                      } else {
                        // No request_id - just reload to ensure sync
                        loadRosterData().catch(err => console.error('Failed to reload after delete:', err));
                      }
                    }
                  }}
                />
            </div>
          )}

          {/* Old Locks Tab - REMOVED - Now part of unified requests tab */}
          {false && activeTab === 'locks' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Shift Requests</h3>
                  <p className="text-gray-600">Force specific shifts or block certain assignments for staff</p>
                </div>
                <button
                  onClick={() => setShowAddLock(true)}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  ➕ Add Lock
                </button>
              </div>
              {showAddLock && (
                <AddLockForm
                  employees={rosterData?.employees?.map((e: any) => e.employee) || []}
                  year={selectedYear || 2025}
                  month={selectedMonth || 1}
                  shiftTypes={shiftTypes}
                  onSubmit={addLock}
                  onCancel={() => setShowAddLock(false)}
                />
              )}
                <EditableTable
                data={(() => {
                  const monthData = getMonthData(rosterData?.locks || [], 'from_date')
                    .filter((lock: any) => lock.shift !== 'DO' && lock.shift !== 'O'); // Filter out DO and O from shift requests
                  
                  // Log entries without request_ids
                  const locksWithoutIds = monthData.filter((lock: any) => !lock.request_id);
                  if (locksWithoutIds.length > 0) {
                    console.warn(`⚠️ Found ${locksWithoutIds.length} shift entries without request_id:`, locksWithoutIds);
                  }
                  
                  
                  return monthData.map((lock: any) => ({
                    ...lock,
                    force: lock.force ? 'Must' : 'Cannot',
                    // Preserve original values for matching during edits (even when dates/shift change)
                    _originalRequestId: lock.request_id,
                    _originalReason: lock.reason,
                    _originalShift: lock.shift,
                    _originalForce: lock.force ? 'Must' : 'Cannot',
                    _originalFromDate: lock.from_date,
                    _originalToDate: lock.to_date,
                    _originalEmployee: lock.employee,
                  }));
                })()}
                  columns={[
                  { key: 'employee', label: 'Employee', type: 'select', options: rosterData?.employees?.map((e: any) => e.employee) || [] },
                    { key: 'from_date', label: 'From Date', type: 'text' },
                    { key: 'to_date', label: 'To Date', type: 'text' },
                    { key: 'shift', label: 'Shift', type: 'select', options: shiftTypes.length > 0 ? shiftTypes.filter(st => st.code !== 'O' && st.code !== 'DO').map(st => st.code) : [] },
                    { key: 'force', label: 'Action', type: 'select', options: ['Must', 'Cannot'] },
                  ]}
                  onDataChange={(newData) => {
                    
                    // Get original locks data to match and preserve request_id
                    const originalLocks = getMonthData(rosterData?.locks || [], 'from_date')
                      .filter((lock: any) => lock.shift !== 'DO' && lock.shift !== 'O');
                    
                    // Create a map for faster lookup
                    const originalMap = new Map<string, any>();
                    originalLocks.forEach((orig: any, idx: number) => {
                      if (orig.request_id) {
                        originalMap.set(`req_${orig.request_id}`, orig);
                      }
                      originalMap.set(`idx_${idx}`, orig);
                      const origFrom = parseDateToISO(orig.from_date);
                      const origTo = parseDateToISO(orig.to_date);
                      if (origFrom && origTo) {
                        originalMap.set(`key_${orig.employee}_${orig.shift}_${origFrom}_${origTo}`, orig);
                      }
                    });
                    
                    // Normalize dates and convert force field, preserving request_id
                    const converted = newData.map((item: any, index: number) => {
                      const isoFromDate = parseDateToISO(item.from_date);
                      const isoToDate = parseDateToISO(item.to_date);
                      
                      // Try multiple matching strategies
                      let matchingLock: any = null;
                      
                      // Strategy 1: Match by request_id (if we have _originalRequestId) - highest priority
                      if (item._originalRequestId) {
                        matchingLock = originalMap.get(`req_${item._originalRequestId}`);
                      }
                      
                      // Strategy 2: Match by index (if row order hasn't changed)
                      if (!matchingLock) {
                        matchingLock = originalMap.get(`idx_${index}`);
                        if (!matchingLock || 
                            matchingLock.employee !== item.employee ||
                            matchingLock.shift !== item.shift) {
                          matchingLock = null;
                        }
                      }
                      
                      // Strategy 3: Match by original values (employee, shift, original dates)
                      if (!matchingLock && item._originalEmployee && item._originalShift && item._originalFromDate) {
                        const origFrom = parseDateToISO(item._originalFromDate);
                        const origTo = parseDateToISO(item._originalToDate || item._originalFromDate);
                        if (origFrom && origTo) {
                          matchingLock = originalMap.get(`key_${item._originalEmployee}_${item._originalShift}_${origFrom}_${origTo}`);
                        }
                      }
                      
                      // Strategy 4: Match by current values
                      if (!matchingLock && isoFromDate && isoToDate) {
                        matchingLock = originalMap.get(`key_${item.employee}_${item.shift}_${isoFromDate}_${isoToDate}`);
                      }
                      
                      // CRITICAL: If we have _originalRequestId, ALWAYS use it - this is the source of truth
                      // Even if matching fails, we know this is an edit of an existing request
                      const requestId = item._originalRequestId || matchingLock?.request_id;
                      const reason = item._originalReason || matchingLock?.reason || 'Added via Roster Generator';
                      
                      // If we have _originalRequestId but no requestId, that's a problem - log it and force it
                      if (item._originalRequestId && !requestId) {
                        console.error(`❌ CRITICAL: Had _originalRequestId ${item._originalRequestId} but couldn't preserve it!`, {
                          employee: item.employee,
                          shift: item.shift,
                          from_date: isoFromDate,
                          to_date: isoToDate,
                          _originalRequestId: item._originalRequestId,
                          matchingLock: matchingLock,
                        });
                        // Force use the original request_id even if matching failed
                        const forcedRequestId = item._originalRequestId;
                        console.log(`🔧 Forcing request_id to ${forcedRequestId} based on _originalRequestId`);
                        return {
                          employee: item.employee,
                          from_date: isoFromDate || item.from_date,
                          to_date: isoToDate || item.to_date,
                          shift: item.shift,
                      force: item.force === 'Must',
                          reason: reason,
                          request_id: forcedRequestId,
                        };
                      }
                      
                      if (!requestId) {
                        console.warn(`⚠️ No request_id found for shift request (new entry?):`, {
                          employee: item.employee,
                          shift: item.shift,
                          from_date: isoFromDate,
                          to_date: isoToDate,
                          _originalRequestId: item._originalRequestId,
                          matchingLock: matchingLock,
                        });
                      } else {
                        console.log(`📝 Preserving request_id for shift: ${requestId}`, {
                          employee: item.employee,
                          shift: item.shift,
                          from_date: isoFromDate,
                          to_date: isoToDate,
                          hadOriginalRequestId: !!item._originalRequestId,
                        });
                      }
                      
                      // Clean up the converted item
                      const cleanedItem: any = {
                        employee: item.employee,
                        from_date: isoFromDate || item.from_date,
                        to_date: isoToDate || item.to_date,
                        shift: item.shift,
                        force: item.force === 'Must',
                        reason: reason,
                      };
                      
                      // Only include request_id if it exists (for updates)
                      if (requestId) {
                        cleanedItem.request_id = requestId;
                      }
                      
                      return cleanedItem;
                    });
                    handleLocksChange(converted);
                  }}
                  onDeleteRow={async (index) => {
                    const monthData = getMonthData(rosterData?.locks || [], 'from_date')
                      .filter((lock: any) => lock.shift !== 'DO' && lock.shift !== 'O'); // Filter out DO and O
                    if (index >= 0 && index < monthData.length) {
                      const itemToDelete = monthData[index];
                      
                      // Check if this is an employee-requested shift request
                      // It's employee-requested if it has request_id AND reason is NOT 'Added via Roster Generator'
                      const hasRequestId = itemToDelete.request_id && itemToDelete.request_id.trim() !== '';
                      const isRosterGeneratorRequest = itemToDelete.reason === 'Added via Roster Generator';
                      
                      if (hasRequestId && !isRosterGeneratorRequest) {
                        // Delete via API endpoint (employee-requested shift request)
                        try {
                          console.log('Deleting employee-requested shift request:', itemToDelete.request_id);
                          await requestsAPI.deleteShiftRequest(itemToDelete.request_id);
                          setSaveNotification({ message: '✅ Shift request deleted successfully!', type: 'success' });
                          setTimeout(() => setSaveNotification(null), 2000);
                          // Reload data to reflect the deletion
                          await loadRosterData();
                          await loadAllShiftRequests();
                          return;
                        } catch (error: any) {
                          console.error('Failed to delete shift request via API:', error);
                          setSaveNotification({
                            message: `❌ ${error.response?.data?.detail || 'Failed to delete shift request'}`,
                            type: 'error',
                          });
                          setTimeout(() => setSaveNotification(null), 4000);
                          return; // Don't fall through if API delete fails
                        }
                      }
                      
                      // If it has request_id but reason is 'Added via Roster Generator' or missing, try API delete first
                      // (in case the reason field wasn't properly set)
                      if (hasRequestId) {
                        try {
                          console.log('Attempting to delete shift request via API (fallback):', itemToDelete.request_id);
                          await requestsAPI.deleteShiftRequest(itemToDelete.request_id);
                          setSaveNotification({ message: '✅ Shift request deleted successfully!', type: 'success' });
                          setTimeout(() => setSaveNotification(null), 2000);
                          await loadRosterData();
                          await loadAllShiftRequests();
                          return;
                        } catch (error: any) {
                          console.log('API delete failed, trying locks update method:', error.response?.data?.detail);
                          // Fall through to locks update method if API delete fails
                        }
                      }
                      
                      // Otherwise, it's a "Added via Roster Generator" request - delete via locks update
                      // Normalize dates to ISO strings for comparison
                      const normalizeDate = (d: any) => {
                        if (!d) return '';
                        if (typeof d === 'string') return d.split('T')[0]; // Extract YYYY-MM-DD from ISO string
                        if (d instanceof Date) return d.toISOString().split('T')[0];
                        return String(d);
                      };
                      
                      const deleteFromDate = normalizeDate(itemToDelete.from_date);
                      const deleteToDate = normalizeDate(itemToDelete.to_date);
                      const deleteForce = typeof itemToDelete.force === 'string' ? itemToDelete.force === 'Must' : !!itemToDelete.force;
                      
                      // Remove the item by matching all its properties (normalize dates for comparison)
                      const newData = (rosterData?.locks || []).filter((item: any) => {
                        const itemFromDate = normalizeDate(item.from_date);
                        const itemToDate = normalizeDate(item.to_date);
                        const itemForce = typeof item.force === 'string' ? item.force === 'Must' : !!item.force;
                        return !(
                          item.employee === itemToDelete.employee &&
                          itemFromDate === deleteFromDate &&
                          itemToDate === deleteToDate &&
                          item.shift === itemToDelete.shift &&
                          itemForce === deleteForce
                        );
                    });
                    handleLocksChange(newData);
                    }
                  }}
                />
            </div>
          )}

          {/* Schedule Generation & Review */}
          {activeTab === 'schedule' && (
            <div>
              <div className="mb-4">
                <h3 className="text-xl font-bold text-gray-900">Generate Schedule</h3>
                <p className="text-gray-600">Run the solver to build the monthly roster, review the assignments, and commit when satisfied.</p>
              </div>

              {!selectedYear || !selectedMonth ? (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
                  Please select a year and month first.
                </div>
              ) : (
                <div className="space-y-6">
                  {solving ? (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                      <div className="flex items-center space-x-4">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                        <div>
                          <p className="font-semibold text-gray-900">Generating schedule...</p>
                          <p className="text-sm text-gray-600">Status: {jobStatus?.status || 'pending'}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={handleGenerate}
                      className="w-full px-6 py-3 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700"
                    >
                      Generate Schedule
                    </button>
                  )}

                  {jobStatus?.status === 'failed' && (
                    <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
                      <p className="font-semibold mb-2">Generation failed:</p>
                      {jobStatus.issues && jobStatus.issues.length > 0 ? (
                        <div className="space-y-2">
                          <p className="mb-2">Found {jobStatus.issues.length} issue(s):</p>
                          <ul className="list-decimal list-inside space-y-2 ml-4">
                            {jobStatus.issues.map((issue: string, index: number) => (
                              <li key={index} className="whitespace-pre-wrap" dangerouslySetInnerHTML={{
                                __html: issue.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                              }} />
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{jobStatus.error || 'Unknown error'}</p>
                      )}
                    </div>
                  )}

                  {generatedSchedule && selectedYear && selectedMonth ? (
                    <>
                      {(() => {
                        // Calculate dynamic pending_off when schedule is edited
                        if (!generatedEmployees || !originalGeneratedSchedule) {
                          return (
                            <div className="overflow-x-auto max-w-full">
                            <ScheduleTable
                              schedule={generatedSchedule}
                              year={selectedYear}
                              month={selectedMonth}
                              employees={generatedEmployees || rosterData?.employees}
                              editable={true}
                              canChangeColors={true}
                              onScheduleChange={(updatedSchedule) => {
                                setGeneratedSchedule(updatedSchedule);
                              }}
                              selectedPeriod={selectedPeriod}
                            />
                            </div>
                          );
                        }
                        
                        // Check if schedule has been edited (different from original)
                        const scheduleChanged = JSON.stringify(generatedSchedule) !== JSON.stringify(originalGeneratedSchedule);
                        if (!scheduleChanged) {
                          return (
                            <div className="overflow-x-auto max-w-full">
                            <ScheduleTable
                              schedule={generatedSchedule}
                              year={selectedYear}
                              month={selectedMonth}
                              employees={generatedEmployees}
                              editable={true}
                              canChangeColors={true}
                              onScheduleChange={(updatedSchedule) => {
                                setGeneratedSchedule(updatedSchedule);
                              }}
                              selectedPeriod={selectedPeriod}
                            />
                            </div>
                          );
                        }
                        
                        // Calculate initial pending_off by reverse-calculating from original schedule
                        // Helper to check if date is in selected period range
                        const isDateInRange = (dateStr: string): boolean => {
                          if (!selectedYear || !selectedMonth) return false;
                          const date = new Date(dateStr);
                          if (selectedYear === 2026 && (selectedMonth === 2 || selectedMonth === 3) && selectedPeriod) {
                            if (selectedPeriod === 'pre-ramadan') {
                              return date >= new Date('2026-02-01') && date <= new Date('2026-02-18');
                            } else if (selectedPeriod === 'ramadan') {
                              return date >= new Date('2026-02-19') && date <= new Date('2026-03-19');
                            } else if (selectedPeriod === 'post-ramadan') {
                              return date >= new Date('2026-03-20') && date <= new Date('2026-03-31');
                            }
                          }
                          return date.getFullYear() === selectedYear && date.getMonth() + 1 === selectedMonth;
                        };
                        
                        const originalScheduleEntries = originalGeneratedSchedule.filter((entry: any) => {
                          return isDateInRange(entry.date);
                        });
                        
                        const originalCalculated = calculatePendingOff(originalScheduleEntries, {}, {}, selectedYear, selectedMonth);
                        const originalEmployeesMap = new Map(generatedEmployees.map((e: any) => [e.employee, e]));
                        
                        // Reverse-calculate initial pending_off
                        const initialPendingOff: Record<string, number> = {};
                        originalCalculated.forEach(calc => {
                          const original = originalEmployeesMap.get(calc.employee);
                          if (original) {
                            const finalPendingOff = original.pending_off || 0;
                            const addedThisMonth = calc.weekend_shifts + calc.night_shifts - calc.DOs_given;
                            initialPendingOff[calc.employee] = Math.max(0, finalPendingOff - addedThisMonth);
                          } else {
                            initialPendingOff[calc.employee] = 0;
                          }
                        });
                        
                        // For any employees not in calculated, use their original pending_off
                        generatedEmployees.forEach((emp: any) => {
                          if (!(emp.employee in initialPendingOff)) {
                            initialPendingOff[emp.employee] = emp.pending_off || 0;
                          }
                        });
                        
                        // Calculate from current (edited) schedule
                        const currentScheduleEntries = generatedSchedule.filter((entry: any) => {
                          return isDateInRange(entry.date);
                        });
                        
                        const recalculated = calculatePendingOff(currentScheduleEntries, initialPendingOff, {}, selectedYear, selectedMonth);
                        
                        // Create a map of employees with their skill information
                        const employeesWithSkillsMap = new Map(
                          (generatedEmployees || rosterData?.employees || []).map((emp: any) => [
                            emp.employee,
                            {
                              skill_M: emp.skill_M,
                              skill_IP: emp.skill_IP,
                              skill_A: emp.skill_A,
                              skill_N: emp.skill_N,
                              skill_M3: emp.skill_M3,
                              skill_M4: emp.skill_M4,
                              skill_H: emp.skill_H,
                              skill_CL: emp.skill_CL,
                              skill_E: emp.skill_E,
                              skill_IP_P: emp.skill_IP_P,
                              skill_P: emp.skill_P,
                              skill_M_P: emp.skill_M_P,
                            }
                          ])
                        );
                        
                        // Merge skill information into dynamicEmployees
                        const dynamicEmployees = recalculated.map(e => {
                          const skills = employeesWithSkillsMap.get(e.employee) || {};
                          return {
                            employee: e.employee,
                            pending_off: e.pending_off,
                            total_working_days: e.total_working_days,
                            night_shifts: e.night_shifts,
                            afternoon_shifts: 0, // Not used in display
                            weekend_shifts: e.weekend_shifts,
                            DOs_given: e.DOs_given,
                            ...skills, // Include all skill fields
                          };
                        });
                        
                        return (
                          <>
                            <div className="overflow-x-auto max-w-full">
                            <ScheduleTable
                              schedule={generatedSchedule}
                              year={selectedYear}
                              month={selectedMonth}
                              employees={dynamicEmployees}
                              editable={true}
                              canChangeColors={true}
                              onScheduleChange={(updatedSchedule) => {
                                setGeneratedSchedule(updatedSchedule);
                              }}
                              selectedPeriod={selectedPeriod}
                            />
                            </div>
                            
                            <ScheduleAnalysis
                              schedule={generatedSchedule}
                              employees={dynamicEmployees}
                              metrics={scheduleMetrics}
                              year={selectedYear}
                              month={selectedMonth}
                            />
                          </>
                        );
                      })()}
                      
                      {(() => {
                        // If schedule hasn't been edited, show ScheduleAnalysis with original employees
                        if (!generatedEmployees || !originalGeneratedSchedule) {
                          return (
                            <ScheduleAnalysis
                              schedule={generatedSchedule}
                              employees={generatedEmployees || rosterData?.employees}
                              metrics={scheduleMetrics}
                              year={selectedYear}
                              month={selectedMonth}
                            />
                          );
                        }
                        
                        const scheduleChanged = JSON.stringify(generatedSchedule) !== JSON.stringify(originalGeneratedSchedule);
                        if (!scheduleChanged) {
                          return (
                            <ScheduleAnalysis
                              schedule={generatedSchedule}
                              employees={generatedEmployees}
                              metrics={scheduleMetrics}
                              year={selectedYear}
                              month={selectedMonth}
                            />
                          );
                        }
                        
                        // Schedule has been edited - already rendered with dynamic employees above
                        return null;
                      })()}

                      <div className="mt-8 border-t border-gray-200 pt-6">
                        <h3 className="text-xl font-bold text-gray-900 mb-4">Ready to Use This Schedule?</h3>
                        <div className="flex items-center space-x-4">
                          <button
                            onClick={handleCommitSchedule}
                            className="px-6 py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700"
                          >
                            Commit Schedule
                          </button>
                          <p className="text-sm text-gray-600">
                            After committing, this schedule will be available to your staff in All Rosters page.
                          </p>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
  );
};

// Helper components
const AddTimeOffForm: React.FC<{
  employees: string[];
  leaveTypes: LeaveType[];
  year: number;
  month: number;
  onSubmit: (employee: string, fromDate: string, toDate: string, code: string) => void;
  onCancel: () => void;
}> = ({ employees, leaveTypes, year, month, onSubmit, onCancel }) => {
  const [employee, setEmployee] = useState(employees[0] || '');
  // Initialize with YYYY-MM-DD format (for date input) - default to first day of selected month
  const defaultDate = `${year}-${month.toString().padStart(2, '0')}-01`;
  const [fromDate, setFromDate] = useState(defaultDate);
  const [toDate, setToDate] = useState(defaultDate);
  const [code, setCode] = useState(leaveTypes.length > 0 ? leaveTypes[0].code : '');

  // Update code when leaveTypes loads
  useEffect(() => {
    if (leaveTypes.length > 0 && !code) {
      setCode(leaveTypes[0].code);
    }
  }, [leaveTypes, code]);

  // Update dates when year/month changes
  useEffect(() => {
    const newDefaultDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    setFromDate(newDefaultDate);
    setToDate(newDefaultDate);
  }, [year, month]);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
      <h4 className="font-semibold mb-4">Add Leave Request</h4>
      <div className="grid grid-cols-4 gap-4">
        <select value={employee} onChange={(e) => setEmployee(e.target.value)} className="px-3 py-2 border rounded">
          {employees.map(emp => <option key={emp} value={emp}>{emp}</option>)}
        </select>
        <CalendarDatePicker
          value={fromDate} 
          onChange={setFromDate}
          className="px-3 py-2"
        />
        <CalendarDatePicker
          value={toDate} 
          onChange={setToDate}
          className="px-3 py-2"
          min={fromDate || undefined}
        />
        <select value={code} onChange={(e) => setCode(e.target.value)} className="px-3 py-2 border rounded">
          {leaveTypes.map(lt => (
            <option key={lt.code} value={lt.code}>
              {lt.code} - {lt.description}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-4 flex space-x-2">
        <button onClick={() => onSubmit(employee, fromDate, toDate, code)} className="px-4 py-2 bg-primary-600 text-white rounded">Add</button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-200 rounded">Cancel</button>
      </div>
    </div>
  );
};

const AddLockForm: React.FC<{
  employees: string[];
  year: number;
  month: number;
  shiftTypes: ShiftType[];
  onSubmit: (employee: string, fromDate: string, toDate: string, shift: string, force: boolean) => void;
  onCancel: () => void;
}> = ({ employees, year, month, shiftTypes, onSubmit, onCancel }) => {
  const [employee, setEmployee] = useState(employees[0] || '');
  // Initialize with YYYY-MM-DD format (for date input) - default to first day of selected month
  const defaultDate = `${year}-${month.toString().padStart(2, '0')}-01`;
  const [fromDate, setFromDate] = useState(defaultDate);
  const [toDate, setToDate] = useState(defaultDate);
  
  // Filter out O and DO from available shift types
  const availableShiftTypes = shiftTypes.filter((st: ShiftType) => st.code !== 'O' && st.code !== 'DO');
  const [shift, setShift] = useState<string>(availableShiftTypes[0]?.code || '');
  const [force, setForce] = useState(true);

  // Update shift when shiftTypes loads
  useEffect(() => {
    if (availableShiftTypes.length > 0 && (!shift || shift === 'O' || shift === 'DO')) {
      setShift(availableShiftTypes[0].code);
    }
  }, [shiftTypes, shift]);

  // Update dates when year/month changes
  useEffect(() => {
    const newDefaultDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    setFromDate(newDefaultDate);
    setToDate(newDefaultDate);
  }, [year, month]);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
      <h4 className="font-semibold mb-4">Add Shift Request</h4>
      <div className="grid grid-cols-5 gap-4">
        <select value={employee} onChange={(e) => setEmployee(e.target.value)} className="px-3 py-2 border rounded">
          {employees.map(emp => <option key={emp} value={emp}>{emp}</option>)}
        </select>
        <CalendarDatePicker
          value={fromDate} 
          onChange={setFromDate}
          className="px-3 py-2"
        />
        <CalendarDatePicker
          value={toDate} 
          onChange={setToDate}
          className="px-3 py-2"
          min={fromDate || undefined}
        />
        <select value={shift} onChange={(e) => setShift(e.target.value)} className="px-3 py-2 border rounded">
          {availableShiftTypes.length > 0 ? availableShiftTypes.map(st => <option key={st.code} value={st.code}>{st.code}</option>) : <option>Loading...</option>}
        </select>
        <select value={force ? 'Must' : 'Cannot'} onChange={(e) => setForce(e.target.value === 'Must')} className="px-3 py-2 border rounded">
          <option value="Must">Must</option>
          <option value="Cannot">Cannot</option>
        </select>
      </div>
      <div className="mt-4 flex space-x-2">
        <button onClick={() => onSubmit(employee, fromDate, toDate, shift, force)} className="px-4 py-2 bg-primary-600 text-white rounded">Add</button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-200 rounded">Cancel</button>
      </div>
    </div>
  );
};
