import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  schedulesAPI,
  Schedule,
  dataAPI,
  shiftTypesAPI,
  leaveTypesAPI,
  requestsAPI,
} from '../services/api';
import { buildMyWorkingShiftsIcs } from '../utils/rosterCalendarIcs';
import { ScheduleTable } from '../components/ScheduleTable';
import * as htmlToImage from 'html-to-image';
import { useAuth } from '../contexts/AuthContext';
import { useAuthGuard } from '../hooks/useAuthGuard';
import { useDate } from '../contexts/DateContext';
import { isTokenExpired } from '../utils/tokenUtils';
import Plot from 'react-plotly.js';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { calculateFairnessData, FairnessData } from '../utils/fairnessMetrics';
import {
  calculatePendingOff,
  PendingOffData,
  getPendingOffWindow,
  filterEntriesToPendingWindow,
} from '../utils/pendingOffCalculation';
import { FairnessLineGraph } from '../components/FairnessLineGraph';
import {
  getRamadanPeriodWindows,
  isDateInWindow,
  setRamadanDateOverride,
  type RamadanPeriodId,
} from '../utils/ramadanPeriods';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip);

type RamadanWindows = NonNullable<ReturnType<typeof getRamadanPeriodWindows>>;

type OverallMetricKey =
  | 'night'
  | 'm4'
  | 'afternoon'
  | 'thursday'
  | 'weekend'
  | 'ipCombined'
  | 'mainCombined'
  | 'oShift'
  | 'leaveRequested';

type OverallViewMode = 'grouped-bar' | 'line-trend' | 'heatmap';

const OVERALL_METRICS: Array<{ key: OverallMetricKey; label: string }> = [
  { key: 'night', label: 'Night' },
  { key: 'm4', label: 'M4' },
  { key: 'afternoon', label: 'A' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'weekend', label: 'Weekend' },
  { key: 'ipCombined', label: 'IP / IP+P' },
  { key: 'mainCombined', label: 'M / M3 / M+P' },
  { key: 'oShift', label: 'O' },
  { key: 'leaveRequested', label: 'Requested Leave' },
];

const MONTH_COLORS = ['#1D9E75', '#378ADD', '#534AB7'];
const HEATMAP_COLORS = ['#EAF8F4', '#CDEEE3', '#9FDCC8', '#63C0A0', '#2F9D7B', '#136A52'];

const NIGHT_SHIFTS = new Set(['N']);
const M4_SHIFTS = new Set(['M4']);
const AFTERNOON_SHIFTS = new Set(['A']);
const IP_COMBINED_SHIFTS = new Set(['IP', 'IP+P']);
const MAIN_COMBINED_SHIFTS = new Set(['M', 'M3', 'M+P']);
const THURSDAY_FAIRNESS_SHIFTS = new Set(['A', 'M4', 'N', 'E']);
const WEEKEND_FAIRNESS_SHIFTS = new Set(['A', 'M3', 'N', 'E']);

function pickHeatmapColor(value: number, min: number, max: number): string {
  if (max <= min) return HEATMAP_COLORS[3];
  const ratio = (value - min) / (max - min);
  const idx = Math.max(0, Math.min(HEATMAP_COLORS.length - 1, Math.round(ratio * (HEATMAP_COLORS.length - 1))));
  return HEATMAP_COLORS[idx];
}

function metricMatchesShift(metric: OverallMetricKey, shift: string, leaveCodes: Set<string>): boolean {
  switch (metric) {
    case 'night':
      return NIGHT_SHIFTS.has(shift);
    case 'm4':
      return M4_SHIFTS.has(shift);
    case 'afternoon':
      return AFTERNOON_SHIFTS.has(shift);
    case 'ipCombined':
      return IP_COMBINED_SHIFTS.has(shift);
    case 'mainCombined':
      return MAIN_COMBINED_SHIFTS.has(shift);
    case 'oShift':
      return shift === 'O';
    case 'leaveRequested':
      return leaveCodes.has(shift) && shift !== 'O';
    case 'thursday':
    case 'weekend':
      return true;
    default:
      return false;
  }
}

function ramadanMonthSet(windows: RamadanWindows): Set<number> {
  return new Set([
    windows['pre-ramadan'].primaryMonth,
    windows.ramadan.primaryMonth,
    windows['post-ramadan'].primaryMonth,
  ]);
}

function filterScheduleByRamadanWindows(
  schedule: any[] | undefined,
  period: RamadanPeriodId,
  windows: RamadanWindows,
): any[] {
  if (!schedule?.length) return [];
  return schedule.filter((e: any) => {
    const dateStr = (e.date?.split('T')[0] || e.date) as string;
    return dateStr ? isDateInWindow(dateStr, windows[period]) : false;
  });
}

function detectRamadanPeriodForSchedule(schedule: Schedule, windows: RamadanWindows): RamadanPeriodId | null {
  if (!schedule?.schedule?.length) return null;
  const monthsSet = ramadanMonthSet(windows);
  if (!monthsSet.has(schedule.month)) return null;

  const dates: Date[] = schedule.schedule
    .map((entry: any) => {
      const dateStr = entry.date?.split('T')[0] || entry.date;
      if (!dateStr) return null;
      const d = new Date(dateStr);
      return !isNaN(d.getTime()) ? d : null;
    })
    .filter((d: Date | null): d is Date => d !== null)
    .sort((a: Date, b: Date) => a.getTime() - b.getTime());

  if (dates.length === 0) return null;

  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];

  for (const period of ['pre-ramadan', 'ramadan', 'post-ramadan'] as const) {
    const range = windows[period];
    if (minDate >= new Date(range.from) && maxDate <= new Date(range.to)) {
      return period;
    }
  }

  return null;
}

function mergeRamadanSchedulesForYear(
  schedules: Schedule[],
  year: number,
  windows: RamadanWindows,
): Schedule[] {
  const ramMonths = ramadanMonthSet(windows);
  if (ramMonths.size === 0) return schedules;

  const [firstRamadanMonth, secondRamadanMonth] = Array.from(ramMonths).sort((a, b) => a - b);
  const firstMonthSchedule = schedules.find((s) => s.year === year && s.month === firstRamadanMonth);
  const secondMonthSchedule = schedules.find((s) => s.year === year && s.month === secondRamadanMonth);

  if (!firstMonthSchedule && !secondMonthSchedule) {
    return schedules;
  }

  const result: Schedule[] = [];

  if (firstMonthSchedule) {
    const preRamadanEntries = filterScheduleByRamadanWindows(
      firstMonthSchedule.schedule,
      'pre-ramadan',
      windows,
    );
    if (preRamadanEntries.length > 0) {
      result.push({
        year,
        month: firstRamadanMonth,
        schedule: preRamadanEntries,
        employees: firstMonthSchedule.employees,
        metrics: firstMonthSchedule.metrics,
      });
    }
  }

  const firstRamadanSlice = firstMonthSchedule
    ? filterScheduleByRamadanWindows(firstMonthSchedule.schedule, 'ramadan', windows)
    : [];
  const secondRamadanSlice = secondMonthSchedule
    ? filterScheduleByRamadanWindows(secondMonthSchedule.schedule, 'ramadan', windows)
    : [];

  if (firstRamadanSlice.length > 0 || secondRamadanSlice.length > 0) {
    result.push({
      year,
      month: firstRamadanMonth,
      schedule: [...firstRamadanSlice, ...secondRamadanSlice],
      employees: secondMonthSchedule?.employees || firstMonthSchedule?.employees,
      metrics: secondMonthSchedule?.metrics || firstMonthSchedule?.metrics,
    });
  }

  if (secondMonthSchedule) {
    const postRamadanEntries = filterScheduleByRamadanWindows(
      secondMonthSchedule.schedule,
      'post-ramadan',
      windows,
    );
    if (postRamadanEntries.length > 0) {
      result.push({
        year,
        month: secondRamadanMonth,
        schedule: postRamadanEntries,
        employees: secondMonthSchedule.employees,
        metrics: secondMonthSchedule.metrics,
      });
    }
  }

  result.push(...schedules.filter((s) => !(s.year === year && ramMonths.has(s.month))));

  return result;
}

