import React, { useState, useEffect, useRef } from 'react';
import { shiftColors as defaultShiftColors } from '../utils/shiftColors';
import { leaveTypesAPI, shiftTypesAPI, LeaveType, ShiftType } from '../services/api';

/** `<input type="color">` only accepts #rrggbb. */
function colorToHexForColorInput(c: string): string {
  const s = (c || '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s;
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const m = s.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    const x = (n: string) => Number(n).toString(16).padStart(2, '0');
    return `#${x(m[1])}${x(m[2])}${x(m[3])}`;
  }
  return '#ffffff';
}

/** Pick dark or light text on top of a solid swatch color. */
function textOnLegendSwatch(bgHex: string): string {
  try {
    const hex = colorToHexForColorInput(bgHex).slice(1);
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return L > 0.62 ? '#111827' : '#ffffff';
  } catch {
    return '#111827';
  }
}

/** Strip trailing/standalone "Leave" from DB descriptions (e.g. Annual Leave → Annual). */
function stripLeaveWordFromDescription(s: string): string {
  const t = s
    .replace(/\s+leave$/i, '')
    .replace(/^\s*leave\s+/i, '')
    .replace(/\s+leave\s+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

interface ScheduleEntry {
  employee: string;
  date: string;
  shift: string;
}

interface Employee {
  employee: string;
  /** From committed month metrics; omit or null when not set for that snapshot */
  pending_off?: number | null;
}

interface ScheduleTableProps {
  schedule: ScheduleEntry[];
  year: number;
  month: number;
  employees?: Employee[];
  editable?: boolean;
  canChangeColors?: boolean;
  onScheduleChange?: (updatedSchedule: ScheduleEntry[]) => void;
  selectedPeriod?: string | null; // 'pre-ramadan', 'ramadan', 'post-ramadan', or null
}

interface MobileAssignment {
  date: string;
  label: string;
  shift: string;
  shiftLabel: string;
  isWeekend: boolean;
}

interface EmployeeMobileSummary {
  employee: string;
  pendingOff: number;
  daysWithAssignments: MobileAssignment[];
  shiftCount: number;
}

interface LegendItem {
  key: string;
  defaultColor: string;
  /** Text shown beside the swatch (not inside the colored box). */
  description: string;
  /** Full line for tooltip / a11y. */
  label: string;
  /** Short text drawn inside the swatch; defaults to shift `key` when omitted. */
  swatchCode?: string;
}

interface LegendSection {
  id: string;
  title: string;
  items: LegendItem[];
}

/** Legend order under "Shifts" (subset shown = codes present in month schedule). */
const SHIFT_LEGEND_ORDER = [
  'A',
  'IP',
  'M',
  'M3',
  'M4',
  'N',
  'H',
  'MS',
  'P',
  'M+P',
  'IP+P',
  'C',
  'CL',
  'E',
  'AS',
] as const;

/** Legend order under "Leaves". */
const LEAVE_LEGEND_ORDER = [
  'O',
  'DO',
  'APP',
  'W',
  'L',
  'AL',
  'SL',
  'STL',
  'ML',
  'UL',
  'PH',
] as const;

/** Preferred legend descriptions (overrides DB casing/wording where needed). */
const LEGEND_CODE_DESCRIPTION: Record<string, string> = {
  A: 'Afternoon',
  IP: 'Inpatient',
  M: 'Morning',
  M3: '7am-2pm',
  M4: '12pm-7pm',
  N: 'Night',
  H: 'Harat',
  MS: 'Medical Store',
  P: 'Prep',
  'M+P': 'M+Prep',
  'IP+P': 'IP+Prep',
  C: 'Course',
  CL: 'Clinic',
  E: 'Evening',
  AS: 'All Shifts',
  O: 'Off Duty',
  DO: 'Day Off',
  APP: 'Appointment',
  W: 'Workshop',
  L: 'Leave',
  AL: 'Annual',
  SL: 'Sick',
  STL: 'Study',
  ML: 'Maternity',
  UL: 'Unpaid',
  PH: 'Public Holiday',
};

function orderLegendItemsByCode(items: LegendItem[], order: readonly string[]): LegendItem[] {
  const picked = new Set<string>();
  const ordered: LegendItem[] = [];
  for (const code of order) {
    const found = items.find((x) => x.key === code);
    if (found) {
      ordered.push(found);
      picked.add(code);
    }
  }
  const rest = items.filter((x) => !picked.has(x.key)).sort((a, b) => a.key.localeCompare(b.key));
  return [...ordered, ...rest];
}

function classifyLegendBucket(
  code: string,
  leaveTypeCodes: Set<string>,
  shiftTypeCodes: Set<string>,
): 'shift' | 'leave' {
  const inLeaveOrder = (LEAVE_LEGEND_ORDER as readonly string[]).includes(code);
  const inShiftOrder = (SHIFT_LEGEND_ORDER as readonly string[]).includes(code);
  const isLeaveType = leaveTypeCodes.has(code);
  const isShiftType = shiftTypeCodes.has(code);
  // Prefer explicit roster lists so e.g. O / PH stay under Leaves even if also a shift row in DB
  if (inLeaveOrder && !inShiftOrder) return 'leave';
  if (inShiftOrder && !inLeaveOrder) return 'shift';
  if (inLeaveOrder) return 'leave';
  if (inShiftOrder) return 'shift';
  if (isLeaveType && !isShiftType) return 'leave';
  if (isShiftType && !isLeaveType) return 'shift';
  if (isLeaveType) return 'leave';
  return 'shift';
}

const SPECIAL_COLOR_KEYS = {
  weekend: '__weekend',
  totals: '__totals',
} as const;

const defaultSpecialColors: Record<string, string> = {
  [SPECIAL_COLOR_KEYS.weekend]: '#5f8ace',  // Medium Blue - Weekend
  [SPECIAL_COLOR_KEYS.totals]: '#684d80',   // Dark Purple-Gray - Totals Row
  '0': '#FFFFFF',      // White - Empty/Default
  '': '#FFFFFF',       // White - Empty
};

const adjustColorBrightness = (hexColor: string, factor: number): string => {
  const sanitized = hexColor.replace('#', '');
  if (![3, 6].includes(sanitized.length)) return hexColor;

  const fullHex =
    sanitized.length === 3
      ? sanitized
          .split('')
          .map((char) => char + char)
          .join('')
      : sanitized;

  const num = parseInt(fullHex, 16);
  if (Number.isNaN(num)) return hexColor;

  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;

  const adjust = (component: number) => {
    if (factor < 0) {
      return Math.max(0, Math.min(255, Math.round(component * (1 + factor))));
    }
    return Math.max(0, Math.min(255, Math.round(component + (255 - component) * factor)));
  };

  const newR = adjust(r);
  const newG = adjust(g);
  const newB = adjust(b);

  return `#${[newR, newG, newB].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
};

export const ScheduleTable: React.FC<ScheduleTableProps> = ({ 
  schedule, 
  year, 
  month, 
  employees: employeeData,
  editable = false,
  canChangeColors = false,
  onScheduleChange,
  selectedPeriod
}) => {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [editingCell, setEditingCell] = useState<{ employee: string; date: string } | null>(null);
  
  // Load leave types and shift types from API to get dynamic colors and labels
  useEffect(() => {
    const loadTypes = async () => {
      try {
        const [leaveTypesData, shiftTypesData] = await Promise.all([
          leaveTypesAPI.getLeaveTypes(true), // Only active types
          shiftTypesAPI.getShiftTypes(true)  // Only active types
        ]);
        setLeaveTypes(leaveTypesData);
        setShiftTypes(shiftTypesData);
      } catch (error) {
        console.error('Failed to load types:', error);
      }
    };
    loadTypes();
  }, []);
  
  // Get dynamic shift colors including leave types and shift types from database
  const getDynamicShiftColors = (): Record<string, string> => {
    const colors: Record<string, string> = { ...defaultShiftColors };
    // Add leave types with their colors from database
    leaveTypes.forEach(lt => {
      if (lt.color_hex) {
        colors[lt.code] = lt.color_hex;
      }
    });
    // Add shift types with their colors from database
    shiftTypes.forEach(st => {
      if (st.color_hex) {
        colors[st.code] = st.color_hex;
      }
    });
    return colors;
  };
  
  // Get dynamic shift labels from database (no hardcoded labels)
  const getDynamicShiftLabel = (shift: string): string => {
    // Check if it's a leave type from database
    const leaveType = leaveTypes.find(lt => lt.code === shift);
    if (leaveType) {
      return leaveType.description || shift;
    }
    // Check if it's a shift type from database
    const shiftType = shiftTypes.find(st => st.code === shift);
    if (shiftType) {
      return shiftType.description || shift;
    }
    // Fall back to code if not found in database
    return shift;
  };
  
  // Load custom colors from localStorage or use defaults
  const loadCustomColors = (): Record<string, string> => {
    try {
      // Always get fresh dynamic colors from database
      const dynamicColors = getDynamicShiftColors();
      const saved = localStorage.getItem('shiftColors');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge: defaults -> database colors -> special colors (with correct defaults) -> user customizations
        // Special colors always start with their specified defaults unless user explicitly customized them
        const colors = { ...defaultShiftColors, ...dynamicColors, ...defaultSpecialColors, ...parsed };
        // If user hasn't customized special colors, ensure they use defaults
        // Check if they exist in parsed - if not, they should use defaults
        if (!parsed.hasOwnProperty(SPECIAL_COLOR_KEYS.weekend)) {
          colors[SPECIAL_COLOR_KEYS.weekend] = defaultSpecialColors[SPECIAL_COLOR_KEYS.weekend];
        }
        if (!parsed.hasOwnProperty(SPECIAL_COLOR_KEYS.totals)) {
          colors[SPECIAL_COLOR_KEYS.totals] = defaultSpecialColors[SPECIAL_COLOR_KEYS.totals];
        }
        return colors;
      }
    } catch (e) {
      console.error('Failed to load custom colors:', e);
    }
    // Return: defaults + dynamic DB colors + special colors (with correct defaults)
    return { ...defaultShiftColors, ...getDynamicShiftColors(), ...defaultSpecialColors };
  };

  const [customColors, setCustomColors] = useState<Record<string, string>>(loadCustomColors);
  const [editingColor, setEditingColor] = useState<string | null>(null);
  const legendColorInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  
  // Update colors when leave types or shift types load
  useEffect(() => {
    const loadedColors = loadCustomColors();
    // Ensure special colors are reset to defaults if they were customized
    // Reset weekend and totals to specified defaults
    loadedColors[SPECIAL_COLOR_KEYS.weekend] = defaultSpecialColors[SPECIAL_COLOR_KEYS.weekend];
    loadedColors[SPECIAL_COLOR_KEYS.totals] = defaultSpecialColors[SPECIAL_COLOR_KEYS.totals];
    setCustomColors(loadedColors);
    
    // Also update localStorage to remove any custom weekend/totals colors
    const saved = localStorage.getItem('shiftColors');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Remove weekend and totals from localStorage so they use defaults
        delete parsed[SPECIAL_COLOR_KEYS.weekend];
        delete parsed[SPECIAL_COLOR_KEYS.totals];
        localStorage.setItem('shiftColors', JSON.stringify(parsed));
      } catch (e) {
        // If parsing fails, just clear it
        localStorage.removeItem('shiftColors');
      }
    }
  }, [leaveTypes, shiftTypes]);

  // Save colors to localStorage when they change
  useEffect(() => {
    try {
      localStorage.setItem('shiftColors', JSON.stringify(customColors));
    } catch (e) {
      console.error('Failed to save custom colors:', e);
    }
  }, [customColors]);

  // Close color picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (editingColor && !(event.target as HTMLElement).closest('.color-picker-container')) {
        setEditingColor(null);
      }
    };
    if (editingColor) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [editingColor]);

  // Close shift dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (editingCell && !(event.target as HTMLElement).closest('.shift-dropdown-container')) {
        setEditingCell(null);
      }
    };
    if (editingCell) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [editingCell]);

  // Get all available shift options (shift types + leave types + empty)
  const getAvailableShiftOptions = (): Array<{ code: string; label: string; type: 'shift' | 'leave' | 'empty' }> => {
    const optionsMap = new Map<string, { code: string; label: string; type: 'shift' | 'leave' | 'empty' }>();
    
    // Add empty option
    optionsMap.set('', { code: '', label: 'Empty', type: 'empty' });
    
    // Add shift types (use code as label, deduplicate by code)
    shiftTypes.forEach(st => {
      if (!optionsMap.has(st.code)) {
        optionsMap.set(st.code, { code: st.code, label: st.code, type: 'shift' });
      }
    });
    
    // Add leave types (use code as label, deduplicate by code)
    leaveTypes.forEach(lt => {
      if (!optionsMap.has(lt.code)) {
        optionsMap.set(lt.code, { code: lt.code, label: lt.code, type: 'leave' });
      }
    });
    
    // Convert map to array and sort
    const options = Array.from(optionsMap.values());
    return options.sort((a, b) => {
      // Sort: empty first, then by code
      if (a.code === '') return -1;
      if (b.code === '') return 1;
      return a.code.localeCompare(b.code);
    });
  };

  // Handle shift change
  const handleShiftChange = (employee: string, date: string, newShift: string) => {
    if (!onScheduleChange) return;
    
    const dateStr = date.split('T')[0]; // Ensure we use just the date part
    const updatedSchedule = [...schedule];
    
    // Remove existing entry for this employee/date if it exists
    const existingIndex = updatedSchedule.findIndex(
      entry => entry.employee === employee && entry.date.split('T')[0] === dateStr
    );
    
    if (existingIndex >= 0) {
      if (newShift === '') {
        // Remove the entry if empty
        updatedSchedule.splice(existingIndex, 1);
      } else {
        // Update the shift
        updatedSchedule[existingIndex] = {
          ...updatedSchedule[existingIndex],
          shift: newShift,
          date: `${dateStr}T00:00:00` // Ensure consistent date format
        };
      }
    } else if (newShift !== '') {
      // Add new entry if shift is not empty
      updatedSchedule.push({
        employee,
        date: `${dateStr}T00:00:00`,
        shift: newShift
      });
    }
    
    onScheduleChange(updatedSchedule);
    setEditingCell(null);
  };

  // Get shift color (prioritize user manual changes, then database, then defaults)
  const getShiftColor = (shift: string): string => {
    // customColors already contains: defaults -> database -> user overrides (in that merge order)
    // So if a color exists in customColors, it's either:
    // 1. A user override (if it's different from database/default)
    // 2. A database color (if user hasn't overridden it)
    // 3. A default color (if database doesn't have it and user hasn't overridden it)
    // Since user overrides are merged last, customColors[shift] will have the correct priority
    if (customColors[shift]) {
      return customColors[shift];
    }
    // Fallback (shouldn't happen, but just in case)
    const dynamicColors = getDynamicShiftColors();
    return dynamicColors[shift] || defaultShiftColors[shift] || '#FFFFFF';
  };

  // Get month name
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[month - 1];

  // Get date range for display
  const getDateRange = () => {
    if (selectedPeriod && year === 2026 && (month === 2 || month === 3)) {
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
  
  const dateRange = getDateRange();
  const daysInMonth = new Date(year, month, 0).getDate();
  
  // Calculate dates array - memoized to avoid recalculation
  const dates = React.useMemo(() => {
    if (dateRange) {
      const dateList: string[] = [];
      let currentDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      // Use date arithmetic to avoid timezone issues
      while (currentDate <= endDate) {
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        dateList.push(`${year}-${month}-${day}`);
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      // Debug: Log dates for Ramadan
      if (selectedPeriod === 'ramadan') {
        const febDates = dateList.filter(d => d.startsWith('2026-02'));
        const marDates = dateList.filter(d => d.startsWith('2026-03'));
        console.log(`Ramadan dates array: ${febDates.length} Feb dates, ${marDates.length} Mar dates, total: ${dateList.length}`);
        console.log('First few dates:', dateList.slice(0, 5), 'Last few dates:', dateList.slice(-5));
      }
      
      return dateList;
    }
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      // Format as YYYY-MM-DD using local date (avoid timezone conversion issues)
      const monthStr = String(month).padStart(2, '0');
      const dayStr = String(day).padStart(2, '0');
      return `${year}-${monthStr}-${dayStr}`;
    });
  }, [dateRange, daysInMonth, year, month, selectedPeriod]);
  
  // Filter schedule by period if selected
  const filteredSchedule = React.useMemo(() => {
    if (!selectedPeriod || year !== 2026 || (month !== 2 && month !== 3)) {
      return schedule;
    }
    
    // For periods that span months, filter by the dates array (which includes all dates in the range)
    const filtered = schedule.filter(entry => {
      const entryDateStr = entry.date.split('T')[0]; // Get just the date part (YYYY-MM-DD)
      return dates.includes(entryDateStr);
    });
    
    // Debug: Log filtering results for Ramadan (only if schedule has entries)
    if (selectedPeriod === 'ramadan' && schedule.length > 0) {
      const febDates = filtered.filter(e => e.date.split('T')[0].startsWith('2026-02'));
      const marDates = filtered.filter(e => e.date.split('T')[0].startsWith('2026-03'));
      console.log(`Ramadan filtering: ${febDates.length} Feb entries, ${marDates.length} Mar entries, ${dates.length} total dates in range`);
      // Only warn if we have some entries but missing March ones (indicates a problem)
      if (filtered.length > 0 && marDates.length === 0 && dates.some(d => d.startsWith('2026-03'))) {
        console.warn('⚠️ No March entries found in schedule for Ramadan period!');
        console.log('Schedule entries sample:', schedule.slice(0, 5).map(e => e.date));
        console.log('Expected March dates:', dates.filter(d => d.startsWith('2026-03')).slice(0, 5));
      }
    }
    
    return filtered;
  }, [schedule, selectedPeriod, year, month, dates]);

  // Filter data for the specific month or period - use dates array for periods that span months
  const monthData = React.useMemo(() => {
    if (dateRange) {
      // For periods that span months (like Ramadan), use the dates array which includes all dates in the range
      return filteredSchedule.filter(entry => {
        const entryDateStr = entry.date.split('T')[0]; // Get just the date part (YYYY-MM-DD)
        return dates.includes(entryDateStr);
      });
    } else {
      // For regular months, filter by month
      return filteredSchedule.filter(entry => {
        const dateStr = entry.date.split('T')[0]; // Get just the date part (YYYY-MM-DD)
        const [entryYear, entryMonth, entryDay] = dateStr.split('-').map(Number);
        return entryMonth === month && entryYear === year;
      });
    }
  }, [filteredSchedule, dateRange, dates, month, year]);

  /** Legend: only codes in the selected month/period schedule; fixed Shifts / Leaves order; Display = Weekend + Totals. */
  const legendSections = React.useMemo((): LegendSection[] => {
    const shiftTypeCodes = new Set(shiftTypes.map((st) => st.code));
    const leaveTypeCodes = new Set(leaveTypes.map((lt) => lt.code));

    const codesInMonth = new Set(
      monthData
        .map((e) => e.shift)
        .filter((s) => s && s !== '0' && s !== '' && !s.startsWith('__')),
    );

    const allColors = { ...defaultShiftColors, ...getDynamicShiftColors() };

    const labelFromDb = (shift: string): string => {
      const leaveType = leaveTypes.find((lt) => lt.code === shift);
      if (leaveType) return leaveType.description || shift;
      const shiftType = shiftTypes.find((st) => st.code === shift);
      if (shiftType) return shiftType.description || shift;
      return shift;
    };

    const describe = (code: string): string => {
      const normalizedCode = code.replace(/\s+/g, '').toUpperCase();
      if (Object.prototype.hasOwnProperty.call(LEGEND_CODE_DESCRIPTION, normalizedCode)) {
        return LEGEND_CODE_DESCRIPTION[normalizedCode];
      }
      const raw = labelFromDb(code);
      const stripped = stripLeaveWordFromDescription(raw);
      const canonicalized = stripped
        .replace(/inpatient\s*\+\s*prep(?:aration)?/gi, 'IP+Prep')
        .replace(/main\s*\+\s*prep(?:aration)?/gi, 'M+Prep')
        .replace(/\bprep(?:aration)?\b/gi, 'Prep');
      return canonicalized || stripped || raw;
    };

    const rawItems: LegendItem[] = Array.from(codesInMonth).map((code) => {
      const description = describe(code);
      return {
        key: code,
        defaultColor: allColors[code] || '#F5F5F5',
        description,
        label: `${code}: ${description}`,
      };
    });

    const shiftItems: LegendItem[] = [];
    const leaveItems: LegendItem[] = [];
    for (const item of rawItems) {
      if (classifyLegendBucket(item.key, leaveTypeCodes, shiftTypeCodes) === 'leave') {
        leaveItems.push(item);
      } else {
        shiftItems.push(item);
      }
    }

    const sections: LegendSection[] = [];
    const orderedShifts = orderLegendItemsByCode(shiftItems, SHIFT_LEGEND_ORDER);
    if (orderedShifts.length > 0) {
      sections.push({ id: 'shifts', title: 'Shifts', items: orderedShifts });
    }
    const orderedLeaves = orderLegendItemsByCode(leaveItems, LEAVE_LEGEND_ORDER);
    if (orderedLeaves.length > 0) {
      sections.push({ id: 'leaves', title: 'Leaves', items: orderedLeaves });
    }
    sections.push({
      id: 'display',
      title: 'Display',
      items: [
        {
          key: SPECIAL_COLOR_KEYS.weekend,
          defaultColor: defaultSpecialColors[SPECIAL_COLOR_KEYS.weekend],
          description: 'Weekend',
          swatchCode: 'Wk',
          label: 'Weekend',
        },
        {
          key: SPECIAL_COLOR_KEYS.totals,
          defaultColor: defaultSpecialColors[SPECIAL_COLOR_KEYS.totals],
          description: 'Totals',
          swatchCode: 'Tot',
          label: 'Totals',
        },
      ],
    });

    return sections;
  }, [monthData, shiftTypes, leaveTypes]);

  if (monthData.length === 0) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
        No schedule data found for {monthName} {year}. Please generate a schedule first.
      </div>
    );
  }

  // Get all unique employees from schedule data (employees who actually have shifts)
  const employeesInSchedule = Array.from(new Set(monthData.map(e => e.employee)));
  
  // For committed schedules: only show employees who have at least one shift
  // But preserve historical employees who might not be in current employeeData
  let employees: string[];
  if (employeeData && employeeData.length > 0) {
    // Start with employees from employeeData who have shifts in the schedule
    const employeesWithShifts = employeeData
      .map(emp => emp.employee)
      .filter(emp => employeesInSchedule.includes(emp));
    
    // Add any employees in schedule but not in employeeData (historical employees)
    const historicalEmployees = employeesInSchedule.filter(emp => 
      !employeeData.some(e => e.employee === emp)
    );
    
    // Combine: current employees with shifts + historical employees
    employees = [...employeesWithShifts, ...historicalEmployees];
  } else {
    // Fallback: only show employees who have shifts in the schedule
    employees = employeesInSchedule.sort();
  }

  // Create employee pending_off lookup (do not coerce undefined/null to 0 — must match saved month snapshot)
  const pendingOffMap: Record<string, number | null | undefined> = {};
  if (employeeData) {
    employeeData.forEach(emp => {
      pendingOffMap[emp.employee] = emp.pending_off;
    });
  }

  const formatPendingOffCell = (employee: string) => {
    const po = pendingOffMap[employee];
    if (po === null || po === undefined) return '';
    return String(po);
  };

  // Create pivot data structure
  const pivotData: Record<string, Record<string, string>> = {};
  employees.forEach(emp => {
    pivotData[emp] = {};
    dates.forEach(date => {
      pivotData[emp][date] = '';
    });
  });

  // Only add entries for dates that are in our dates array (strictly within the month)
  monthData.forEach(entry => {
    const dateStr = entry.date.split('T')[0];
    // Only add if this date is in our dates array (ensures it's in the correct month)
    if (dates.includes(dateStr) && pivotData[entry.employee] && pivotData[entry.employee][dateStr] === '') {
      pivotData[entry.employee][dateStr] = entry.shift;
    }
  });

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.getDate().toString();
  };

  // Get day of week
  const getDayOfWeek = (dateStr: string) => {
    const date = new Date(dateStr);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()];
  };

  // Get special colors from customColors (which includes user customizations from localStorage)
  // Fall back to defaults if not customized
  const weekendColor = customColors[SPECIAL_COLOR_KEYS.weekend] || defaultSpecialColors[SPECIAL_COLOR_KEYS.weekend];
  const derivedWeekendHeaderColor = weekendColor;
  const totalsColor = customColors[SPECIAL_COLOR_KEYS.totals] || defaultSpecialColors[SPECIAL_COLOR_KEYS.totals];

  const isWeekend = (dateStr: string) => {
    const day = getDayOfWeek(dateStr);
    return day === 'Fri' || day === 'Sat';
  };

  const formatDayLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getDate().toString().padStart(2, '0')} ${getDayOfWeek(dateStr)}`;
  };

  return (
    <div className="space-y-6">
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <table className="min-w-full border-2 border-black text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-black px-1 py-1 text-left font-bold sticky left-0 bg-gray-100 z-10 text-xs">
                Staff
              </th>
              <th className="border border-black px-1 py-1 text-center font-bold text-xs">
                P/O
              </th>
              {dates.map(dateStr => {
                const weekend = isWeekend(dateStr);
                return (
                  <th
                    key={dateStr}
                    className="border border-black px-0.5 py-0.5 text-center font-semibold min-w-[28px]"
                    title={`${getDayOfWeek(dateStr)} ${formatDate(dateStr)}`}
                    style={weekend ? { backgroundColor: derivedWeekendHeaderColor } : undefined}
                  >
                    <div className="text-xs leading-tight">{formatDate(dateStr)}</div>
                    <div className="text-xs text-gray-500 leading-tight">{getDayOfWeek(dateStr)}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {employees.map(employee => {
              // Get shift options once per row (more efficient)
              const shiftOptions = editable ? getAvailableShiftOptions() : [];
              
              return (
              <tr key={employee}>
                <td className="border border-black px-1 py-1 font-semibold sticky left-0 bg-white z-10 text-xs">
                  {employee}
                </td>
                <td className="border border-black px-1 py-1 text-center font-bold text-xs">
                  {formatPendingOffCell(employee)}
                </td>
                {dates.map(dateStr => {
                  const shift = pivotData[employee][dateStr] || '';
                  const baseColor = getShiftColor(shift);
                  const weekend = isWeekend(dateStr);
                  // Weekend header color for empty, O, or PH on Fri/Sat (PH on weekdays keeps leave color)
                  const backgroundColor =
                    weekend && (!shift || shift === 'O' || shift === 'PH' || shift === '')
                      ? weekendColor
                      : baseColor;
                  const isDark = shift === 'M' || shift === 'M3' || shift === 'M4';
                  // Get display label for shift (from database description)
                  const displayText = shift ? (() => {
                    const leaveType = leaveTypes.find(lt => lt.code === shift);
                    // For leave types from DB, optionally show display name, otherwise just code
                    // But usually we just show the code (CS, AL, etc.) for consistency
                    return shift;
                  })() : '';

                  const isEditing = editingCell?.employee === employee && editingCell?.date === dateStr;

                  return (
                    <td
                      key={dateStr}
                      className="border border-black px-0.5 py-0.5 text-center font-bold text-xs relative"
                      style={{
                        backgroundColor,
                        color: isDark ? '#000000' : '#000000',
                      }}
                      title={shift ? `${employee} - ${getDynamicShiftLabel(shift)}` : `${employee} - No shift`}
                    >
                      {editable ? (
                        <div className="shift-dropdown-container relative">
                          <div
                            className={`cursor-pointer transition-all min-h-[18px] flex items-center justify-center leading-tight ${isEditing ? 'ring-2 ring-blue-500 rounded' : 'hover:scale-110 hover:bg-gray-100 hover:bg-opacity-50 rounded'} ${!displayText ? 'border border-dashed border-gray-300' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingCell(isEditing ? null : { employee, date: dateStr });
                            }}
                            title={displayText ? `${employee} - ${getDynamicShiftLabel(shift)}` : `${employee} - Click to add shift`}
                    >
                            {displayText || (isEditing ? '' : <span className="text-gray-400 text-xs">+</span>)}
                          </div>
                          {isEditing && (
                            <div className="absolute top-full left-0 z-50 bg-white border-2 border-gray-300 rounded-lg shadow-xl mt-1 max-h-64 overflow-y-auto min-w-[200px] shift-dropdown-container">
                              <div className="p-1">
                                {shiftOptions.map((option) => {
                                  const optionColor = getShiftColor(option.code);
                                  const isSelected = shift === option.code;
                                  return (
                                    <div
                                      key={option.code || 'empty'}
                                      className={`px-3 py-2 cursor-pointer hover:bg-gray-100 rounded flex items-center justify-between ${
                                        isSelected ? 'bg-blue-50 border border-blue-300' : ''
                                      }`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleShiftChange(employee, dateStr, option.code);
                                      }}
                                    >
                                      <div className="flex items-center space-x-2">
                                        <div
                                          className="w-4 h-4 border border-gray-300 rounded"
                                          style={{ backgroundColor: optionColor }}
                                        />
                                        <span className="text-sm font-medium">{option.label}</span>
                                      </div>
                                      {isSelected && (
                                        <span className="text-blue-600 text-xs">✓</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="cursor-default leading-tight">{displayText}</div>
                      )}
                    </td>
                  );
                })}
              </tr>
              );
            })}
            
            {/* TOTAL MAIN row */}
            <tr className="font-bold">
              <td
                className="border border-black px-1 py-0.5 text-center text-xs"
                colSpan={2}
                style={{ backgroundColor: totalsColor }}
              >
                TOTAL MAIN
              </td>
              {dates.map(dateStr => {
                // Check if it's a weekend (Friday=4, Saturday=5 in Oman)
                const dateObj = new Date(dateStr);
                const weekday = dateObj.getDay(); // 0=Sunday, 1=Monday, ..., 5=Friday, 6=Saturday
                const isWeekend = weekday === 5 || weekday === 6; // Friday or Saturday
                
                // Show empty on weekends, otherwise count M, M+P, M3, M4 shifts
                if (isWeekend) {
                  return (
                    <td
                      key={dateStr}
                      className="border border-black px-0.5 py-0.5 text-center font-bold text-xs"
                      style={{ backgroundColor: totalsColor }}
                    >
                      {/* Empty on weekends */}
                    </td>
                  );
                }
                
                const mainCount = employees.reduce((count, emp) => {
                  const shift = pivotData[emp][dateStr] || '';
                  // Include M, M+P, M3, M4 in total main count
                  return count + (['M', 'M+P', 'M3', 'M4'].includes(shift) ? 1 : 0);
                }, 0);
                return (
                  <td
                    key={dateStr}
                    className="border border-black px-0.5 py-0.5 text-center font-bold text-xs"
                    style={{ backgroundColor: totalsColor }}
                  >
                    {mainCount}
                  </td>
                );
              })}
            </tr>
            
            {/* TOTAL IP row */}
            <tr className="font-bold">
              <td
                className="border border-black px-1 py-0.5 text-center text-xs"
                colSpan={2}
                style={{ backgroundColor: totalsColor }}
              >
                TOTAL IP
              </td>
              {dates.map(dateStr => {
                // Check if it's a weekend (Friday=4, Saturday=5 in Oman)
                const dateObj = new Date(dateStr);
                const weekday = dateObj.getDay(); // 0=Sunday, 1=Monday, ..., 5=Friday, 6=Saturday
                const isWeekend = weekday === 5 || weekday === 6; // Friday or Saturday
                
                // Show empty on weekends, otherwise count IP and IP+P shifts
                if (isWeekend) {
                  return (
                    <td
                      key={dateStr}
                      className="border border-black px-0.5 py-0.5 text-center font-bold text-xs"
                      style={{ backgroundColor: totalsColor }}
                    >
                      {/* Empty on weekends */}
                    </td>
                  );
                }
                
                const ipCount = employees.reduce((count, emp) => {
                  const shift = pivotData[emp][dateStr] || '';
                  // Include IP and IP+P in total IP count
                  return count + (['IP', 'IP+P'].includes(shift) ? 1 : 0);
                }, 0);
                return (
                  <td
                    key={dateStr}
                    className="border border-black px-0.5 py-0.5 text-center font-bold text-xs"
                    style={{ backgroundColor: totalsColor }}
                  >
                    {ipCount}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      {/* Legend with Color Pickers */}
      <div className="mt-3 bg-white p-2 sm:p-2.5 rounded-lg shadow" data-schedule-legend>
        <div className="space-y-0">
          {legendSections.map((section, sectionIdx) => (
            <div
              key={section.id}
              data-legend-section={section.id}
              className={`min-w-0 ${sectionIdx > 0 ? 'mt-1 border-t border-gray-100 pt-1' : ''}`}
            >
              <h4 className="mb-0.5 border-b border-gray-100 pb-0.5 text-[10px] font-semibold uppercase leading-tight tracking-wide text-gray-600">
                {section.title}
              </h4>
              <div className={section.id === 'display' && canChangeColors ? 'flex items-end gap-2' : ''}>
                <div className="grid min-w-0 flex-1 grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-x-1.5 gap-y-0.5 print:grid-cols-6 print:gap-x-1 print:gap-y-1">
                {section.items.map((item) => {
            const { key, defaultColor, description, label, swatchCode } = item;
            const codeInSwatch = swatchCode ?? key;
            const currentColor = getShiftColor(key);
            const isEditing = editingColor === key;
            const swLen = codeInSwatch.length;
            const swatchTextClass =
              swLen > 4
                ? 'text-[7px] sm:text-[8px]'
                : swLen === 4
                  ? 'text-[8px] sm:text-[10px]'
                  : swLen > 2
                    ? 'text-[9px] sm:text-[11px]'
                    : 'text-[10px] sm:text-xs';

            return (
              <div key={key} className="group flex min-w-0 max-w-full items-center gap-1 overflow-hidden py-px">
                <div className="relative color-picker-container flex-shrink-0">
                  {canChangeColors && (
                    <input
                      ref={(el) => {
                        const m = legendColorInputRefs.current;
                        if (el) m.set(key, el);
                        else m.delete(key);
                      }}
                      type="color"
                      value={colorToHexForColorInput(currentColor)}
                      onChange={(e) => {
                        setCustomColors({ ...customColors, [key]: e.target.value });
                      }}
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden
                    />
                  )}
                  <div
                    className={`flex min-h-[24px] min-w-[24px] max-w-[3.25rem] shrink-0 items-center justify-center rounded border border-gray-300 px-0.5 outline-none ring-0 transition-colors sm:min-h-[26px] sm:min-w-[26px] print:min-h-[20px] print:min-w-[20px] ${
                      canChangeColors
                        ? 'cursor-pointer hover:border-gray-400 focus:outline-none focus-visible:outline-none active:border-gray-500'
                        : 'cursor-default'
                    }`}
                    style={{ backgroundColor: currentColor }}
                    tabIndex={canChangeColors ? -1 : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canChangeColors) return;
                      if (isEditing) {
                        setEditingColor(null);
                        return;
                      }
                      const input = legendColorInputRefs.current.get(key);
                      if (input) {
                        try {
                          if (typeof input.showPicker === 'function') {
                            const r = input.showPicker();
                            if (r !== undefined && typeof (r as Promise<void>).catch === 'function') {
                              (r as Promise<void>).catch(() => input.click());
                            }
                          } else {
                            input.click();
                          }
                        } catch {
                          input.click();
                        }
                      }
                      setEditingColor(key);
                    }}
                    title={canChangeColors ? `${label} — click to change color` : label}
                  >
                    <span
                      className={`select-none font-bold leading-none tracking-tight ${swatchTextClass}`}
                      style={{
                        color: textOnLegendSwatch(currentColor),
                        textShadow:
                          textOnLegendSwatch(currentColor) === '#ffffff'
                            ? '0 0 2px rgba(0,0,0,0.75)'
                            : 'none',
                      }}
                    >
                      {codeInSwatch}
                    </span>
                  </div>
                  {isEditing && (
                    <div className="absolute left-0 top-7 z-50 flex gap-1.5 rounded border border-gray-300 bg-white p-1.5 shadow-lg color-picker-container">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCustomColors({ ...customColors, [key]: defaultColor });
                          setEditingColor(null);
                        }}
                        className="rounded bg-gray-200 px-2 py-1 text-xs hover:bg-gray-300"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingColor(null);
                        }}
                        className="rounded bg-primary-600 px-2 py-1 text-xs text-white hover:bg-primary-700"
                      >
                        Done
                      </button>
                    </div>
                  )}
                </div>
                <span
                  className="min-w-0 flex-1 truncate text-[10px] leading-none text-gray-800 sm:text-xs print:whitespace-normal print:break-words print:overflow-visible print:[text-overflow:clip] print:leading-tight"
                  title={label}
                >
                  {description}
                </span>
              </div>
            );
                })}
                </div>
                {section.id === 'display' && canChangeColors && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Reset all colors to database defaults?')) {
                        const dynamicColors = getDynamicShiftColors();
                        const resetColors = {
                          ...defaultShiftColors,
                          ...dynamicColors,
                          [SPECIAL_COLOR_KEYS.weekend]: defaultSpecialColors[SPECIAL_COLOR_KEYS.weekend],
                          [SPECIAL_COLOR_KEYS.totals]: defaultSpecialColors[SPECIAL_COLOR_KEYS.totals],
                          '0': defaultSpecialColors['0'],
                          '': defaultSpecialColors[''],
                        };
                        setCustomColors(resetColors);
                        localStorage.removeItem('shiftColors');
                      }
                    }}
                    className="mb-px shrink-0 rounded bg-gray-200 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-300"
                  >
                    Reset Colors
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

