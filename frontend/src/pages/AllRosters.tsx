import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { schedulesAPI, Schedule, dataAPI } from '../services/api';
import { ScheduleTable } from '../components/ScheduleTable';
import * as htmlToImage from 'html-to-image';
import { useAuth } from '../contexts/AuthContext';
import { useAuthGuard } from '../hooks/useAuthGuard';
import { useDate } from '../contexts/DateContext';
import { isTokenExpired } from '../utils/tokenUtils';
import Plot from 'react-plotly.js';
import { calculateFairnessData, FairnessData } from '../utils/fairnessMetrics';
import { calculatePendingOff, PendingOffData } from '../utils/pendingOffCalculation';
import { FairnessLineGraph } from '../components/FairnessLineGraph';

export const AllRostersPage: React.FC = () => {
  const { selectedYear, selectedMonth, setSelectedYear, setSelectedMonth } = useDate();
  // FIX: Use auth guard to prevent API calls until auth is confirmed
  const { isReady: authReady } = useAuthGuard(false); // Requires auth but not manager
  const { user, loading: authLoading } = useAuth(); // Keep for isManager check
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [schedulesLoaded, setSchedulesLoaded] = useState(false); // Track if schedules list is loaded
  const [currentSchedule, setCurrentSchedule] = useState<Schedule | null>(null);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [loading, setLoading] = useState(true);
  const [loadingSchedule, setLoadingSchedule] = useState(false); // Separate loading state for individual schedule
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [originalSchedule, setOriginalSchedule] = useState<Schedule | null>(null);
  const [employeesFromAPI, setEmployeesFromAPI] = useState<any[]>([]);
  const scheduleCardRef = useRef<HTMLDivElement>(null);
  const scheduleImageRef = useRef<HTMLDivElement>(null);
  const isManager = user?.employee_type === 'Manager';

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Period date ranges configuration (2026 only)
  const PERIOD_RANGES = {
    'pre-ramadan': { start: '2026-02-01', end: '2026-02-18' },
    'ramadan': { start: '2026-02-19', end: '2026-03-19' },
    'post-ramadan': { start: '2026-03-20', end: '2026-03-31' }
  } as const;

  // Helper to check if a date is in a period range
  const isDateInPeriod = (dateStr: string, period: keyof typeof PERIOD_RANGES): boolean => {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;
    const range = PERIOD_RANGES[period];
    return date >= new Date(range.start) && date <= new Date(range.end);
  };

  // Helper to filter schedule entries by period
  const filterScheduleByPeriod = (schedule: any[], period: keyof typeof PERIOD_RANGES): any[] => {
    return schedule.filter((e: any) => {
      const dateStr = e.date?.split('T')[0] || e.date;
      return dateStr ? isDateInPeriod(dateStr, period) : false;
    });
  };

  // Split and merge Feb and Mar 2026 schedules into pre-ramadan, ramadan, and post-ramadan
  const mergeRamadanSchedules = (schedules: Schedule[]): Schedule[] => {
    const febSchedule = schedules.find(s => s.year === 2026 && s.month === 2);
    const marSchedule = schedules.find(s => s.year === 2026 && s.month === 3);
    
    if (!febSchedule && !marSchedule) {
      return schedules;
    }
    
    const result: Schedule[] = [];
    
    // Split schedules by period
    if (febSchedule) {
      const preRamadanEntries = filterScheduleByPeriod(febSchedule.schedule, 'pre-ramadan');
      if (preRamadanEntries.length > 0) {
        result.push({
          year: 2026,
          month: 2,
          schedule: preRamadanEntries,
          employees: febSchedule.employees,
          metrics: febSchedule.metrics
        });
      }
    }
    
    // Merge Ramadan from both months
    const febRamadanEntries = febSchedule ? filterScheduleByPeriod(febSchedule.schedule, 'ramadan') : [];
    const marRamadanEntries = marSchedule ? filterScheduleByPeriod(marSchedule.schedule, 'ramadan') : [];
    
    if (febRamadanEntries.length > 0 || marRamadanEntries.length > 0) {
      result.push({
        year: 2026,
        month: 2,
        schedule: [...febRamadanEntries, ...marRamadanEntries],
        employees: marSchedule?.employees || febSchedule?.employees,
        metrics: marSchedule?.metrics || febSchedule?.metrics
      });
    }
    
    if (marSchedule) {
      const postRamadanEntries = filterScheduleByPeriod(marSchedule.schedule, 'post-ramadan');
      if (postRamadanEntries.length > 0) {
        result.push({
          year: 2026,
          month: 3,
          schedule: postRamadanEntries,
          employees: marSchedule.employees,
          metrics: marSchedule.metrics
        });
      }
    }
    
    // Add all other schedules
    result.push(...schedules.filter(s => !(s.year === 2026 && (s.month === 2 || s.month === 3))));
    
    return result;
  };

  const loadSchedules = useCallback(async (signal?: AbortSignal) => {
    // FIX: Double-check token is still valid right before making the call
    // This prevents race conditions where token expires between guard check and API call
    const token = localStorage.getItem('access_token');
    if (!token || isTokenExpired(token)) {
      // Token expired between guard check and API call - skip request
      console.warn('⚠️ Token expired between guard check and API call - skipping request');
      setSchedules([]);
      setSchedulesLoaded(true);
      setLoading(false);
      setError('Authentication expired. Please refresh the page.');
      return;
    }

    // FIX: Check if request was cancelled before making API call
    if (signal?.aborted) {
      return;
    }

    try {
      setLoading(true);
      setSchedulesLoaded(false);
      // FIX: Pass abort signal to axios request (axios supports AbortSignal)
      const data = await schedulesAPI.getCommittedSchedules(signal);
      
      // FIX: Check if request was cancelled after API call
      if (signal?.aborted) {
        return;
      }
      
      // Merge Feb and Mar 2026 schedules if they form Ramadan
      const mergedSchedules = mergeRamadanSchedules(data);
      setSchedules(mergedSchedules);

      if (mergedSchedules.length === 0) {
        setSelectedYear(null);
        setSelectedMonth(null);
        setCurrentSchedule(null);
      } else if (
        selectedYear &&
        selectedMonth &&
        !mergedSchedules.some((s) => s.year === selectedYear && s.month === selectedMonth)
      ) {
        // Previously selected schedule no longer exists
        setCurrentSchedule(null);
        setSelectedMonth(null);
      }
      setSchedulesLoaded(true); // Mark schedules as loaded
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load schedules');
      setSchedulesLoaded(true); // Still mark as loaded so UI can show error state
    } finally {
      setLoading(false);
    }
  }, []);

  // Load employees from API to get the correct order (from EmployeeSkills table)
  const loadEmployees = useCallback(async () => {
    try {
      const employees = await dataAPI.getEmployees();
      setEmployeesFromAPI(employees);
    } catch (err: any) {
      console.error('Failed to load employees:', err);
      setEmployeesFromAPI([]);
    }
  }, []);

  // FIX: Load schedules list ONLY after auth guard confirms we're ready
  // This ensures user is authenticated AND token is valid before making API calls
  // FIX: Add request cancellation on unmount to prevent memory leaks
  useEffect(() => {
    const abortController = new AbortController();
    
    if (authReady) {
      loadSchedules(abortController.signal);
      loadEmployees(); // Load employees to get correct order
    } else {
      // Auth not ready - clear schedules and show loading
      setSchedules([]);
      setSchedulesLoaded(false);
      setLoading(true);
      setError(null);
    }
    
    // FIX: Cancel request on unmount or when authReady changes
    return () => {
      abortController.abort();
    };
  }, [authReady, loadSchedules, loadEmployees]);

  // Store the selected period to help identify which schedule to load
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  
  // Load specific schedule ONLY after schedules list is loaded
  useEffect(() => {
    if (!schedulesLoaded) return; // Wait for schedules list to be loaded first
    
    if (selectedYear && selectedMonth) {
      // Find all schedules with this year/month (there might be multiple: pre-ramadan and ramadan both have month=2)
      const matchingSchedules = schedules.filter(
        (s) => s.year === selectedYear && s.month === selectedMonth
      );
      
      if (matchingSchedules.length === 0) {
        // Selected schedule doesn't exist, clear selection
        setCurrentSchedule(null);
        setSelectedPeriod(null);
        return;
      }
      
      // Determine which schedule to load based on selectedPeriod
      let scheduleToLoad = matchingSchedules[0];
      let periodToUse = selectedPeriod;
      
      if (matchingSchedules.length > 1) {
        // Multiple schedules exist - use selectedPeriod to find the right one
        if (selectedPeriod) {
          const periodSchedule = matchingSchedules.find(s => detectPeriod(s) === selectedPeriod);
          if (periodSchedule) {
            scheduleToLoad = periodSchedule;
            periodToUse = selectedPeriod;
          } else {
            // Period not found, detect from first schedule
            periodToUse = detectPeriod(scheduleToLoad);
          }
        } else {
          // No period selected, detect from first schedule
          periodToUse = detectPeriod(scheduleToLoad);
        }
      } else {
        // Single schedule, detect its period
        periodToUse = detectPeriod(scheduleToLoad) || selectedPeriod;
      }
      
      // Update selectedPeriod if we detected it
      if (periodToUse && periodToUse !== selectedPeriod) {
        setSelectedPeriod(periodToUse);
      }
      
      loadSchedule(selectedYear, selectedMonth, periodToUse);
    }
  }, [selectedYear, selectedMonth, schedulesLoaded, schedules, selectedPeriod]);

  const loadSchedule = async (year: number, month: number, period?: string | null) => {
    try {
      setLoadingSchedule(true);
      
      // For 2026 Feb/Mar, we need special handling for periods
      if (year === 2026 && (month === 2 || month === 3)) {
        // Load both months to check what we have
        const [febSchedule, marSchedule] = await Promise.all([
          schedulesAPI.getSchedule(2026, 2).catch(() => null),
          schedulesAPI.getSchedule(2026, 3).catch(() => null)
        ]);
        
        // Find ALL schedules in our merged list with this year/month (there might be multiple: pre-ramadan and ramadan both have month=2)
        const schedulesInList = schedules.filter(s => s.year === year && s.month === month);
        if (schedulesInList.length === 0) {
          // Fall back to loading single month
          const schedule = await schedulesAPI.getSchedule(year, month);
          setCurrentSchedule(schedule);
          setOriginalSchedule(JSON.parse(JSON.stringify(schedule)));
          setHasUnsavedChanges(false);
          setSaveSuccess(false);
          setError(null);
          return;
        }
        
        // Use the provided period if available, otherwise detect it
        let detectedPeriod = period;
        let scheduleInList = schedulesInList[0];
        
        // If period is provided, find the schedule matching that period
        if (period && schedulesInList.length > 1) {
          const periodSchedule = schedulesInList.find(s => detectPeriod(s) === period);
          if (periodSchedule) {
            scheduleInList = periodSchedule;
            detectedPeriod = period;
          } else {
            detectedPeriod = detectPeriod(scheduleInList);
          }
        } else {
          // Detect period for the schedule
          detectedPeriod = detectPeriod(scheduleInList);
          
          // If we have multiple schedules with month=2 and no period specified, prefer ramadan if it exists
          if (schedulesInList.length > 1 && !period) {
            const ramadanSchedule = schedulesInList.find(s => detectPeriod(s) === 'ramadan');
            if (ramadanSchedule) {
              scheduleInList = ramadanSchedule;
              detectedPeriod = 'ramadan';
            }
          }
        }
        
        // Filter schedule by detected period
        if (detectedPeriod && detectedPeriod in PERIOD_RANGES) {
          let filteredSchedule: Schedule;
          
          if (detectedPeriod === 'ramadan') {
            // Ramadan spans both months
            const febEntries = febSchedule ? filterScheduleByPeriod(febSchedule.schedule, 'ramadan') : [];
            const marEntries = marSchedule ? filterScheduleByPeriod(marSchedule.schedule, 'ramadan') : [];
            filteredSchedule = {
              year: 2026,
              month: 2,
              schedule: [...febEntries, ...marEntries],
              employees: marSchedule?.employees || febSchedule?.employees,
              metrics: marSchedule?.metrics || febSchedule?.metrics
            };
          } else if (detectedPeriod === 'pre-ramadan') {
            // Pre-ramadan is only in February
            if (!febSchedule) {
              throw new Error('Pre-ramadan schedule not found');
            }
            filteredSchedule = {
              ...febSchedule,
              schedule: filterScheduleByPeriod(febSchedule.schedule, 'pre-ramadan')
            };
          } else if (detectedPeriod === 'post-ramadan') {
            // Post-ramadan is only in March
            if (!marSchedule) {
              throw new Error('Post-ramadan schedule not found');
            }
            filteredSchedule = {
              ...marSchedule,
              schedule: filterScheduleByPeriod(marSchedule.schedule, 'post-ramadan')
            };
          } else {
            throw new Error(`Unknown period: ${detectedPeriod}`);
          }
          
          setCurrentSchedule(filteredSchedule);
          setOriginalSchedule(JSON.parse(JSON.stringify(filteredSchedule)));
          // Ensure selectedPeriod is set correctly
          if (detectedPeriod && detectedPeriod !== selectedPeriod) {
            setSelectedPeriod(detectedPeriod);
          }
          setHasUnsavedChanges(false);
          setSaveSuccess(false);
          setError(null);
          return;
        }
      }
      
      // Default: load single month
      const schedule = await schedulesAPI.getSchedule(year, month);
      setCurrentSchedule(schedule);
      // Store original schedule for cancel functionality
      setOriginalSchedule(JSON.parse(JSON.stringify(schedule)));
      setHasUnsavedChanges(false);
      setSaveSuccess(false);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load schedule');
      setCurrentSchedule(null);
      setOriginalSchedule(null);
    } finally {
      setLoadingSchedule(false);
    }
  };

  // Detect period from schedule date range (for 2026 Feb/Mar)
  const detectPeriod = (schedule: Schedule): keyof typeof PERIOD_RANGES | null => {
    if (!schedule || !schedule.schedule || schedule.year !== 2026 || (schedule.month !== 2 && schedule.month !== 3)) {
      return null;
    }
    
    const dates: Date[] = schedule.schedule
      .map((entry: any) => {
        const dateStr = entry.date?.split('T')[0] || entry.date;
        if (!dateStr) return null;
        const date = new Date(dateStr);
        return !isNaN(date.getTime()) ? date : null;
      })
      .filter((d: Date | null): d is Date => d !== null)
      .sort((a: Date, b: Date) => a.getTime() - b.getTime());
    
    if (dates.length === 0) return null;
    
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];
    
    // Check each period range
    for (const [period, range] of Object.entries(PERIOD_RANGES)) {
      if (minDate >= new Date(range.start) && maxDate <= new Date(range.end)) {
        return period as keyof typeof PERIOD_RANGES;
      }
    }
    
    return null;
  };

  // Get available years (only committed ones)
  const availableYears = Array.from(new Set(schedules.map(s => s.year))).sort();
  
  // Get available month options for the selected year
  // For 2026 Feb/Mar, show period-specific options instead of just "February" and "March"
  const availableMonthOptions = useMemo(() => {
    if (!selectedYear) return [];
    
    const yearSchedules = schedules.filter(s => s.year === selectedYear);
    if (yearSchedules.length === 0) return [];
    
    const periodOptions: Array<{ value: string; label: string; month: number; period: string | null }> = [];
    const regularOptions: Array<{ value: string; label: string; month: number; period: string | null }> = [];
    const processedMonths = new Set<number>();
    
    // Special handling for 2026 Feb/Mar - show period-specific options FIRST
    if (selectedYear === 2026) {
      // Check for pre-ramadan (Feb 1-18)
      const hasPreRamadan = yearSchedules.some(s => {
        const period = detectPeriod(s);
        return period === 'pre-ramadan';
      });
      if (hasPreRamadan) {
        periodOptions.push({ value: '2-pre', label: 'February (Pre-Ramadan)', month: 2, period: 'pre-ramadan' });
        processedMonths.add(2);
      }
      
      // Check for ramadan (Feb 19 - Mar 19)
      const hasRamadan = yearSchedules.some(s => {
        const period = detectPeriod(s);
        return period === 'ramadan';
      });
      if (hasRamadan) {
        periodOptions.push({ value: '2-ramadan', label: 'Ramadan', month: 2, period: 'ramadan' });
        processedMonths.add(2);
        processedMonths.add(3); // Ramadan spans both months
      }
      
      // Check for post-ramadan (Mar 20-31)
      const hasPostRamadan = yearSchedules.some(s => {
        const period = detectPeriod(s);
        return period === 'post-ramadan';
      });
      if (hasPostRamadan) {
        periodOptions.push({ value: '3-post', label: 'March (Post-Ramadan)', month: 3, period: 'post-ramadan' });
        processedMonths.add(3);
      }
      
      // Sort periods in order: pre-ramadan, ramadan, post-ramadan
      periodOptions.sort((a, b) => {
        const periodOrder: { [key: string]: number } = { 'pre-ramadan': 1, 'ramadan': 2, 'post-ramadan': 3 };
        return (periodOrder[a.period || ''] || 0) - (periodOrder[b.period || ''] || 0);
      });
    }
    
    // Add all other months that have committed schedules
    // For 2026, skip January (1), February (2), and March (3) regular months
    const allMonths = Array.from(new Set(yearSchedules.map(s => s.month))).sort();
    allMonths.forEach(month => {
      if (!processedMonths.has(month)) {
        // For 2026, skip January, February, and March regular months
        if (selectedYear === 2026 && (month === 1 || month === 2 || month === 3)) {
          return;
        }
        regularOptions.push({
          value: month.toString(),
          label: monthNames[month - 1],
          month,
          period: null as string | null
        });
      }
    });
    
    // Sort regular options by month
    regularOptions.sort((a, b) => a.month - b.month);
    
    // Return periods first, then regular months
    return [...periodOptions, ...regularOptions];
  }, [schedules, selectedYear]);
  
  // Use selectedPeriod if available, otherwise detect from current schedule
  const currentPeriod = selectedPeriod || (currentSchedule ? detectPeriod(currentSchedule) : null);

  const generateScheduleImage = async (): Promise<string | null> => {
    if (!scheduleImageRef.current || !selectedYear || !selectedMonth || !currentSchedule) {
      return null;
    }

    // Wait for DOM to be ready
    await new Promise(resolve => setTimeout(resolve, 500));
      
    const container = scheduleImageRef.current;
    if (!container) return null;

    // Get the root div from ScheduleTable
    const rootDiv = container.firstElementChild as HTMLElement;
    if (!rootDiv) return null;

    // Store original states to restore later
    const buttonsToHide: HTMLElement[] = [];
    const inputsToHide: HTMLElement[] = [];
    const originalOverflows: Map<HTMLElement, string> = new Map();
    const originalWidths: Map<HTMLElement, string> = new Map();

    try {
      // Temporarily hide buttons and color pickers
      rootDiv.querySelectorAll('button').forEach(btn => {
        const el = btn as HTMLElement;
        buttonsToHide.push(el);
        el.style.display = 'none';
      });
      
      rootDiv.querySelectorAll('input[type="color"]').forEach(input => {
        const el = input as HTMLElement;
        const parent = el.parentElement;
        if (parent && parent.classList.contains('absolute')) {
          inputsToHide.push(parent as HTMLElement);
          (parent as HTMLElement).style.display = 'none';
        }
      });

      // Expand table - temporarily modify styles
      const tableWrapper = rootDiv.querySelector('.overflow-x-auto') as HTMLElement;
      if (tableWrapper) {
        originalOverflows.set(tableWrapper, tableWrapper.style.overflow || '');
        originalWidths.set(tableWrapper, tableWrapper.style.width || '');
        tableWrapper.style.overflow = 'visible';
        tableWrapper.style.width = 'auto';
        tableWrapper.style.maxWidth = 'none';
      }

      // Find the inner wrapper div (inline-block min-w-full)
      const innerWrapper = tableWrapper?.querySelector('.inline-block') as HTMLElement;
      if (innerWrapper) {
        originalWidths.set(innerWrapper, innerWrapper.style.width || '');
        innerWrapper.style.width = 'auto';
        innerWrapper.style.minWidth = 'max-content';
        innerWrapper.style.maxWidth = 'none';
      }

      const table = rootDiv.querySelector('table') as HTMLTableElement;
        if (table) {
        originalWidths.set(table, table.style.width || '');
          table.style.width = 'auto';
          table.style.minWidth = 'max-content';
        table.style.maxWidth = 'none';
          table.classList.remove('min-w-full');
        
        table.querySelectorAll('th, td').forEach(cell => {
          const el = cell as HTMLElement;
          el.style.whiteSpace = 'nowrap';
          });
        }

      // Create wrapper div with title - NO width constraints
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        background: white;
        padding: 40px;
        font-family: system-ui, -apple-system, sans-serif;
        width: max-content;
        max-width: none;
      `;
      document.body.appendChild(wrapper);

      // Add title
      const title = document.createElement('h2');
      title.textContent = `${monthNames[selectedMonth - 1]} ${selectedYear} Schedule`;
      title.style.cssText = 'font-size: 28px; font-weight: bold; color: #111827; margin: 0 0 30px 0; text-align: center;';
      wrapper.appendChild(title);

      // Move rootDiv temporarily to wrapper
      const parent = rootDiv.parentElement;
      wrapper.appendChild(rootDiv);

      // Wait for layout to settle and table to expand
      await new Promise(resolve => setTimeout(resolve, 500));

      // Constrain legend width to match table width
      const legendDiv = rootDiv.querySelector('.mt-6.bg-white') as HTMLElement;
      let legendOriginalWidth = '';
      if (legendDiv && table) {
        const tableWidth = table.scrollWidth;
        legendOriginalWidth = legendDiv.style.width || '';
        legendDiv.style.width = `${tableWidth}px`;
        legendDiv.style.maxWidth = `${tableWidth}px`;
        legendDiv.style.boxSizing = 'border-box';
      }

      // Wait for legend width adjustment
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get actual dimensions after expansion
      const wrapperWidth = wrapper.scrollWidth;
      const wrapperHeight = wrapper.scrollHeight;

      // Capture at full size to avoid cropping, but use lower pixelRatio for smaller file size
      // pixelRatio: 1.25 provides good balance between quality and file size
      const dataUrl = await htmlToImage.toPng(wrapper, {
        backgroundColor: '#ffffff',
        pixelRatio: 1.25,
        cacheBust: true,
        width: wrapperWidth,
        height: wrapperHeight,
      });

      // Restore legend width
      if (legendDiv) {
        legendDiv.style.width = legendOriginalWidth;
        legendDiv.style.maxWidth = '';
        legendDiv.style.boxSizing = '';
      }

      // Move rootDiv back to original parent
      if (parent) {
        parent.appendChild(rootDiv);
      }
      
      // Remove wrapper
      document.body.removeChild(wrapper);

      // Restore original states
      buttonsToHide.forEach(btn => btn.style.display = '');
      inputsToHide.forEach(input => input.style.display = '');
      originalOverflows.forEach((value, el) => el.style.overflow = value || '');
      originalWidths.forEach((value, el) => el.style.width = value || '');

      return dataUrl && dataUrl !== 'data:,' ? dataUrl : null;
    } catch (error) {
      console.error('Image generation error:', error);
      
      // Restore original states on error
      buttonsToHide.forEach(btn => btn.style.display = '');
      inputsToHide.forEach(input => input.style.display = '');
      originalOverflows.forEach((value, el) => el.style.overflow = value || '');
      originalWidths.forEach((value, el) => el.style.width = value || '');
      
      // Ensure rootDiv is back in original position
      const parent = container;
      if (parent && !parent.contains(rootDiv)) {
        parent.appendChild(rootDiv);
      }
      
      return null;
    }
  };

  const handleViewImage = async () => {
    if (!selectedYear || !selectedMonth) return;

    setViewing(true);
      setDownloadError(null);

    try {
      const imageDataUrl = await generateScheduleImage();
      
      if (!imageDataUrl) {
        setDownloadError('Failed to generate schedule image. Please try again.');
        return;
      }

      // Store image data in sessionStorage to avoid URL length issues
      const storageKey = `schedule_image_${selectedYear}_${selectedMonth}`;
      sessionStorage.setItem(storageKey, imageDataUrl);
      
      // Open view page with just year and month in URL
      const viewUrl = `${window.location.origin}/view-schedule.html?year=${selectedYear}&month=${selectedMonth}`;
      window.open(viewUrl, '_blank');
    } catch (error) {
      console.error('View image error:', error);
      setDownloadError('Failed to prepare schedule image. Please try again.');
    } finally {
      setViewing(false);
    }
  };

  const handleDownloadImage = async () => {
    if (!selectedYear || !selectedMonth) return;

      setDownloading(true);
      setDownloadError(null);

    try {
      const imageDataUrl = await generateScheduleImage();
      
      if (!imageDataUrl) {
        setDownloadError('Failed to download schedule image. Please try again.');
        return;
      }

      const link = document.createElement('a');
      link.href = imageDataUrl;
      link.download = `schedule_${selectedYear}_${String(selectedMonth).padStart(2, '0')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Download image error:', error);
      setDownloadError('Failed to download schedule image. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const handleScheduleChange = (updatedSchedule: any[]) => {
    if (currentSchedule) {
      setCurrentSchedule({
        ...currentSchedule,
        schedule: updatedSchedule
      });
      setHasUnsavedChanges(true);
      setSaveSuccess(false);
    }
  };

  const handleCancelChanges = () => {
    if (originalSchedule) {
      setCurrentSchedule(JSON.parse(JSON.stringify(originalSchedule)));
      setHasUnsavedChanges(false);
      setSaveSuccess(false);
      setError(null);
    }
  };

  const handleSaveSchedule = async () => {
    if (!currentSchedule || !selectedYear || !selectedMonth) {
      alert('No schedule to save');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSaveSuccess(false);
      
      // Normalize all dates to ISO format (YYYY-MM-DDTHH:MM:SS) before sending
      const normalizedSchedule = currentSchedule.schedule.map(entry => ({
        ...entry,
        date: entry.date.includes('T') ? entry.date : `${entry.date.split('T')[0]}T00:00:00`
      }));
      
      await schedulesAPI.updateSchedule(
        selectedYear,
        selectedMonth,
        normalizedSchedule,
        currentSchedule.employees
      );
      
      // Reload the schedule to get the updated version
      await loadSchedule(selectedYear, selectedMonth);
      
      // Show success message in the same spot as "Unsaved changes"
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      const errorMessage = err.response?.data?.detail || err.message || 'Failed to save schedule changes';
      setError(errorMessage);
      alert(`Failed to save: ${errorMessage}`);
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  };

  // Filter schedule data for selected month
  const getMonthSchedule = () => {
    if (!currentSchedule || !selectedYear || !selectedMonth) return [];
    return currentSchedule.schedule.filter((entry: any) => {
      const date = new Date(entry.date);
      return date.getFullYear() === selectedYear && date.getMonth() + 1 === selectedMonth;
    });
  };

  const monthSchedule = getMonthSchedule();

  // Calculate metrics
  const calculateMetrics = () => {
    if (!monthSchedule.length) return null;

    const uniqueEmployees = new Set(monthSchedule.map((s: any) => s.employee));
    const uniqueDates = new Set(monthSchedule.map((s: any) => s.date.split('T')[0]));
    const mainShifts = monthSchedule.filter((s: any) => ['M', 'M3', 'M4'].includes(s.shift)).length;

    return {
      totalAssignments: monthSchedule.length,
      employees: uniqueEmployees.size,
      days: uniqueDates.size,
      mainShifts,
    };
  };

  // Get employee order from employees API (EmployeeSkills table order), not from stored schedule
  // This ensures consistent ordering matching the employees table
  const employeeOrder = useMemo(() => {
    if (employeesFromAPI.length > 0) {
      return employeesFromAPI.map((emp: any) => emp.employee);
    }
    // Fallback to schedule employees if API employees not loaded yet
    if (currentSchedule?.employees) {
      return currentSchedule.employees.map((emp: any) => emp.employee);
    }
    return undefined;
  }, [employeesFromAPI, currentSchedule]);

  const fairnessData: FairnessData | null = useMemo(() => {
    if (!monthSchedule.length) return null;
    return calculateFairnessData(monthSchedule, employeeOrder);
  }, [monthSchedule, employeeOrder]);
  
  // Calculate dynamic pending_off values from current schedule state
  const dynamicEmployees: PendingOffData[] | null = useMemo(() => {
    if (!monthSchedule.length || !originalSchedule || !originalSchedule.employees) return null;
    if (!selectedYear || !selectedMonth) return null;
    
    // Get original schedule entries for this month
    const originalScheduleEntries = originalSchedule.schedule.filter((entry: any) => {
      const date = new Date(entry.date);
      return date.getFullYear() === selectedYear && date.getMonth() + 1 === selectedMonth;
    });
    
    // Calculate what was added in the original month from the original schedule
    const originalCalculated = calculatePendingOff(originalScheduleEntries, {}, {}, selectedYear, selectedMonth);
    const originalEmployeesMap = new Map(originalSchedule.employees.map((e: any) => [e.employee, e]));
    
    // Reverse-calculate initial pending_off for each employee:
    // final_pending_off = initial_pending_off + (weekend_shifts + night_shifts - DOs_given)
    // So initial_pending_off = final_pending_off - (weekend_shifts + night_shifts - DOs_given)
    const initialPendingOff: Record<string, number> = {};
    
    originalCalculated.forEach(calc => {
      const original = originalEmployeesMap.get(calc.employee);
      if (original) {
        const finalPendingOff = original.pending_off || 0;
        // Calculate what was added this month: weekend_shifts + night_shifts - DOs_given
        const addedThisMonth = calc.weekend_shifts + calc.night_shifts - calc.DOs_given;
        // Initial = Final - Added
        initialPendingOff[calc.employee] = Math.max(0, finalPendingOff - addedThisMonth);
      } else {
        // Employee not in original, use 0 as initial
        initialPendingOff[calc.employee] = 0;
      }
    });
    
    // For any employees in the original employees list but not in the calculated list,
    // use their pending_off as the initial (they may not have had shifts in original schedule)
    originalSchedule.employees.forEach((emp: any) => {
      if (!(emp.employee in initialPendingOff)) {
        initialPendingOff[emp.employee] = emp.pending_off || 0;
      }
    });
    
    // Now calculate from current (potentially edited) schedule using the calculated initial values
    return calculatePendingOff(monthSchedule, initialPendingOff, {}, selectedYear, selectedMonth);
  }, [monthSchedule, originalSchedule, selectedYear, selectedMonth]);
  
  const metrics = calculateMetrics();

  // Determine which tabs to show based on available data
  const availableTabs = useMemo(() => {
    const allTabs = [
      { id: 'overview', emoji: '', label: 'Overview' },
      { id: 'fairness', emoji: '', label: 'Fairness Analysis' },
      { id: 'pending-off', emoji: '', label: 'Employee Pending Off' },
      { id: 'solver', emoji: '', label: 'Solver Metrics' },
    ] as const;
    
    if (!currentSchedule) return allTabs;
    
    // Filter out tabs based on data availability
    return allTabs.filter(tab => {
      if (tab.id === 'pending-off') {
        // Show if employees with pending_off data exist
        const hasPendingOffData = currentSchedule.employees && 
          currentSchedule.employees.length > 0 &&
          currentSchedule.employees.some((emp: any) => emp.pending_off !== undefined && emp.pending_off !== null);
        return hasPendingOffData;
      }
      if (tab.id === 'solver') {
        // Show if metrics exist
        return currentSchedule.metrics !== undefined && currentSchedule.metrics !== null;
      }
      // Always show overview and fairness tabs
      return true;
    });
  }, [currentSchedule]);
  
  // Ensure activeTab is valid, switch to first available tab if current is hidden
  useEffect(() => {
    if (currentSchedule && availableTabs.length > 0) {
      const tabIds = availableTabs.map(t => t.id);
      if (!tabIds.includes(activeTab as typeof tabIds[number])) {
        setActiveTab(tabIds[0]);
      }
    }
  }, [currentSchedule, availableTabs, activeTab]);
  
  const tabs = availableTabs;

  // Show loading spinner while auth is loading or initial schedules list is loading
  // FIX: Show loading while auth is being verified
  // This prevents components from making API calls before auth is ready
  if (authLoading || !authReady) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        <span className="ml-3 text-gray-600">Loading schedules...</span>
      </div>
    );
  }

  // Show loading spinner while initial schedules list is loading
  if (loading && !schedulesLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        <span className="ml-3 text-gray-600">Loading schedules...</span>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">All Rosters</h2>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {schedules.length === 0 ? (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
          No committed schedules available
          {isManager ? '. Generate a new roster from the Roster Generator when you are ready.' : '.'}
        </div>
      ) : (
        <>
          {/* Year and Month Selection */}
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Select Year</label>
                <select
                  value={selectedYear || ''}
                  onChange={(e) => {
                    const year = e.target.value ? parseInt(e.target.value) : null;
                    setSelectedYear(year);
                    if (!year) {
                      setSelectedMonth(null);
                      setSelectedPeriod(null);
                    } else {
                      // Clear month and period when year changes
                      setSelectedMonth(null);
                      setSelectedPeriod(null);
                    }
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">Select Year...</option>
                  {availableYears.map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Select Month</label>
                <select
                  value={(() => {
                    if (!selectedYear || !selectedMonth) return '';
                    // For 2026, check if we need period-specific value
                    if (selectedYear === 2026 && selectedPeriod) {
                      if (selectedPeriod === 'pre-ramadan' && selectedMonth === 2) return '2-pre';
                      if (selectedPeriod === 'ramadan' && selectedMonth === 2) return '2-ramadan';
                      if (selectedPeriod === 'post-ramadan' && selectedMonth === 3) return '3-post';
                    }
                    // For regular months, find the matching option
                    const matchingOption = availableMonthOptions.find(opt => opt.month === selectedMonth && !opt.period);
                    if (matchingOption) return matchingOption.value;
                    return selectedMonth.toString();
                  })()}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (!value) {
                      setSelectedMonth(null);
                      setSelectedPeriod(null);
                      return;
                    }
                    
                    // Handle period-specific values for 2026
                    if (selectedYear === 2026 && value.includes('-')) {
                      const parts = value.split('-');
                      const month = parseInt(parts[0]);
                      const periodPart = parts[1];
                      
                      setSelectedMonth(month);
                      if (periodPart === 'pre') {
                        setSelectedPeriod('pre-ramadan');
                      } else if (periodPart === 'ramadan') {
                        setSelectedPeriod('ramadan');
                      } else if (periodPart === 'post') {
                        setSelectedPeriod('post-ramadan');
                      } else {
                        setSelectedPeriod(null);
                      }
                    } else {
                      // Regular month selection
                      const month = parseInt(value);
                      setSelectedMonth(month);
                      setSelectedPeriod(null);
                    }
                  }}
                  disabled={!selectedYear}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                >
                  <option value="">Select Month...</option>
                  {availableMonthOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {selectedYear && selectedMonth && loadingSchedule && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              <span className="ml-3 text-gray-600">Loading schedule...</span>
            </div>
          )}

          {selectedYear && selectedMonth && currentSchedule && !loadingSchedule && (
            <>
              {/* Schedule Table Section */}
              <div
                ref={scheduleCardRef}
                className="bg-white rounded-lg shadow p-6 mb-6"
                style={{ overflow: 'visible' }}
              >
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">
                      {currentPeriod === 'pre-ramadan' 
                        ? `February ${selectedYear} (Pre-Ramadan) Schedule`
                        : currentPeriod === 'ramadan'
                        ? `Ramadan ${selectedYear} Schedule`
                        : currentPeriod === 'post-ramadan'
                        ? `March ${selectedYear} (Post-Ramadan) Schedule`
                        : `${monthNames[selectedMonth - 1]} ${selectedYear} Schedule`}
                    </h3>
                    {isManager && !hasUnsavedChanges && !saveSuccess && (
                      <span className="text-sm text-gray-500 italic">Click any cell to edit</span>
                    )}
                    {isManager && hasUnsavedChanges && (
                      <span className="text-sm text-amber-600 font-medium">Unsaved changes</span>
                    )}
                    {isManager && saveSuccess && (
                      <span className="text-sm text-green-600 font-medium">Changes saved successfully</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {isManager && hasUnsavedChanges ? (
                      <>
                        <button
                          onClick={handleCancelChanges}
                          disabled={saving}
                          className={`px-4 py-2 bg-gray-500 text-white font-semibold rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors ${
                            saving ? 'opacity-70 cursor-not-allowed' : 'hover:bg-gray-600'
                          }`}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveSchedule}
                          disabled={saving}
                          className={`px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors ${
                            saving ? 'opacity-70 cursor-not-allowed' : 'hover:bg-blue-700'
                          }`}
                        >
                          {saving ? 'Saving...' : 'Save Changes'}
                        </button>
                      </>
                    ) : (
                      <div className="flex gap-3">
                        <button
                          onClick={handleViewImage}
                          disabled={viewing || downloading}
                          className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors hover:bg-blue-700 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                          {viewing ? 'Preparing...' : 'View Schedule'}
                        </button>
                        <button
                          onClick={handleDownloadImage}
                          disabled={viewing || downloading}
                          className="px-4 py-2 bg-red-600 text-white font-bold rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors hover:bg-red-700 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                          {downloading ? 'Preparing...' : 'Download'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {downloadError && (
                  <p className="mb-3 text-sm text-red-600">{downloadError}</p>
                )}
                <div ref={scheduleImageRef} style={{ overflow: 'visible' }}>
                  <ScheduleTable
                    schedule={currentSchedule.schedule}
                    year={selectedYear}
                    month={selectedMonth}
                    employees={employeesFromAPI.length > 0 ? employeesFromAPI : (dynamicEmployees && hasUnsavedChanges ? dynamicEmployees.map(e => ({
                      employee: e.employee,
                      pending_off: e.pending_off
                    })) : currentSchedule.employees)}
                    editable={isManager}
                    canChangeColors={isManager}
                    onScheduleChange={handleScheduleChange}
                    selectedPeriod={currentPeriod}
                  />
                </div>
              </div>

              {/* Reports & Visualization Tabs Section */}
              {monthSchedule.length > 0 && (
                <div className="overflow-hidden rounded-lg bg-white shadow">
                  {/* Tabs */}
                  <div className="border-b border-gray-200">
                    <div className="p-4 md:hidden">
                      <label className="sr-only" htmlFor="reports-tab-select">
                        Select report section
                      </label>
                      <select
                        id="reports-tab-select"
                        value={activeTab}
                        onChange={(e) => setActiveTab(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-primary-500"
                      >
                        {tabs.map((tab) => (
                          <option key={tab.id} value={tab.id}>
                            {`${tab.emoji} ${tab.label}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <nav className="hidden -mb-px overflow-x-auto md:flex">
                      {tabs.map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors ${
                            activeTab === tab.id
                              ? 'border-b-2 border-primary-500 text-primary-600'
                              : 'border-b-2 border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                          }`}
                        >
                          <span>{tab.label}</span>
                        </button>
                      ))}
                    </nav>
                  </div>

                  <div className="space-y-6 p-4 sm:p-6">
                    {/* Overview Tab */}
                    {activeTab === 'overview' && metrics && (
                      <div className="space-y-4">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">Monthly Overview</h3>
                        </div>
                        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-sm text-gray-600">Total Assignments</p>
                            <p className="text-2xl font-bold">{metrics.totalAssignments}</p>
                          </div>
                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-sm text-gray-600">Employees</p>
                            <p className="text-2xl font-bold">{metrics.employees}</p>
                          </div>
                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-sm text-gray-600">Days</p>
                            <p className="text-2xl font-bold">{metrics.days}</p>
                          </div>
                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-sm text-gray-600">Main Shifts</p>
                            <p className="text-2xl font-bold">{metrics.mainShifts}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Fairness Analysis Tab */}
                    {activeTab === 'fairness' && fairnessData && (
                      <div className="space-y-6">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">Fairness Analysis</h3>
                        </div>

                        <FairnessLineGraph
                          fairnessData={fairnessData}
                          employeeOrder={employeeOrder}
                          employees={employeesFromAPI}
                        />
                      </div>
                    )}

                    {/* Employee Pending Off Tab */}
                    {activeTab === 'pending-off' && (
                      <div className="space-y-6">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">Employee Pending Off</h3>
                        </div>
                        
                        {(() => {
                          // Use dynamic employees if we have unsaved changes, otherwise use committed employees
                          const displayEmployees = (dynamicEmployees && hasUnsavedChanges) 
                            ? dynamicEmployees.map(e => ({ employee: e.employee, pending_off: e.pending_off }))
                            : currentSchedule.employees;
                          
                          if (!displayEmployees || displayEmployees.length === 0) {
                            return (
                              <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
                                No Pending Off data available for this schedule.
                              </div>
                            );
                          }
                          
                          return (
                            <>
                              <div className="-mx-4 overflow-x-auto md:mx-0 md:overflow-visible">
                                {(() => {
                                  // Use employee order from schedule instead of sorting by pending_off
                                  // Reverse the order so graphs start with the last employee
                                  const orderedEmployees = employeeOrder 
                                    ? displayEmployees.slice().sort((a: any, b: any) => {
                                        const aIdx = employeeOrder.indexOf(a.employee);
                                        const bIdx = employeeOrder.indexOf(b.employee);
                                        if (aIdx === -1 && bIdx === -1) return 0;
                                        if (aIdx === -1) return 1;
                                        if (bIdx === -1) return -1;
                                        return bIdx - aIdx; // Reverse: bIdx - aIdx instead of aIdx - bIdx
                                      })
                                    : displayEmployees;
                                  const pendingValues = orderedEmployees.map((emp: any) => Math.round(emp.pending_off || 0));
                                  return (
                                    <Plot
                                      data={[{
                                        type: 'bar',
                                        x: orderedEmployees.map((emp: any) => emp.employee),
                                        y: pendingValues,
                                        text: pendingValues.map((value: number) => value.toString()),
                                        textposition: 'auto',
                                        marker: { color: '#5DADE2' },
                                        orientation: 'v',
                                      }]}
                                      layout={{
                                        xaxis: { title: 'Employee' },
                                        yaxis: { title: 'Pending Off Days' },
                                        height: 200,
                                        margin: { l: 50, r: 10, t: 10, b: 60 },
                                      }}
                                      config={{ responsive: true }}
                                      style={{ width: '100%', minWidth: '280px' }}
                                    />
                                  );
                                })()}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}

                    {/* Solver Metrics Tab */}
                    {activeTab === 'solver' && currentSchedule.metrics && (
                      <div className="space-y-4">
                        <h3 className="text-xl font-bold text-gray-900">Solver Metrics</h3>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-sm text-gray-600">Solve Time</p>
                            <p className="text-2xl font-bold">
                              {currentSchedule.metrics.solve_time
                                ? `${currentSchedule.metrics.solve_time.toFixed(2)}s`
                                : 'N/A'}
                            </p>
                          </div>
                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-sm text-gray-600">Status</p>
                            <p className="text-2xl font-bold">{currentSchedule.metrics.status || 'Unknown'}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {selectedYear && selectedMonth && !currentSchedule && !loading && !loadingSchedule && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
              No schedule data available for {monthNames[selectedMonth - 1]} {selectedYear}
            </div>
          )}
        </>
      )}
    </div>
  );
};