function mergeRamadanSchedules(schedules: Schedule[]): Schedule[] {
  const years = Array.from(new Set(schedules.map((s) => s.year))).sort((a, b) => a - b);
  let out = schedules;
  for (const y of years) {
    const windows = getRamadanPeriodWindows(y);
    if (!windows) continue;
    out = mergeRamadanSchedulesForYear(out, y, windows);
  }
  return out;
}

/** Human-readable period line for PNG/ICS/titles (uses Ramadan override for `year`). */
function formatRamadanPeriodLabel(
  year: number,
  period: string | null | undefined,
  monthNames: string[],
  selectedMonth: number,
  suffix: string = '',
): string {
  const w = getRamadanPeriodWindows(year);
  if (w && period === 'pre-ramadan') {
    return `${monthNames[w['pre-ramadan'].primaryMonth - 1]} ${year} (Pre-Ramadan)${suffix}`;
  }
  if (w && period === 'ramadan') {
    return `Ramadan ${year}${suffix}`;
  }
  if (w && period === 'post-ramadan') {
    return `${monthNames[w['post-ramadan'].primaryMonth - 1]} ${year} (Post-Ramadan)${suffix}`;
  }
  return `${monthNames[selectedMonth - 1]} ${year}${suffix}`;
}

/** Committed month employee report: top-level `employees` or `metrics.employees` (list endpoint omits top-level). */
function getEmployeeRowsFromSchedule(schedule: Schedule | null | undefined): any[] {
  if (!schedule) return [];
  const top = schedule.employees;
  if (Array.isArray(top) && top.length > 0) return top;
  const fromMetrics = schedule.metrics?.employees;
  if (Array.isArray(fromMetrics) && fromMetrics.length > 0) return fromMetrics;
  return [];
}

/**
 * Same name order as the committed ScheduleTable branch: GET /employees order (EmployeeSkills.id),
 * then snapshot-only names from the roster. Not alphabetical.
 */
function buildPreferredScheduleEmployeeOrder(
  employeesFromAPI: any[],
  snapshotRows: any[],
): string[] {
  if (employeesFromAPI.length > 0) {
    if (snapshotRows.length > 0) {
      const apiNames = new Set(employeesFromAPI.map((e: any) => e.employee));
      const order: string[] = employeesFromAPI.map((e: any) => e.employee);
      snapshotRows.forEach((row: any) => {
        if (!apiNames.has(row.employee)) {
          order.push(row.employee);
        }
      });
      return order;
    }
    return employeesFromAPI.map((e: any) => e.employee);
  }
  if (snapshotRows.length > 0) {
    return snapshotRows.map((e: any) => e.employee);
  }
  return [];
}

function orderTableRowsByPreferredEmployees<T extends { employee: string }>(
  rows: T[],
  preferredOrder: string[],
): T[] {
  if (!preferredOrder.length) return rows;
  const byName = new Map(rows.map((r) => [r.employee, r]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const name of preferredOrder) {
    const row = byName.get(name);
    if (row) {
      out.push(row);
      seen.add(name);
    }
  }
  for (const row of rows) {
    if (!seen.has(row.employee)) out.push(row);
  }
  return out;
}

export const AllRostersPage: React.FC = () => {
  const { selectedYear, selectedMonth, setSelectedYear, setSelectedMonth } = useDate();
  // FIX: Use auth guard to prevent API calls until auth is confirmed
  const { isReady: authReady } = useAuthGuard(false); // Requires auth but not manager
  const { user, loading: authLoading } = useAuth(); // Keep for isManager check
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [schedulesLoaded, setSchedulesLoaded] = useState(false); // Track if schedules list is loaded
  const [currentSchedule, setCurrentSchedule] = useState<Schedule | null>(null);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [historyViewTab, setHistoryViewTab] = useState<'all-rosters' | 'overall-analysis'>('all-rosters');
  const [overallViewMode, setOverallViewMode] = useState<OverallViewMode>('grouped-bar');
  const [selectedOverallMetric, setSelectedOverallMetric] = useState<OverallMetricKey>('night');
  const [selectedHeatmapMetrics, setSelectedHeatmapMetrics] = useState<OverallMetricKey[]>(['night']);
  const [overallMaxWarning, setOverallMaxWarning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingSchedule, setLoadingSchedule] = useState(false); // Separate loading state for individual schedule
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [calendarExporting, setCalendarExporting] = useState(false);
  const [calendarExportError, setCalendarExportError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [originalSchedule, setOriginalSchedule] = useState<Schedule | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [employeesFromAPI, setEmployeesFromAPI] = useState<any[]>([]);
  const [leaveTypeCodes, setLeaveTypeCodes] = useState<Set<string>>(new Set());
  /** Shift requests + roster locks for fairness chart “Requested” counts (same sources as Roster Generator). */
  const [fairnessShiftRequests, setFairnessShiftRequests] = useState<any[]>([]);
  const [fairnessRosterLocks, setFairnessRosterLocks] = useState<any[]>([]);
  const [unpublishedSummary, setUnpublishedSummary] = useState<{
    has_unpublished: boolean;
    items: Array<{ year: number; month: number; periods: string[]; has_unpublished: boolean }>;
  }>({ has_unpublished: false, items: [] });
  const scheduleCardRef = useRef<HTMLDivElement>(null);
  const scheduleImageRef = useRef<HTMLDivElement>(null);
  const isManager = user?.employee_type === 'Manager';
  const isStaff = user?.employee_type === 'Staff';

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

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
      if (isManager) {
        const summary = await schedulesAPI.getUnpublishedSummary();
        setUnpublishedSummary(summary);
      } else {
        setUnpublishedSummary({ has_unpublished: false, items: [] });
      }
      
      // FIX: Check if request was cancelled after API call
      if (signal?.aborted) {
        return;
      }

      // Cache Ramadan windows for every configured year so merge/detect work for 2027+ as well as 2026.
      try {
        const ramadanRows = await dataAPI.listRamadanDates();
        for (const r of ramadanRows) {
          if (r.start_date && r.end_date) {
            setRamadanDateOverride(r.year, r.start_date, r.end_date, r.source || undefined);
          }
        }
      } catch {
        /* non-fatal: period labels may be incomplete until user opens that year */
      }

      // Merge calendar months into Pre-Ramadan / Ramadan / Post-Ramadan virtual rows when Ramadan is configured.
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
  }, [isManager]);

  useEffect(() => {
    if (!selectedYear) return;
    let cancelled = false;
    dataAPI.getRamadanDates(selectedYear)
      .then((rec) => {
        if (cancelled) return;
        if (rec.start_date && rec.end_date) {
          setRamadanDateOverride(selectedYear, rec.start_date, rec.end_date, rec.source || undefined);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedYear]);

  const hasUnpublishedForOption = useCallback((year: number, month: number, period?: string | null): boolean => {
    if (!isManager || !unpublishedSummary?.items?.length) return false;
    const match = unpublishedSummary.items.find((i) => i.year === year && i.month === month);
    if (!match) return false;
    if (!period) return true;
    return (match.periods || []).includes(period);
  }, [isManager, unpublishedSummary]);

  const hasUnpublishedForYear = useCallback((year: number): boolean => {
    if (!isManager || !unpublishedSummary?.items?.length) return false;
    return unpublishedSummary.items.some((i) => i.year === year && i.has_unpublished);
  }, [isManager, unpublishedSummary]);

  const currentSelectionHasDraft = useMemo(() => {
    if (!isManager || !selectedYear || !selectedMonth || !currentSchedule) return false;
    const period = selectedPeriod;
    if (period && hasUnpublishedForOption(selectedYear, selectedMonth, period)) return true;
    return (currentSchedule.schedule || []).some((e: any) => e?.is_published === false);
  }, [isManager, selectedYear, selectedMonth, currentSchedule, selectedPeriod, hasUnpublishedForOption]);

  const currentSelectionIsPublished = useMemo(() => {
    if (!isManager || !currentSchedule || !(currentSchedule.schedule || []).length) return false;
    return (currentSchedule.schedule || []).every((e: any) => e?.is_published !== false);
  }, [isManager, currentSchedule]);

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

  const loadLeaveTypesForOverall = useCallback(async () => {
    try {
      const leaveTypes = await leaveTypesAPI.getLeaveTypes(true);
      setLeaveTypeCodes(new Set((leaveTypes || []).map((lt: any) => lt.code).filter(Boolean)));
    } catch (err) {
      console.error('Failed to load leave types for overall analysis:', err);
      setLeaveTypeCodes(new Set());
    }
  }, []);

  const loadFairnessRequestSources = useCallback(async () => {
    // Staff users should not call manager-only endpoints used for fairness overlays.
    if (!isManager) {
      setFairnessShiftRequests([]);
      setFairnessRosterLocks([]);
      return;
    }

    try {
      const shiftReq = await requestsAPI.getAllShiftRequests();
      setFairnessShiftRequests(Array.isArray(shiftReq) ? shiftReq : []);
    } catch (err: any) {
      console.error('Failed to load shift requests for fairness:', err);
      setFairnessShiftRequests([]);
    }
    try {
      const rosterData = await dataAPI.getRosterData();
      const locks = rosterData?.locks;
      setFairnessRosterLocks(Array.isArray(locks) ? locks : []);
    } catch (err: any) {
      console.error('Failed to load roster locks for fairness:', err);
      setFairnessRosterLocks([]);
    }
  }, [isManager]);

  // FIX: Load schedules list ONLY after auth guard confirms we're ready
  // This ensures user is authenticated AND token is valid before making API calls
  // FIX: Add request cancellation on unmount to prevent memory leaks
  useEffect(() => {
    const abortController = new AbortController();
    
    if (authReady) {
      loadSchedules(abortController.signal);
      loadEmployees(); // Load employees to get correct order
      loadFairnessRequestSources();
      loadLeaveTypesForOverall();
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
  }, [authReady, loadSchedules, loadEmployees, loadFairnessRequestSources, loadLeaveTypesForOverall]);

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

      const windows = getRamadanPeriodWindows(year);
      const ramMonths = windows ? ramadanMonthSet(windows) : null;

      // For Ramadan-configured years, load related calendar month(s) and filter to the active period.
      if (windows && ramMonths?.has(month)) {
        const [firstRamadanMonth, secondRamadanMonth] = Array.from(ramMonths).sort((a, b) => a - b);
        const [firstMonthSchedule, secondMonthSchedule] = await Promise.all([
          schedulesAPI.getSchedule(year, firstRamadanMonth).catch(() => null),
          schedulesAPI.getSchedule(year, secondRamadanMonth).catch(() => null),
        ]);

        // Find ALL schedules in our merged list with this year/month (there might be multiple: pre-ramadan and ramadan both have month=2)
        const schedulesInList = schedules.filter((s) => s.year === year && s.month === month);
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
        let detectedPeriod = period as RamadanPeriodId | null | undefined;
        let scheduleInList = schedulesInList[0];

        // If period is provided, find the schedule matching that period
        if (period && schedulesInList.length > 1) {
          const periodSchedule = schedulesInList.find((s) => detectPeriod(s) === period);
          if (periodSchedule) {
            scheduleInList = periodSchedule;
            detectedPeriod = period as RamadanPeriodId;
          } else {
            detectedPeriod = detectPeriod(scheduleInList);
          }
        } else {
          // Detect period for the schedule
          detectedPeriod = detectPeriod(scheduleInList);

          // If we have multiple schedules with the same month and no period specified, prefer ramadan if it exists
          if (schedulesInList.length > 1 && !period) {
            const ramadanSchedule = schedulesInList.find((s) => detectPeriod(s) === 'ramadan');
            if (ramadanSchedule) {
              scheduleInList = ramadanSchedule;
              detectedPeriod = 'ramadan';
            }
          }
        }

        if (
          windows &&
          detectedPeriod &&
          (detectedPeriod === 'pre-ramadan' || detectedPeriod === 'ramadan' || detectedPeriod === 'post-ramadan')
        ) {
          let filteredSchedule: Schedule;

          if (detectedPeriod === 'ramadan') {
            const firstEntries = firstMonthSchedule
              ? filterScheduleByRamadanWindows(firstMonthSchedule.schedule, 'ramadan', windows)
              : [];
            const secondEntries = secondMonthSchedule
              ? filterScheduleByRamadanWindows(secondMonthSchedule.schedule, 'ramadan', windows)
              : [];
            // Keep employee/metrics source aligned with the month currently selected in the UI.
            // This prevents stale P/O values when saving a Ramadan slice anchored to one month.
            const selectedMonthSchedule =
              month === firstRamadanMonth ? firstMonthSchedule : secondMonthSchedule;
            const fallbackMonthSchedule =
              month === firstRamadanMonth ? secondMonthSchedule : firstMonthSchedule;
            filteredSchedule = {
              year,
              month: firstRamadanMonth,
              schedule: [...firstEntries, ...secondEntries],
              employees: selectedMonthSchedule?.employees || fallbackMonthSchedule?.employees,
              metrics: selectedMonthSchedule?.metrics || fallbackMonthSchedule?.metrics,
            };
          } else if (detectedPeriod === 'pre-ramadan') {
            if (!firstMonthSchedule) {
              throw new Error('Pre-ramadan schedule not found');
            }
            filteredSchedule = {
              ...firstMonthSchedule,
              schedule: filterScheduleByRamadanWindows(firstMonthSchedule.schedule, 'pre-ramadan', windows),
            };
          } else if (detectedPeriod === 'post-ramadan') {
            if (!secondMonthSchedule) {
              throw new Error('Post-ramadan schedule not found');
            }
            filteredSchedule = {
              ...secondMonthSchedule,
              schedule: filterScheduleByRamadanWindows(secondMonthSchedule.schedule, 'post-ramadan', windows),
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

  // Detect period from schedule date range (uses Ramadan DB override for that schedule's year).
  const detectPeriod = (schedule: Schedule): RamadanPeriodId | null => {
    const windows = getRamadanPeriodWindows(schedule.year);
    if (!windows || !schedule?.schedule?.length) return null;
    const monthsSet = ramadanMonthSet(windows);
    if (!monthsSet.has(schedule.month)) return null;
    return detectRamadanPeriodForSchedule(schedule, windows);
  };

  // Get available years (only committed ones)
  const availableYears = Array.from(new Set(schedules.map(s => s.year))).sort();
  
  // Get available month options for the selected year.
  const availableMonthOptions = useMemo(() => {
    if (!selectedYear) return [];
    
    const yearSchedules = schedules.filter(s => s.year === selectedYear);
    if (yearSchedules.length === 0) return [];
    
    const periodOptions: Array<{ value: string; label: string; month: number; period: string | null }> = [];
    const regularOptions: Array<{ value: string; label: string; month: number; period: string | null }> = [];
    const processedMonths = new Set<number>();
    
    const ramadanWindowsForYear = getRamadanPeriodWindows(selectedYear);

    // Special handling for Ramadan months - show period-specific options FIRST
    if (ramadanWindowsForYear) {
      const ramMonths = ramadanMonthSet(ramadanWindowsForYear);
      const [firstRamadanMonth, secondRamadanMonth] = Array.from(ramMonths).sort((a, b) => a - b);
      const hasPreRamadan = yearSchedules.some((s) => detectPeriod(s) === 'pre-ramadan');
      if (hasPreRamadan) {
        periodOptions.push({
          value: `${firstRamadanMonth}-pre`,
          label: `${monthNames[firstRamadanMonth - 1]} (Pre-Ramadan)`,
          month: firstRamadanMonth,
          period: 'pre-ramadan',
        });
        processedMonths.add(firstRamadanMonth);
      }

      const hasRamadan = yearSchedules.some((s) => detectPeriod(s) === 'ramadan');
      if (hasRamadan) {
        periodOptions.push({
          value: `${firstRamadanMonth}-ramadan`,
          label: 'Ramadan',
          month: firstRamadanMonth,
          period: 'ramadan',
        });
        processedMonths.add(firstRamadanMonth);
        processedMonths.add(secondRamadanMonth);
      }

      const hasPostRamadan = yearSchedules.some((s) => detectPeriod(s) === 'post-ramadan');
      if (hasPostRamadan) {
        periodOptions.push({
          value: `${secondRamadanMonth}-post`,
          label: `${monthNames[secondRamadanMonth - 1]} (Post-Ramadan)`,
          month: secondRamadanMonth,
          period: 'post-ramadan',
        });
        processedMonths.add(secondRamadanMonth);
      }

      periodOptions.sort((a, b) => {
        const periodOrder: { [key: string]: number } = { 'pre-ramadan': 1, ramadan: 2, 'post-ramadan': 3 };
        return (periodOrder[a.period || ''] || 0) - (periodOrder[b.period || ''] || 0);
      });
    }

    // Add all other months that have committed schedules.
    const allMonths = Array.from(new Set(yearSchedules.map((s) => s.month))).sort();
    const ramadanMonthsForFilter = ramadanWindowsForYear ? ramadanMonthSet(ramadanWindowsForYear) : null;
    allMonths.forEach((month) => {
      if (!processedMonths.has(month)) {
        if (ramadanMonthsForFilter?.has(month)) {
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

    if (!ramadanWindowsForYear) {
      const combined = [...periodOptions, ...regularOptions];
      combined.sort((a, b) => a.month - b.month);
      return combined;
    }
    const getStartKey = (opt: {
      month: number;
      period: string | null;
    }): string => {
      if (opt.period === 'pre-ramadan') return ramadanWindowsForYear['pre-ramadan'].from;
      if (opt.period === 'ramadan') return ramadanWindowsForYear.ramadan.from;
      if (opt.period === 'post-ramadan') return ramadanWindowsForYear['post-ramadan'].from;
      return `${selectedYear}-${String(opt.month).padStart(2, '0')}-01`;
    };

    const combined = [...periodOptions, ...regularOptions];
    combined.sort((a, b) => getStartKey(a).localeCompare(getStartKey(b)));
    return combined;
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

    // Clone ScheduleTable root so capture never mutates visible UI
    const sourceRootDiv = container.firstElementChild as HTMLElement;
    if (!sourceRootDiv) return null;
    const rootDiv = sourceRootDiv.cloneNode(true) as HTMLElement;

    // Store original states to restore later
    const buttonsToHide: HTMLElement[] = [];
    const inputsToHide: HTMLElement[] = [];
    const originalOverflows: Map<HTMLElement, string> = new Map();
    const originalWidths: Map<HTMLElement, string> = new Map();
    let displayLegendSection: HTMLElement | null = null;
    let displayLegendDisplayPrev = '';

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
        padding: 16px 20px 20px;
        font-family: system-ui, -apple-system, sans-serif;
        width: max-content;
        max-width: none;
        position: fixed;
        left: 0;
        top: 0;
        pointer-events: none;
        z-index: -1;
      `;
      document.body.appendChild(wrapper);

      const periodSubtitle = formatRamadanPeriodLabel(
        selectedYear,
        currentPeriod,
        monthNames,
        selectedMonth,
      );

      const title = document.createElement('h2');
      title.textContent = `PHARMACY DEPARTMENT DUTY ROSTER ${selectedYear}`;
      title.style.cssText =
        'font-size: 16px; font-weight: bold; color: #111827; margin: 0 0 4px 0; text-align: center; letter-spacing: 0.02em;';

      const subtitle = document.createElement('div');
      subtitle.textContent = periodSubtitle;
      subtitle.style.cssText =
        'font-size: 13px; font-weight: 600; color: #4b5563; margin: 0 0 10px 0; text-align: center;';

      wrapper.appendChild(title);
      wrapper.appendChild(subtitle);

      // Render cloned table inside off-screen wrapper
      wrapper.appendChild(rootDiv);

      // Omit "Display" (Weekend / Totals) from exported image only
      displayLegendSection = rootDiv.querySelector('[data-legend-section="display"]') as HTMLElement | null;
      if (displayLegendSection) {
        displayLegendDisplayPrev = displayLegendSection.style.display;
        displayLegendSection.style.display = 'none';
      }

      const footer = document.createElement('div');
      footer.textContent =
        'NB: DUTY ROSTER COULD BE CHANGED ACCORDING TO PHARMACY NEEDS';
      footer.style.cssText =
        'font-size: 11px; font-weight: 700; color: #374151; margin: 10px 0 0 0; text-align: center; line-height: 1.35;';
      wrapper.appendChild(footer);

      // Wait for layout to settle and table to expand
      await new Promise(resolve => setTimeout(resolve, 500));

      // Constrain legend width to match table width
      const legendDiv = rootDiv.querySelector('[data-schedule-legend]') as HTMLElement;
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

      if (displayLegendSection) {
        displayLegendSection.style.display = displayLegendDisplayPrev;
        displayLegendSection = null;
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

      if (displayLegendSection) {
        displayLegendSection.style.display = displayLegendDisplayPrev;
        displayLegendSection = null;
      }

      // Restore original states on error
      buttonsToHide.forEach(btn => btn.style.display = '');
      inputsToHide.forEach(input => input.style.display = '');
      originalOverflows.forEach((value, el) => el.style.overflow = value || '');
      originalWidths.forEach((value, el) => el.style.width = value || '');
      
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
      
      // View page shows title; pass return path so Close returns to this app screen
      const returnPath = `${window.location.pathname}${window.location.search}`;
      const viewUrl = `${window.location.origin}/view-schedule.html?year=${selectedYear}&month=${selectedMonth}&return=${encodeURIComponent(returnPath)}`;
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

  const handlePendingOffChange = (employee: string, value: number, userId?: number) => {
    if (typeof userId !== 'number' || Number.isNaN(userId)) return;
    setCurrentSchedule((prev) => {
      if (!prev) return prev;
      const updateRows = (rows: any[] | undefined) =>
        (rows || []).map((row: any) => {
          const raw = row?.user_id;
          const uid =
            raw !== null && raw !== undefined && raw !== ''
              ? (typeof raw === 'number' ? raw : Number(raw))
              : null;
          if (uid === null || Number.isNaN(uid) || uid !== userId) return row;
          return { ...row, pending_off: value };
        });
      return {
        ...prev,
        employees: updateRows(prev.employees),
        metrics: {
          ...(prev.metrics || {}),
          employees: updateRows(prev.metrics?.employees),
        },
      };
    });
    setHasUnsavedChanges(true);
    setSaveSuccess(false);
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
        getEmployeeRowsFromSchedule(currentSchedule),
        currentPeriod,
      );
      // Reload the schedule to get the updated version
      await loadSchedule(selectedYear, selectedMonth, currentPeriod);
      
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

  const handlePublishSchedule = async () => {
    if (!isManager || !selectedYear || !selectedMonth) return;
    try {
      setSaving(true);
      await schedulesAPI.publishSchedule(selectedYear, selectedMonth, currentPeriod);
      await loadSchedules();
      await loadSchedule(selectedYear, selectedMonth, currentPeriod);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to publish schedule');
    } finally {
      setSaving(false);
    }
  };

  const handleUnpublishSchedule = async () => {
    if (!isManager || !selectedYear || !selectedMonth) return;
    try {
      setSaving(true);
      await schedulesAPI.unpublishSchedule(selectedYear, selectedMonth, currentPeriod);
      await loadSchedules();
      await loadSchedule(selectedYear, selectedMonth, currentPeriod);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to unpublish schedule');
    } finally {
      setSaving(false);
    }
  };

  // Schedule entries for the current view. For single-month schedules filter by selected year/month.
  // For period schedules that span two months (e.g. Ramadan Feb 19–Mar 18), use the full schedule
  // so fairness analysis and metrics count all entries correctly (same as Roster Generator).
  const getMonthSchedule = () => {
    if (!currentSchedule || !selectedYear || !selectedMonth) return [];
    const schedule = currentSchedule.schedule || [];
    if (schedule.length === 0) return [];
    const monthsInSchedule = new Set(
      schedule.map((e: any) => {
        const d = new Date(e.date);
        return d.getFullYear() * 12 + d.getMonth();
      })
    );
    if (monthsInSchedule.size > 1) {
      return schedule;
    }
    return schedule.filter((entry: any) => {
      const date = new Date(entry.date);
      return date.getFullYear() === selectedYear && date.getMonth() + 1 === selectedMonth;
    });
  };

  const monthSchedule = getMonthSchedule();

  const fairnessRelevantDates = useMemo(() => {
    const s = new Set<string>();
    monthSchedule.forEach((e: any) => {
      if (e?.date) s.add(String(e.date).split('T')[0]);
    });
    return s;
  }, [monthSchedule]);

  const handleDownloadMyCalendar = async () => {
    if (!user?.employee_name || !selectedYear || !selectedMonth) return;
    setCalendarExporting(true);
    setCalendarExportError(null);
    try {
      const [shiftTypes, leaveTypes] = await Promise.all([
        shiftTypesAPI.getShiftTypes(true),
        leaveTypesAPI.getLeaveTypes(true),
      ]);
      const workingShiftCodes = new Set(
        shiftTypes.filter((st) => st.is_working_shift).map((st) => st.code),
      );
      const leaveCodes = new Set(leaveTypes.map((lt) => lt.code));
      const scheduleTitle = formatRamadanPeriodLabel(
        selectedYear,
        currentPeriod,
        monthNames,
        selectedMonth,
      );
      const { ics, eventCount } = buildMyWorkingShiftsIcs({
        entries: monthSchedule as { employee: string; date: string; shift: string }[],
        employeeName: user.employee_name,
        workingShiftCodes,
        leaveCodes,
        calendarTitle: `My shifts — ${scheduleTitle}`,
      });
      if (eventCount === 0) {
        setCalendarExportError(
          'No working shifts in this period for your name on the roster.',
        );
        return;
      }
      const blob = new Blob(['\ufeff', ics], {
        type: 'text/calendar;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const safePeriod = (currentPeriod || `m${selectedMonth}`).replace(/[^a-z0-9]+/gi, '-');
      link.download = `my-roster-${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${safePeriod}.ics`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to build calendar file.';
      setCalendarExportError(msg);
    } finally {
      setCalendarExporting(false);
    }
  };

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
    const rows = getEmployeeRowsFromSchedule(currentSchedule);
    if (rows.length > 0) {
      return rows.map((emp: any) => emp.employee);
    }
    return undefined;
  }, [employeesFromAPI, currentSchedule]);

  /** Stable row order for ScheduleTable: API + snapshot-only rows (matches non-edit branch). Uses original snapshot so edits don’t reshuffle. */
  const preferredScheduleEmployeeOrder = useMemo(
    () =>
      buildPreferredScheduleEmployeeOrder(
        employeesFromAPI,
        getEmployeeRowsFromSchedule(originalSchedule),
      ),
    [employeesFromAPI, originalSchedule],
  );

  const fairnessData: FairnessData | null = useMemo(() => {
    if (!monthSchedule.length) return null;
    return calculateFairnessData(monthSchedule, employeeOrder);
  }, [monthSchedule, employeeOrder]);
  
  // Calculate dynamic pending_off values from current schedule state
  const dynamicEmployees: PendingOffData[] | null = useMemo(() => {
    const origRows = getEmployeeRowsFromSchedule(originalSchedule);
    if (!monthSchedule.length || !originalSchedule || origRows.length === 0) return null;
    if (!selectedYear || !selectedMonth) return null;
    
    const pendingWindow = getPendingOffWindow(selectedYear, selectedMonth, currentPeriod);
    const originalScheduleEntries = filterEntriesToPendingWindow(
      originalSchedule.schedule || [],
      selectedYear,
      selectedMonth,
      currentPeriod,
    );

    const originalCalculated = calculatePendingOff(
      originalScheduleEntries,
      {},
      {},
      selectedYear,
      selectedMonth,
      pendingWindow,
    );
    const originalEmployeesMap = new Map(origRows.map((e: any) => [e.employee, e]));
    
    // Reverse-calculate initial pending_off for each employee:
    // final = initial + weekend_days + N_credit - O_count
    const initialPendingOff: Record<string, number> = {};
    
    originalCalculated.forEach(calc => {
      const original = originalEmployeesMap.get(calc.employee);
      if (original) {
        const finalPendingOff = original.pending_off || 0;
        const addedThisMonth =
          calc.weekend_days_in_month + calc.night_shifts - calc.Os_given;
        // Initial = Final - Added
        initialPendingOff[calc.employee] = Math.max(0, finalPendingOff - addedThisMonth);
      } else {
        // Employee not in original, use 0 as initial
        initialPendingOff[calc.employee] = 0;
      }
    });
    
    // For any employees in the original employees list but not in the calculated list,
    // use their pending_off as the initial (they may not have had shifts in original schedule)
    origRows.forEach((emp: any) => {
      if (!(emp.employee in initialPendingOff)) {
        initialPendingOff[emp.employee] = emp.pending_off || 0;
      }
    });
    
    const entriesForPending = filterEntriesToPendingWindow(
      monthSchedule,
      selectedYear,
      selectedMonth,
      currentPeriod,
    );
    const recalculated = calculatePendingOff(
      entriesForPending,
      initialPendingOff,
      {},
      selectedYear,
      selectedMonth,
      pendingWindow,
    );
    const skillsByName = new Map(
      employeesFromAPI.map((emp: any) => [
        emp.employee,
        [
          emp.skill_M, emp.skill_IP, emp.skill_A, emp.skill_N, emp.skill_M3, emp.skill_M4,
          emp.skill_H, emp.skill_CL, emp.skill_E, emp.skill_MS, emp.skill_IP_P, emp.skill_P, emp.skill_M_P,
        ],
      ]),
    );
    return recalculated.map((entry) => {
      const flags = skillsByName.get(entry.employee) || [];
      const isSingleSkill = flags.filter(Boolean).length === 1;
      if (!isSingleSkill) return entry;
      return {
        ...entry,
        pending_off: initialPendingOff[entry.employee] ?? entry.pending_off,
      };
    });
  }, [monthSchedule, originalSchedule, selectedYear, selectedMonth, currentPeriod, employeesFromAPI]);

  // True only when actual schedule assignments changed (not just manual pending_off overrides).
  const scheduleAssignmentsChanged = useMemo(() => {
    if (!currentSchedule || !originalSchedule) return false;
    const normalize = (rows: any[] | undefined) =>
      (rows || [])
        .map((entry: any) => {
          const datePart = String(entry?.date || '').split('T')[0];
          return `${String(entry?.employee || '').trim()}|${datePart}|${String(entry?.shift || '').trim()}`;
        })
        .sort();
    const now = normalize(currentSchedule.schedule);
    const orig = normalize(originalSchedule.schedule);
    if (now.length !== orig.length) return true;
    for (let i = 0; i < now.length; i += 1) {
      if (now[i] !== orig[i]) return true;
    }
    return false;
  }, [currentSchedule, originalSchedule]);

  // Employees whose assignment rows changed (row-level diff: employee/date/shift).
  const employeesWithShiftChanges = useMemo(() => {
    const changed = new Set<string>();
    if (!currentSchedule || !originalSchedule) return changed;

    const toEmployeeDayShift = (rows: any[] | undefined) =>
      (rows || []).map((entry: any) => ({
        employee: String(entry?.employee || '').trim(),
        date: String(entry?.date || '').split('T')[0],
        shift: String(entry?.shift || '').trim(),
      }));

    const nowRows = toEmployeeDayShift(currentSchedule.schedule);
    const origRows = toEmployeeDayShift(originalSchedule.schedule);

    const nowByKey = new Map<string, string>();
    nowRows.forEach((r) => nowByKey.set(`${r.employee}|${r.date}`, r.shift));
    const origByKey = new Map<string, string>();
    origRows.forEach((r) => origByKey.set(`${r.employee}|${r.date}`, r.shift));

    const allKeys = new Set<string>([
      ...Array.from(nowByKey.keys()),
      ...Array.from(origByKey.keys()),
    ]);
    allKeys.forEach((key) => {
      if (nowByKey.get(key) !== origByKey.get(key)) {
        const employee = key.split('|')[0];
        if (employee) changed.add(employee);
      }
    });

    return changed;
  }, [currentSchedule, originalSchedule]);

  /**
   * P/O column: only values from this viewed month’s committed snapshot (`employees` or `metrics.employees`).
   * Never spread GET /employees rows — that leaks global pending_off when the snapshot lives under metrics only.
   */
  const scheduleEmployeesForTable = useMemo(() => {
    const committedRows = getEmployeeRowsFromSchedule(currentSchedule);
    const poByName = new Map<string, number | null | undefined>(
      committedRows.map((e: any) => [e.employee, e.pending_off]),
    );
    const poByUserId = new Map<number, number | null | undefined>();
    committedRows.forEach((e: any) => {
      const raw = e.user_id;
      if (raw === null || raw === undefined || raw === '') return;
      const uid = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isNaN(uid)) poByUserId.set(uid, e.pending_off);
    });
    const hasSnapshot = committedRows.length > 0;
    const apiNames = new Set(employeesFromAPI.map((e: any) => e.employee));

    if (employeesFromAPI.length > 0) {
      if (hasSnapshot) {
        const rows: { employee: string; pending_off?: number | null; user_id?: number }[] =
          employeesFromAPI.map((emp: any) => {
            const uid =
              emp.user_id !== null && emp.user_id !== undefined && emp.user_id !== ''
                ? typeof emp.user_id === 'number'
                  ? emp.user_id
                  : Number(emp.user_id)
                : null;
            let pending_off: number | null | undefined;
            if (uid !== null && !Number.isNaN(uid) && poByUserId.has(uid)) {
              pending_off = poByUserId.get(uid);
            } else if (poByName.has(emp.employee)) {
              pending_off = poByName.get(emp.employee);
            } else {
              pending_off = undefined;
            }
            return { employee: emp.employee, pending_off, user_id: emp.user_id };
          });
        committedRows.forEach((row: any) => {
          const raw = row.user_id;
          const uid =
            raw !== null && raw !== undefined && raw !== ''
              ? typeof raw === 'number'
                ? raw
                : Number(raw)
              : null;
          const matchedById =
            uid !== null &&
            !Number.isNaN(uid) &&
            employeesFromAPI.some((e: any) => {
              const eu = e.user_id;
              if (eu === null || eu === undefined || eu === '') return false;
              const n = typeof eu === 'number' ? eu : Number(eu);
              return !Number.isNaN(n) && n === uid;
            });
          if (!matchedById && !apiNames.has(row.employee)) {
            rows.push({
              employee: row.employee,
              pending_off: row.pending_off,
              user_id: row.user_id,
            });
          }
        });
        const baseRows = rows;
        if (scheduleAssignmentsChanged && dynamicEmployees && dynamicEmployees.length > 0) {
          const dynamicByEmployee = new Map<string, number | null | undefined>(
            dynamicEmployees.map((e: PendingOffData) => [e.employee, e.pending_off]),
          );
          const blendedRows = baseRows.map((row) =>
            employeesWithShiftChanges.has(row.employee) && dynamicByEmployee.has(row.employee)
              ? { ...row, pending_off: dynamicByEmployee.get(row.employee) }
              : row,
          );
          return orderTableRowsByPreferredEmployees(blendedRows, preferredScheduleEmployeeOrder);
        }
        return baseRows;
      }
      return employeesFromAPI.map((emp: any) => ({ employee: emp.employee }));
    }
    if (hasSnapshot) {
      return committedRows;
    }
    return [];
  }, [
    scheduleAssignmentsChanged,
    employeesWithShiftChanges,
    dynamicEmployees,
    employeesFromAPI,
    currentSchedule,
    preferredScheduleEmployeeOrder,
  ]);
  
  const metrics = calculateMetrics();

  // Determine which tabs to show based on available data
  const availableTabs = useMemo(() => {
    const allTabs = [
      { id: 'overview', emoji: '', label: 'Overview' },
      { id: 'fairness', emoji: '', label: 'Fairness Analysis' },
      { id: 'pending-off', emoji: '', label: 'Staff pending off' },
      { id: 'solver', emoji: '', label: 'Solver Metrics' },
    ] as const;
    
    if (!currentSchedule) return allTabs;
    
    // Filter out tabs based on data availability
    return allTabs.filter(tab => {
      if (tab.id === 'pending-off') {
        const rows = getEmployeeRowsFromSchedule(currentSchedule);
        return rows.some(
          (emp: any) => emp.pending_off !== undefined && emp.pending_off !== null,
        );
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

  const recentPublishedSchedules = useMemo(() => {
    const sorted = [...schedules]
      .filter((s) => Array.isArray(s.schedule) && s.schedule.length > 0)
      .sort((a, b) => {
        const aMax = Math.max(...(a.schedule || []).map((e: any) => new Date(e.date).getTime()));
        const bMax = Math.max(...(b.schedule || []).map((e: any) => new Date(e.date).getTime()));
        return bMax - aMax;
      });
    return sorted.slice(0, 3);
  }, [schedules]);

  const overallPeriodsInViewOrder = useMemo(
    () => [...recentPublishedSchedules].reverse(),
    [recentPublishedSchedules],
  );

  const overallEmployeeList = useMemo(() => {
    const fromApi = (employeesFromAPI || []).map((e: any) => e.employee).filter(Boolean);
    if (fromApi.length > 0) return fromApi;
    const set = new Set<string>();
    recentPublishedSchedules.forEach((sch) => {
      getEmployeeRowsFromSchedule(sch).forEach((row: any) => {
        if (row?.employee) set.add(row.employee);
      });
      (sch.schedule || []).forEach((entry: any) => {
        if (entry?.employee) set.add(entry.employee);
      });
    });
    return Array.from(set);
  }, [employeesFromAPI, recentPublishedSchedules]);

  const [selectedOverallEmployees, setSelectedOverallEmployees] = useState<string[]>([]);
  useEffect(() => {
    setSelectedOverallEmployees((prev) => {
      if (overallEmployeeList.length === 0) return [];
      const allowed = new Set(overallEmployeeList);
      return prev.filter((name) => allowed.has(name));
    });
  }, [overallEmployeeList]);

  const overallPeriodLabels = useMemo(
    () =>
      overallPeriodsInViewOrder.map((s) => {
        const period = detectPeriod(s);
        return formatRamadanPeriodLabel(s.year, period, monthNames, s.month);
      }),
    [overallPeriodsInViewOrder],
  );

  const overallPeriodMonthAbbr = useMemo(
    () =>
      overallPeriodsInViewOrder.map((s) => {
        const first = (s.schedule || [])[0];
        if (!first?.date) return monthNames[s.month - 1].slice(0, 3);
        return monthNames[new Date(first.date).getMonth()].slice(0, 3);
      }),
    [overallPeriodsInViewOrder, monthNames],
  );

  const overallMetricsByPeriod = useMemo(() => {
    return overallPeriodsInViewOrder.map((schedule) => {
      const byEmployee = new Map<string, Record<OverallMetricKey, number>>();
      overallEmployeeList.forEach((employee) => {
        byEmployee.set(employee, {
          night: 0,
          m4: 0,
          afternoon: 0,
          thursday: 0,
          weekend: 0,
          ipCombined: 0,
          mainCombined: 0,
          oShift: 0,
          leaveRequested: 0,
        });
      });

      (schedule.schedule || []).forEach((entry: any) => {
        const employee = entry?.employee;
        if (!employee || !byEmployee.has(employee)) return;
        const date = new Date(entry.date);
        const day = date.getDay();
        const shift = String(entry.shift || '').trim();
        const row = byEmployee.get(employee)!;

        if (metricMatchesShift('night', shift, leaveTypeCodes)) row.night += 1;
        if (metricMatchesShift('m4', shift, leaveTypeCodes)) row.m4 += 1;
        if (metricMatchesShift('afternoon', shift, leaveTypeCodes)) row.afternoon += 1;
        if (metricMatchesShift('ipCombined', shift, leaveTypeCodes)) row.ipCombined += 1;
        if (metricMatchesShift('mainCombined', shift, leaveTypeCodes)) row.mainCombined += 1;
        if (metricMatchesShift('oShift', shift, leaveTypeCodes)) row.oShift += 1;
        if (metricMatchesShift('leaveRequested', shift, leaveTypeCodes)) row.leaveRequested += 1;
        if (day === 4 && THURSDAY_FAIRNESS_SHIFTS.has(shift)) row.thursday += 1;
        if ((day === 5 || day === 6) && WEEKEND_FAIRNESS_SHIFTS.has(shift)) row.weekend += 1;
      });

      return byEmployee;
    });
  }, [overallPeriodsInViewOrder, overallEmployeeList, leaveTypeCodes]);

  const visibleOverallEmployees = useMemo(() => {
    if (selectedOverallEmployees.length === 0) return [];
    return overallEmployeeList.filter((e) => selectedOverallEmployees.includes(e));
  }, [overallEmployeeList, selectedOverallEmployees]);

  const groupedBarAxisMax = useMemo(() => {
    let maxValue = 0;
    overallPeriodsInViewOrder.forEach((_, periodIdx) => {
      visibleOverallEmployees.forEach((employee) => {
        const value = overallMetricsByPeriod[periodIdx]?.get(employee)?.[selectedOverallMetric] || 0;
        if (value > maxValue) maxValue = value;
      });
    });
    return maxValue + 1;
  }, [overallPeriodsInViewOrder, visibleOverallEmployees, overallMetricsByPeriod, selectedOverallMetric]);

  const toggleHeatmapMetric = (metric: OverallMetricKey) => {
    setSelectedHeatmapMetrics((prev) => {
      if (prev.includes(metric)) {
        if (prev.length === 1) return prev;
        return prev.filter((m) => m !== metric);
      }
      if (prev.length >= 5) {
        setOverallMaxWarning(true);
        return prev;
      }
      return [...prev, metric];
    });
  };

  useEffect(() => {
    if (!overallMaxWarning) return;
    const timer = window.setTimeout(() => setOverallMaxWarning(false), 1500);
    return () => window.clearTimeout(timer);
  }, [overallMaxWarning]);

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
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Roster History</h2>
      <div className="mb-6 border-b border-gray-200">
        <div className="flex gap-2">
          {[
            { id: 'all-rosters' as const, label: 'All Rosters' },
            { id: 'overall-analysis' as const, label: 'Overall Analysis' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setHistoryViewTab(tab.id)}
              className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
                historyViewTab === tab.id
                  ? 'border-b-2 border-primary-500 text-primary-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {historyViewTab === 'all-rosters' && (schedules.length === 0 ? (
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
                    <option key={year} value={year}>
                      {hasUnpublishedForYear(year) ? `${year} •` : year}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Select Month</label>
                <select
                  value={(() => {
                    if (!selectedYear || !selectedMonth) return '';
                    const rwSelect = getRamadanPeriodWindows(selectedYear);
                    if (rwSelect && selectedPeriod) {
                      const [firstRamadanMonth, secondRamadanMonth] = Array.from(ramadanMonthSet(rwSelect)).sort(
                        (a, b) => a - b,
                      );
                      if (selectedPeriod === 'pre-ramadan' && selectedMonth === firstRamadanMonth)
                        return `${firstRamadanMonth}-pre`;
                      if (selectedPeriod === 'ramadan' && selectedMonth === firstRamadanMonth)
                        return `${firstRamadanMonth}-ramadan`;
                      if (selectedPeriod === 'post-ramadan' && selectedMonth === secondRamadanMonth)
                        return `${secondRamadanMonth}-post`;
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
                    
                    if (selectedYear != null && getRamadanPeriodWindows(selectedYear) && value.includes('-')) {
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
                      {selectedYear && hasUnpublishedForOption(selectedYear, option.month, option.period) ? `${option.label} •` : option.label}
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
                      {formatRamadanPeriodLabel(
                        selectedYear,
                        currentPeriod,
                        monthNames,
                        selectedMonth,
                        ' Schedule',
                      )}
                    </h3>
                    {isManager && (
                      saveSuccess ? (
                        <span className="text-sm text-green-600 font-medium">Changes saved successfully</span>
                      ) : (
                        <span className="text-sm text-gray-500 italic">Click any cell to edit</span>
                      )
                    )}
                    {isManager && (currentSelectionHasDraft || hasUnsavedChanges) && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {!hasUnsavedChanges && currentSelectionHasDraft && (
                          <span className="text-sm text-amber-600 font-medium">Draft (unpublished)</span>
                        )}
                        {hasUnsavedChanges && (
                          <span className="text-sm text-amber-600 font-medium">Unsaved changes</span>
                        )}
                      </div>
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
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          onClick={handleViewImage}
                          disabled={viewing || downloading || calendarExporting}
                          className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors hover:bg-blue-700 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                          {viewing ? 'Preparing...' : 'View'}
                        </button>
                        <button
                          onClick={handleDownloadImage}
                          disabled={viewing || downloading || calendarExporting}
                          className="px-4 py-2 bg-red-600 text-white font-bold rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors hover:bg-red-700 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                          {downloading ? 'Preparing...' : 'Download'}
                        </button>
                        {isStaff && (
                          <button
                            type="button"
                            onClick={handleDownloadMyCalendar}
                            disabled={
                              calendarExporting ||
                              viewing ||
                              downloading ||
                              !monthSchedule.length
                            }
                            className="px-4 py-2 bg-emerald-600 text-white font-semibold rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors hover:bg-emerald-700 disabled:opacity-70 disabled:cursor-not-allowed"
                          >
                            {calendarExporting ? 'Preparing...' : 'Add to my calendar'}
                          </button>
                        )}
                        {isManager && !hasUnsavedChanges && currentSelectionHasDraft && (
                          <button
                            type="button"
                            onClick={handlePublishSchedule}
                            disabled={saving}
                            className="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors hover:bg-green-700 disabled:opacity-70 disabled:cursor-not-allowed"
                          >
                            {saving ? 'Publishing...' : 'Publish'}
                          </button>
                        )}
                        {isManager && !hasUnsavedChanges && !currentSelectionHasDraft && currentSelectionIsPublished && (
                          <button
                            type="button"
                            onClick={handleUnpublishSchedule}
                            disabled={saving}
                            className="px-4 py-2 bg-gray-500 text-white font-semibold rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors hover:bg-gray-600 disabled:opacity-70 disabled:cursor-not-allowed"
                          >
                            {saving ? 'Unpublishing...' : 'Unpublish'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {downloadError && (
                  <p className="mb-3 text-sm text-red-600">{downloadError}</p>
                )}
                {calendarExportError && (
                  <p className="mb-3 text-sm text-red-600">{calendarExportError}</p>
                )}
                <div ref={scheduleImageRef} style={{ overflow: 'visible' }}>
                  <ScheduleTable
                    schedule={currentSchedule.schedule}
                    year={selectedYear}
                    month={selectedMonth}
                    employees={scheduleEmployeesForTable}
                    editable={isManager}
                    canChangeColors={isManager}
                    onScheduleChange={handleScheduleChange}
                    selectedPeriod={currentPeriod}
                    pendingOffEditable={isManager}
                    onPendingOffChange={handlePendingOffChange}
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
                            <p className="text-sm text-gray-600">Staff</p>
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
                          shiftRequests={fairnessShiftRequests}
                          rosterLocks={fairnessRosterLocks}
                          relevantDates={fairnessRelevantDates}
                        />
                      </div>
                    )}

                    {/* Staff pending off tab */}
                    {activeTab === 'pending-off' && (
                      <div className="space-y-6">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">Staff pending off</h3>
                        </div>
                        
                        {(() => {
                          const displayEmployees = scheduleEmployeesForTable.filter(
                            (e: any) => e.pending_off !== undefined && e.pending_off !== null,
                          );
                          
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
                                        hovertemplate: '%{x}: %{y}<extra></extra>',
                                      }]}
                                      layout={{
                                        xaxis: { title: 'Staff' },
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
      ))}

      {historyViewTab === 'overall-analysis' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'grouped-bar' as const, label: 'Bars' },
              { id: 'line-trend' as const, label: 'Lines' },
              { id: 'heatmap' as const, label: 'Heatmap' },
            ].map((view) => (
              <button
                key={view.id}
                onClick={() => setOverallViewMode(view.id)}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  overallViewMode === view.id
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-300 bg-transparent text-gray-600 hover:border-gray-400'
                }`}
              >
                {view.label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Metric:</p>
            <div className="flex flex-wrap items-center gap-2">
              {OVERALL_METRICS.map((metric) => {
                const isActive =
                  overallViewMode === 'heatmap'
                    ? selectedHeatmapMetrics.includes(metric.key)
                    : selectedOverallMetric === metric.key;
                return (
                  <button
                    key={metric.key}
                    onClick={() => {
                      if (overallViewMode === 'heatmap') {
                        toggleHeatmapMetric(metric.key);
                      } else {
                        setSelectedOverallMetric(metric.key);
                      }
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      isActive
                        ? 'border-[#534AB7] bg-[#EEEDFE] text-[#3C3489]'
                        : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {metric.label}
                  </button>
                );
              })}
              {overallMaxWarning && (
                <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                  Max 5 selected
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Employees:</p>
              <button
                onClick={() => setSelectedOverallEmployees([])}
                className="text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                Clear all
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {overallEmployeeList.map((employee) => {
                const isActive = visibleOverallEmployees.includes(employee);
                return (
                  <button
                    key={employee}
                    onClick={() =>
                      setSelectedOverallEmployees((prev) =>
                        prev.includes(employee) ? prev.filter((e) => e !== employee) : [...prev, employee],
                      )
                    }
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      isActive
                        ? 'border-[#534AB7] bg-[#EEEDFE] text-[#3C3489]'
                        : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {employee}
                  </button>
                );
              })}
            </div>
          </div>

          {recentPublishedSchedules.length === 0 ? (
            <div className="rounded border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
              No published roster periods available yet.
            </div>
          ) : overallViewMode === 'heatmap' ? (
            visibleOverallEmployees.length === 0 ? (
              <div className="rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                Select at least one employee to display the heatmap.
              </div>
            ) : (
            <div className="overflow-x-auto">
              <div className="inline-block min-w-full">
                <div className="mb-2 grid" style={{ gridTemplateColumns: `180px repeat(${selectedHeatmapMetrics.length * overallPeriodsInViewOrder.length}, 68px)` }}>
                  <div />
                  {selectedHeatmapMetrics.map((metric) => (
                    <div
                      key={metric}
                      className="mx-[1px] rounded-t-md bg-gray-100 py-1 text-center text-[10px] font-semibold text-gray-600"
                      style={{ gridColumn: `span ${overallPeriodsInViewOrder.length}` }}
                    >
                      {OVERALL_METRICS.find((m) => m.key === metric)?.label}
                    </div>
                  ))}
                </div>
                <div className="mb-2 grid" style={{ gridTemplateColumns: `180px repeat(${selectedHeatmapMetrics.length * overallPeriodsInViewOrder.length}, 68px)` }}>
                  <div />
                  {selectedHeatmapMetrics.flatMap((metric) =>
                    overallPeriodsInViewOrder.map((_, idx) => (
                      <div key={`${metric}-${idx}`} className="text-center text-[10px] text-gray-500">
                        {overallPeriodMonthAbbr[idx] || `M${idx + 1}`}
                      </div>
                    )),
                  )}
                </div>

                {visibleOverallEmployees.map((employee) => (
                  <div
                    key={employee}
                    className="mb-1 grid items-center"
                    style={{ gridTemplateColumns: `180px repeat(${selectedHeatmapMetrics.length * overallPeriodsInViewOrder.length}, 68px)` }}
                  >
                    <div className="pr-3 text-sm font-medium text-gray-700">{employee}</div>
                    {selectedHeatmapMetrics.flatMap((metric, metricIdx) => {
                      const values = overallPeriodsInViewOrder.map((_, periodIdx) => {
                        return overallMetricsByPeriod[periodIdx]?.get(employee)?.[metric] || 0;
                      });
                      const min = Math.min(...values);
                      const max = Math.max(...values);
                      return values.map((value, periodIdx) => (
                        <div
                          key={`${employee}-${metric}-${periodIdx}`}
                          className="mx-[2px] my-[2px] flex h-[34px] w-[64px] items-center justify-center rounded-[3px] border border-white text-[11px] font-medium text-gray-800"
                          style={{
                            backgroundColor: pickHeatmapColor(value, min, max),
                            borderLeftWidth: periodIdx === 0 && metricIdx > 0 ? '3px' : '1px',
                            borderLeftColor: periodIdx === 0 && metricIdx > 0 ? '#F9FAFB' : '#FFFFFF',
                          }}
                          title={`${employee} · ${overallPeriodLabels[periodIdx]} · ${
                            OVERALL_METRICS.find((m) => m.key === metric)?.label
                          }: ${value} shifts`}
                        >
                          {value}
                        </div>
                      ));
                    })}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-3 text-xs text-gray-600">
                <span>Fewer</span>
                <div className="h-3 w-40 rounded bg-gradient-to-r from-[#EAF8F4] via-[#63C0A0] to-[#136A52]" />
                <span>More</span>
              </div>
            </div>
            )
          ) : (
            <>
              {visibleOverallEmployees.length === 0 ? (
                <div className="rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                  Select at least one employee to display this chart.
                </div>
              ) : (
                <>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                {overallViewMode === 'grouped-bar'
                  ? overallPeriodLabels.map((label, idx) => (
                      <div key={label} className="flex items-center gap-2 text-gray-600">
                        <span className="inline-block h-[10px] w-[10px] rounded-[2px]" style={{ backgroundColor: MONTH_COLORS[idx] }} />
                        <span>{label}</span>
                      </div>
                    ))
                  : visibleOverallEmployees.map((employee, idx) => (
                      <div key={employee} className="flex items-center gap-2 text-gray-600">
                        <span
                          className="inline-block h-[10px] w-[10px] rounded-[2px]"
                          style={{ backgroundColor: `hsl(${(idx * 67) % 360}, 60%, 45%)` }}
                        />
                        <span>{employee}</span>
                      </div>
                    ))}
              </div>
              <div
                style={{
                  width: '100%',
                  height:
                    overallViewMode === 'grouped-bar'
                      ? Math.max(420, visibleOverallEmployees.length * 52 + 60)
                      : 380,
                }}
              >
                {overallViewMode === 'grouped-bar' ? (
                  <Bar
                    key="overall-bar"
                    data={{
                      labels: visibleOverallEmployees,
                      datasets: overallPeriodsInViewOrder.map((_, idx) => ({
                        label: overallPeriodLabels[idx] || `Period ${idx + 1}`,
                        data: visibleOverallEmployees.map(
                          (employee) => overallMetricsByPeriod[idx]?.get(employee)?.[selectedOverallMetric] || 0,
                        ),
                        backgroundColor: MONTH_COLORS[idx],
                        borderWidth: 0,
                        borderSkipped: false as const,
                        borderRadius: 3,
                        barPercentage: 0.85,
                        categoryPercentage: 0.75,
                      })),
                    }}
                    options={{
                      indexAxis: 'y',
                      responsive: true,
                      maintainAspectRatio: false,
                      animation: {
                        duration: 400,
                        easing: 'easeInOutQuart',
                      },
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          callbacks: {
                            label: (context) => `${context.dataset.label}: ${context.parsed.x} shifts`,
                          },
                        },
                      },
                      scales: {
                        x: {
                          beginAtZero: true,
                          max: groupedBarAxisMax,
                          grid: { display: false },
                          ticks: {
                            font: { size: 11 },
                            color: '#6b7280',
                            stepSize: 1,
                            precision: 0,
                            callback: (value) => {
                              const num = typeof value === 'number' ? value : Number(value);
                              return Number.isInteger(num) ? num : '';
                            },
                          },
                        },
                        y: {
                          grid: { display: false },
                          ticks: { font: { size: 11 }, color: '#6b7280' },
                        },
                      },
                    }}
                  />
                ) : (
                  <Line
                    key="overall-line"
                    data={{
                      labels: overallPeriodLabels,
                      datasets: visibleOverallEmployees.map((employee, idx) => {
                        const color = `hsl(${(idx * 67) % 360}, 60%, 45%)`;
                        return {
                          label: employee,
                          data: overallPeriodsInViewOrder.map(
                            (_, periodIdx) =>
                              overallMetricsByPeriod[periodIdx]?.get(employee)?.[selectedOverallMetric] || 0,
                          ),
                          borderColor: color,
                          backgroundColor: color,
                          borderWidth: 2,
                          pointRadius: 5,
                          pointHoverRadius: 7,
                          pointBackgroundColor: color,
                          pointBorderColor: color,
                          tension: 0.3,
                          fill: false,
                        };
                      }),
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      animation: {
                        duration: 400,
                        easing: 'easeInOutQuart',
                      },
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          callbacks: {
                            label: (context) => `${context.dataset.label}: ${context.parsed.y} shifts`,
                          },
                        },
                      },
                      scales: {
                        x: {
                          grid: { color: 'rgba(128,128,128,0.1)' },
                          ticks: { font: { size: 13 }, color: '#6b7280' },
                        },
                        y: {
                          beginAtZero: true,
                          grid: { color: 'rgba(128,128,128,0.1)' },
                          ticks: {
                            font: { size: 13 },
                            color: '#6b7280',
                            stepSize: 1,
                            precision: 0,
                            callback: (value) => {
                              const num = typeof value === 'number' ? value : Number(value);
                              return Number.isInteger(num) ? num : '';
                            },
                          },
                        },
                      },
                    }}
                  />
                )}
              </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

