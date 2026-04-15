import React, { useState, useEffect, useCallback, useRef } from 'react';
import { EditableTable } from './EditableTable';
import { useToast } from '../contexts/ToastContext';
import { shiftTypesAPI, ShiftType, dataAPI } from '../services/api';
import api from '../services/api';
import { shiftColors as defaultShiftColors } from '../utils/shiftColors';

interface DemandsTabProps {
  selectedYear: number | null;
  selectedMonth: number | null;
  monthNames: string[];
  selectedPeriod?: string | null; // 'pre-ramadan', 'ramadan', 'post-ramadan', or null
}

const SHIFT_CODES = ['M', 'IP', 'A', 'N', 'M3', 'M4', 'H', 'CL'] as const;

// Helper functions outside component
const formatDayName = (dateString?: string) => {
  if (!dateString) {
    return '';
  }
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(parsed);
};

const addDayNames = (demands: any[]) =>
  demands.map((entry) => ({
    ...entry,
    day_name: formatDayName(entry.date),
  }));

const stripDayNames = (demands: any[]) =>
  demands.map(({ day_name, ...rest }) => rest);

// Standard shift types that have dedicated columns in demands
const STANDARD_SHIFT_CODES = ['M', 'IP', 'A', 'N', 'M3', 'M4', 'H', 'CL', 'E', 'MS', 'IP+P', 'P', 'M+P'];

// Helper function to convert shift code to column name (e.g., "IP+P" -> "IP_P")
const shiftCodeToColumnName = (shiftCode: string): string => {
  return shiftCode.replace(/\+/g, '_');
};

// Fixed shift display order helper
const FIXED_SHIFT_ORDER = ['P', 'H', 'IP+P', 'M+P'];
const getFixedShiftSortKey = (shift: string) => {
  const idx = FIXED_SHIFT_ORDER.indexOf(shift);
  return idx === -1 ? FIXED_SHIFT_ORDER.length : idx;
};

/** One source of truth: Shift Requirements at the bottom, Reset, first-time Generate, and switching months with no saved prefs */
type ShiftRequirementRow = { Shift: string; Count: number };
type FixedShiftConfigRow = { shift: string; day: number; count: number };

const DEFAULT_WEEKDAY_SHIFT_REQUIREMENTS: ShiftRequirementRow[] = [
  { Shift: 'M', Count: 6 },
  { Shift: 'IP', Count: 3 },
  { Shift: 'A', Count: 1 },
  { Shift: 'N', Count: 1 },
  { Shift: 'M3', Count: 1 },
  { Shift: 'M4', Count: 1 },
  { Shift: 'CL', Count: 2 },
  { Shift: 'MS', Count: 1 },
];
const DEFAULT_WEEKEND_SHIFT_REQUIREMENTS: ShiftRequirementRow[] = [
  { Shift: 'A', Count: 1 },
  { Shift: 'N', Count: 1 },
  { Shift: 'M3', Count: 1 },
];
/** day: 0–6 = Mon–Sun; -1 = P on 1st/2nd/3rd non-weekend (see backend) */
const DEFAULT_FIXED_SHIFTS: FixedShiftConfigRow[] = [
  { shift: 'P', day: -1, count: 2 },
  { shift: 'H', day: 0, count: 1 },
  { shift: 'H', day: 2, count: 1 },
  { shift: 'IP+P', day: 0, count: 1 },
  { shift: 'M+P', day: 1, count: 1 },
];

const cloneWeekdayRequirements = () => DEFAULT_WEEKDAY_SHIFT_REQUIREMENTS.map((r) => ({ ...r }));
const cloneWeekendRequirements = () => DEFAULT_WEEKEND_SHIFT_REQUIREMENTS.map((r) => ({ ...r }));
const cloneFixedShifts = () => DEFAULT_FIXED_SHIFTS.map((r) => ({ ...r }));
const mergeShiftRequirementRows = (
  savedRows: ShiftRequirementRow[] | undefined,
  defaultRows: ShiftRequirementRow[],
): ShiftRequirementRow[] => {
  const saved = Array.isArray(savedRows) ? savedRows : [];
  const byShift = new Map(saved.map((row) => [row.Shift, row]));
  return defaultRows.map((row) => {
    const existing = byShift.get(row.Shift);
    return {
      Shift: row.Shift,
      Count: typeof existing?.Count === 'number' ? existing.Count : row.Count,
    };
  });
};

export const DemandsTab: React.FC<DemandsTabProps> = ({ selectedYear, selectedMonth, monthNames, selectedPeriod }) => {
  const [monthDemands, setMonthDemands] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [editingHoliday, setEditingHoliday] = useState<string | null>(null);
  const [holidayInput, setHolidayInput] = useState<string>('');
  const deletingHolidayRef = useRef<boolean>(false);
  const [addingShift, setAddingShift] = useState<string | null>(null); // date for which we're adding a shift
  const [weekdayConfig, setWeekdayConfig] = useState(cloneWeekdayRequirements);
  const [weekendConfig, setWeekendConfig] = useState(cloneWeekendRequirements);
  const [fixedShiftsConfig, setFixedShiftsConfig] = useState(cloneFixedShifts);
  const [regenerating, setRegenerating] = useState(false);
  const [totalEmployees, setTotalEmployees] = useState(20); // Default to 20, will be updated
  const [editingFixedShiftDay, setEditingFixedShiftDay] = useState<number | null>(null);
  const [showingShiftOptions, setShowingShiftOptions] = useState<number | null>(null); // Index of fixed shift showing shift options
  const { showToast } = useToast();

  // Load shift types to get colors (for display purposes)
  useEffect(() => {
    const loadShiftTypes = async () => {
      try {
        const types = await shiftTypesAPI.getShiftTypes(true);
        setShiftTypes(types);
      } catch (error) {
        console.error('Failed to load shift types:', error);
      }
    };
    loadShiftTypes();
  }, []);

  // Load employees to get total count
  useEffect(() => {
    const loadEmployees = async () => {
      try {
        const employees = await dataAPI.getEmployees();
        setTotalEmployees(employees.length || 20);
      } catch (error) {
        console.error('Failed to load employees:', error);
      }
    };
    loadEmployees();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addingShift && !(event.target as Element).closest('.shift-dropdown-container')) {
        setAddingShift(null);
      }
      if (showingShiftOptions !== null && !(event.target as Element).closest('.fixed-shift-options-container')) {
        setShowingShiftOptions(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [addingShift, showingShiftOptions]);

  // Get shift color from database or fallback to default colors
  const getShiftColor = (shiftCode: string): string => {
    const shiftType = shiftTypes.find(st => st.code === shiftCode);
    if (shiftType && shiftType.color_hex) {
      return shiftType.color_hex;
    }
    return defaultShiftColors[shiftCode] || '#FFFFFF';
  };

  // Get shift description from database
  const getShiftDescription = (shiftCode: string): string => {
    const shiftType = shiftTypes.find(st => st.code === shiftCode);
    if (shiftType) {
      return shiftType.description || shiftCode;
    }
    return shiftCode;
  };

  /** Same weekday/weekend counts as the Shift Requirements tables; H only from fixed shifts unless you add H here. */
  const buildBaseAndWeekendDemands = useCallback(() => {
    const base_demand: any = {
      'M': 0, 'IP': 0, 'A': 0, 'N': 0, 'M3': 0, 'M4': 0, 'H': 0, 'CL': 0, 'E': 0, 'MS': 0, 'IP+P': 0, 'P': 0, 'M+P': 0
    };
    const weekend_demand: any = {
      'M': 0, 'IP': 0, 'A': 0, 'N': 0, 'M3': 0, 'M4': 0, 'H': 0, 'CL': 0, 'E': 0, 'MS': 0, 'IP+P': 0, 'P': 0, 'M+P': 0
    };
    weekdayConfig.forEach(item => {
      base_demand[item.Shift] = item.Count;
    });
    weekendConfig.forEach(item => {
      weekend_demand[item.Shift] = item.Count;
    });
    return { base_demand, weekend_demand };
  }, [weekdayConfig, weekendConfig]);

  const generateDefaults = useCallback(async (year: number, month: number) => {
    const { base_demand, weekend_demand } = buildBaseAndWeekendDemands();
    try {
      const response = await api.post('/api/data/demands/generate', {
        year,
        month,
        base_demand,
        weekend_demand,
        fixed_shifts: fixedShiftsConfig,
      });
      setMonthDemands(addDayNames(response.data.demands));
    } catch (error) {
      console.error('Failed to generate defaults:', error);
    }
  }, [buildBaseAndWeekendDemands, fixedShiftsConfig]);

  // Cleanup timeout on unmount (no longer needed since we save immediately, but keep for safety)
  useEffect(() => {
    return () => {
      if (demandSaveTimeoutRef.current) {
        clearTimeout(demandSaveTimeoutRef.current);
      }
    };
  }, []);

  const loadMonthDemands = useCallback(async () => {
    if (!selectedYear || !selectedMonth) {
      setLoading(false);
      return;
    }
    
      try {
        setLoading(true);
        
        // First, check localStorage for recent changes
        const localBackup = loadDemandsFromLocalStorage();
        const localTimestamp = localBackup?.timestamp || 0;
        const now = Date.now();
        const isLocalRecent = localTimestamp > 0 && (now - localTimestamp) < 300000; // 5 minutes
        
        // Determine which months to load based on period
        const monthsToLoad: number[] = [];
        if (selectedYear === 2026 && selectedPeriod) {
          // For periods that span multiple months, load all relevant months
          if (selectedPeriod === 'ramadan') {
            // Ramadan spans Feb 19 - March 18, so load both months
            monthsToLoad.push(2, 3);
          } else if (selectedPeriod === 'pre-ramadan') {
            // Pre-Ramadan is Feb 1-18, only February
            monthsToLoad.push(2);
          } else if (selectedPeriod === 'post-ramadan') {
            // Post-Ramadan is March 19-31, only March
            monthsToLoad.push(3);
          } else {
            monthsToLoad.push(selectedMonth);
          }
        } else {
          monthsToLoad.push(selectedMonth);
        }
        
        // Load from backend for all relevant months
        let backendDemands: any[] = [];
        let backendTimestamp = 0;
        try {
          // Load demands from all relevant months
          const allDemandsPromises = monthsToLoad.map(month => 
            api.get(`/api/data/demands/month/${selectedYear}/${month}`)
              .then(response => response.data || [])
              .catch(error => {
                console.error(`Failed to load demands for ${selectedYear}/${month}:`, error);
                return [];
              })
          );
          
          const allDemandsArrays = await Promise.all(allDemandsPromises);
          backendDemands = allDemandsArrays.flat();
          
          // Use file modification time as proxy for backend timestamp
          // Since we can't get this directly, we'll compare data instead
          backendTimestamp = 0; // We'll use data comparison instead
        } catch (error) {
          console.error('Failed to load demands from backend:', error);
        }
        
        // Decision logic: Always prefer backend data (since we save immediately now)
        // Only use localStorage if backend is empty or failed
        if (backendDemands.length > 0) {
          // Backend has data - use it (this is the source of truth)
          setMonthDemands(addDayNames(backendDemands));
          // Update localStorage backup with backend data
          saveDemandsToLocalStorage(backendDemands);
        } else if (localBackup?.data && localBackup.data.length > 0) {
          // Backend is empty but localStorage has data - use localStorage and restore to backend
          console.log('Loading demands from localStorage (backend empty, restoring to backend)');
          setMonthDemands(addDayNames(localBackup.data));
          // Try to restore to backend
          try {
            await api.post(`/api/data/demands/month/${selectedYear}/${selectedMonth}`, localBackup.data);
            console.log('Restored demands from localStorage to backend');
          } catch (saveError) {
            console.error('Failed to restore to backend:', saveError);
            showToast({ 
              type: 'error', 
              message: '⚠️ Loaded from local backup. Failed to restore to backend.' 
            });
          }
        } else {
          // No data anywhere - show empty state
          setMonthDemands([]);
        }
      } catch (error) {
        console.error('Failed to load demands:', error);
        // Last resort: try localStorage
        const localBackup = loadDemandsFromLocalStorage();
        if (localBackup?.data && localBackup.data.length > 0) {
          console.log('Loading demands from localStorage (fallback)');
          setMonthDemands(addDayNames(localBackup.data));
          showToast({ 
            type: 'error', 
            message: '⚠️ Loaded from local backup. Backend unavailable.' 
          });
        } else {
          setMonthDemands([]);
        }
      } finally {
        setLoading(false);
      }
  }, [selectedYear, selectedMonth, selectedPeriod, showToast]);
    
  useEffect(() => {
    loadMonthDemands();
    // Reset initial load flag when month/year changes
    isInitialLoadRef.current = true;
  }, [loadMonthDemands]);

  const handleResetDefaults = async () => {
    if (!selectedYear || !selectedMonth) return;
    setLoading(true);
    setWeekdayConfig(cloneWeekdayRequirements());
    setWeekendConfig(cloneWeekendRequirements());
    setFixedShiftsConfig(cloneFixedShifts());
    await generateDefaults(selectedYear, selectedMonth);
    setLoading(false);
  };

  // Debounce timer for saving demands
  const demandSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Helper function to save demands to backend, handling periods that span multiple months
  const saveDemandsToBackend = useCallback(async (demands: any[]) => {
    if (!selectedYear || !selectedMonth) return;
    
    // If period spans multiple months, split demands by month and save to each month's endpoint
    if (selectedYear === 2026 && selectedPeriod === 'ramadan') {
      // Ramadan spans Feb 19 - March 18, so split by month
      const febDemands = demands.filter((d: any) => {
        const date = new Date(d.date);
        return date.getMonth() + 1 === 2; // February is month 2
      });
      const marDemands = demands.filter((d: any) => {
        const date = new Date(d.date);
        return date.getMonth() + 1 === 3; // March is month 3
      });
      
      // Save to both months
      await Promise.all([
        febDemands.length > 0 ? api.post(`/api/data/demands/month/${selectedYear}/2`, febDemands) : Promise.resolve(),
        marDemands.length > 0 ? api.post(`/api/data/demands/month/${selectedYear}/3`, marDemands) : Promise.resolve()
      ]);
    } else {
      // Regular month or period within single month - save normally
      await api.post(`/api/data/demands/month/${selectedYear}/${selectedMonth}`, demands);
    }
  }, [selectedYear, selectedMonth, selectedPeriod]);

  // Save demands to localStorage as backup with timestamp
  const saveDemandsToLocalStorage = useCallback((demands: any[]) => {
    if (!selectedYear || !selectedMonth) return;
    const storageKey = `demands_backup_${selectedYear}_${selectedMonth}`;
    const timestampKey = `demands_timestamp_${selectedYear}_${selectedMonth}`;
    localStorage.setItem(storageKey, JSON.stringify(demands));
    localStorage.setItem(timestampKey, Date.now().toString());
  }, [selectedYear, selectedMonth]);

  // Load demands from localStorage as backup
  const loadDemandsFromLocalStorage = useCallback(() => {
    if (!selectedYear || !selectedMonth) return null;
    const storageKey = `demands_backup_${selectedYear}_${selectedMonth}`;
    const timestampKey = `demands_timestamp_${selectedYear}_${selectedMonth}`;
    const saved = localStorage.getItem(storageKey);
    const timestamp = localStorage.getItem(timestampKey);
    if (saved) {
      try {
        return {
          data: JSON.parse(saved),
          timestamp: timestamp ? parseInt(timestamp, 10) : 0
        };
      } catch (error) {
        console.error('Failed to parse saved demands:', error);
        return null;
      }
    }
    return null;
  }, [selectedYear, selectedMonth]);

  const handleDemandChange = async (date: string, shiftCode: string, value: number) => {
    if (!selectedYear || !selectedMonth) return;
    
    // Convert shift code to column name (e.g., "IP+P" -> "IP_P")
    const columnName = shiftCodeToColumnName(shiftCode);
    
    const updatedDemands = monthDemands.map(demand => {
      if (demand.date === date) {
        return {
          ...demand,
          [`need_${columnName}`]: value
        };
      }
      return demand;
    });
    
    // Update UI immediately
    setMonthDemands(updatedDemands);
    
    // Save demands without holiday column (holidays are saved separately)
    const demandsWithoutHoliday = stripDayNames(updatedDemands.map(({ holiday, ...rest }) => rest));
    saveDemandsToLocalStorage(demandsWithoutHoliday);
    
    // Clear existing timeout
    if (demandSaveTimeoutRef.current) {
      clearTimeout(demandSaveTimeoutRef.current);
    }
    
    // Save to backend immediately (no debounce) - user wants changes saved to backend
    try {
      await saveDemandsToBackend(demandsWithoutHoliday);
      // Save successful - update localStorage with the saved version
      saveDemandsToLocalStorage(demandsWithoutHoliday);
    } catch (error: any) {
      console.error('Failed to save demands to backend:', error);
      // Backend save failed, but we already saved to localStorage
      showToast({ 
        type: 'error', 
        message: '⚠️ Saved locally. Backend save failed - please try again.' 
      });
    }
  };

  const handleHolidayChange = async (date: string, holiday: string) => {
    if (!selectedYear || !selectedMonth) return;
    
    const isDeletingHoliday = !holiday || !holiday.trim();
    let updatedDemands: any[];
    
    // If deleting holiday, regenerate default demands for that date
    if (isDeletingHoliday) {
      // Calculate default demands based on weekday/weekend
      const dateObj = new Date(date);
      const weekday = dateObj.getDay(); // 0 = Sunday, 6 = Saturday
      // In Oman: Weekdays = Sunday(0), Monday(1), Tuesday(2), Wednesday(3), Thursday(4)
      // Weekends = Friday(5), Saturday(6)
      const isWeekend = weekday === 5 || weekday === 6; // Friday or Saturday
      
      // Get the appropriate config (weekday or weekend)
      const config = isWeekend ? weekendConfig : weekdayConfig;
      
      // Build default demands object
      const defaultDemands: Record<string, number> = {
        'M': 0, 'IP': 0, 'A': 0, 'N': 0, 'M3': 0, 'M4': 0, 'H': 0, 'CL': 0, 'E': 0, 'MS': 0, 'IP+P': 0, 'P': 0, 'M+P': 0
      };
      
      // Set values from config
      config.forEach(item => {
        if (item.Shift !== 'H') {
          defaultDemands[item.Shift] = item.Count;
        }
      });
      
      // Apply fixed shifts based on config
      // weekday: 0 = Monday, 1 = Tuesday, 2 = Wednesday, 3 = Thursday, 4 = Friday, 5 = Saturday, 6 = Sunday
      // But JavaScript Date.getDay(): 0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday, 6 = Saturday
      // So we need to convert: JS weekday 1 = Monday = our day 0, JS weekday 3 = Wednesday = our day 2
      const jsWeekday = dateObj.getDay(); // 0 = Sunday, 6 = Saturday
      // Convert to our day format: 0 = Monday, 6 = Sunday
      const ourDay = jsWeekday === 0 ? 6 : jsWeekday - 1;
      
      // Apply fixed shifts
      fixedShiftsConfig.forEach(fixed => {
        if (fixed.day === ourDay) {
          defaultDemands[fixed.shift] = (defaultDemands[fixed.shift] || 0) + fixed.count;
        }
      });
      
      // Update the demand for this date with default values
      updatedDemands = monthDemands.map(demand => {
        if (demand.date === date) {
          return {
            ...demand,
            holiday: '', // Clear holiday
            need_M: defaultDemands['M'],
            need_IP: defaultDemands['IP'],
            need_A: defaultDemands['A'],
            need_N: defaultDemands['N'],
            need_M3: defaultDemands['M3'],
            need_M4: defaultDemands['M4'],
            need_H: defaultDemands['H'],
            need_CL: defaultDemands['CL'],
            need_E: defaultDemands['E'],
            need_MS: defaultDemands['MS'],
          };
        }
        return demand;
      });
    } else {
      // Just updating holiday name, not deleting
      updatedDemands = monthDemands.map(demand => {
        if (demand.date === date) {
          return {
            ...demand,
            holiday: holiday
          };
        }
        return demand;
      });
    }
    
    // Update UI immediately
    setMonthDemands(updatedDemands);
    setEditingHoliday(null);
    
    // Save holidays separately (not in demands)
    try {
      // Build holidays object from updated demands (excluding empty ones)
      const holidays: Record<string, string> = {};
      updatedDemands.forEach(demand => {
        if (demand.holiday && demand.holiday.trim()) {
          holidays[demand.date] = demand.holiday.trim();
        }
      });
      
      // Save holidays separately - need to save to both months if period spans multiple months
      if (selectedYear === 2026 && selectedPeriod === 'ramadan') {
        // Split holidays by month
        const febHolidays: Record<string, string> = {};
        const marHolidays: Record<string, string> = {};
        Object.entries(holidays).forEach(([date, holiday]) => {
          const dateObj = new Date(date);
          if (dateObj.getMonth() + 1 === 2) {
            febHolidays[date] = holiday;
          } else if (dateObj.getMonth() + 1 === 3) {
            marHolidays[date] = holiday;
          }
        });
        await Promise.all([
          Object.keys(febHolidays).length > 0 ? api.post(`/api/data/holidays/month/${selectedYear}/2`, febHolidays) : Promise.resolve(),
          Object.keys(marHolidays).length > 0 ? api.post(`/api/data/holidays/month/${selectedYear}/3`, marHolidays) : Promise.resolve()
        ]);
      } else {
        await api.post(`/api/data/holidays/month/${selectedYear}/${selectedMonth}`, holidays);
      }
      
      // Save demands - backend will automatically apply holiday-specific demands for holiday days
      const demandsWithoutHoliday = stripDayNames(updatedDemands.map(({ holiday, ...rest }) => rest));
      await saveDemandsToBackend(demandsWithoutHoliday);
      
      // Reload demands from backend to get the updated values
      // This ensures the UI shows the correct demands immediately
      const response = await api.get(`/api/data/demands/month/${selectedYear}/${selectedMonth}`);
      const reloadedDemands = response.data || [];
      setMonthDemands(addDayNames(reloadedDemands));
      
      if (isDeletingHoliday) {
        showToast({ type: 'success', message: '✅ Holiday deleted! Demands reset to default.' });
      } else {
        showToast({ type: 'success', message: '✅ Holiday saved! Demands updated.' });
      }
    } catch (error: any) {
      console.error('Failed to save holiday to backend:', error);
      showToast({ 
        type: 'error', 
        message: '⚠️ Failed to save holiday. Please try again.' 
      });
    }
  };

  // Save shift requirements configuration to localStorage
  const saveShiftRequirementsConfig = useCallback(() => {
    if (!selectedYear || !selectedMonth) return;
    const configKey = `shift_requirements_${selectedYear}_${selectedMonth}`;
    const config = {
      weekday: weekdayConfig,
      weekend: weekendConfig,
      fixedShifts: fixedShiftsConfig,
    };
    localStorage.setItem(configKey, JSON.stringify(config));
  }, [selectedYear, selectedMonth, weekdayConfig, weekendConfig, fixedShiftsConfig]);

  // Load shift requirements configuration from localStorage
  const loadShiftRequirementsConfig = useCallback(() => {
    if (!selectedYear || !selectedMonth) return;
    const configKey = `shift_requirements_${selectedYear}_${selectedMonth}`;
    const saved = localStorage.getItem(configKey);
    if (saved) {
      try {
        const config = JSON.parse(saved);
        setWeekdayConfig(mergeShiftRequirementRows(config.weekday, DEFAULT_WEEKDAY_SHIFT_REQUIREMENTS));
        setWeekendConfig(mergeShiftRequirementRows(config.weekend, DEFAULT_WEEKEND_SHIFT_REQUIREMENTS));
        if (config.fixedShifts) {
          // Ensure required automatic shifts are always in the config
          const hasMP = config.fixedShifts.some((f: any) => f.shift === 'M+P');
          const hasP = config.fixedShifts.some((f: any) => f.shift === 'P');
          const hasIPPlusP = config.fixedShifts.some((f: any) => f.shift === 'IP+P');
          if (!hasMP) {
            config.fixedShifts.unshift({ shift: 'M+P', day: 1, count: 1 });
          }
          if (!hasP) {
            // Insert P after M+P
            const mpIndex = config.fixedShifts.findIndex((f: any) => f.shift === 'M+P');
            config.fixedShifts.splice(mpIndex + 1, 0, { shift: 'P', day: -1, count: 2 });
          }
          if (!hasIPPlusP) {
            config.fixedShifts.push({ shift: 'IP+P', day: 0, count: 1 });
          }
          const sortedFixed = [...config.fixedShifts].sort((a: any, b: any) => {
            const diff = getFixedShiftSortKey(a.shift) - getFixedShiftSortKey(b.shift);
            if (diff !== 0) return diff;
            return (a.day ?? 0) - (b.day ?? 0);
          });
          setFixedShiftsConfig(sortedFixed);
        }
      } catch (error) {
        console.error('Failed to load shift requirements config:', error);
        setWeekdayConfig(cloneWeekdayRequirements());
        setWeekendConfig(cloneWeekendRequirements());
        setFixedShiftsConfig(cloneFixedShifts());
      }
    } else {
      // No saved prefs for this month: use the same defaults as the Shift Requirements section
      setWeekdayConfig(cloneWeekdayRequirements());
      setWeekendConfig(cloneWeekendRequirements());
      setFixedShiftsConfig(cloneFixedShifts());
    }
  }, [selectedYear, selectedMonth]);

  // Load config when month/year changes
  useEffect(() => {
    loadShiftRequirementsConfig();
  }, [loadShiftRequirementsConfig]);

  // Auto-save config when it changes (with debounce)
  const configSaveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (configSaveTimeoutRef.current) {
      clearTimeout(configSaveTimeoutRef.current);
    }
    configSaveTimeoutRef.current = setTimeout(() => {
      saveShiftRequirementsConfig();
    }, 1000); // Save 1 second after last change
    
    return () => {
      if (configSaveTimeoutRef.current) {
        clearTimeout(configSaveTimeoutRef.current);
      }
    };
  }, [weekdayConfig, weekendConfig, fixedShiftsConfig, saveShiftRequirementsConfig]);

  // Apply fixed shifts to demands automatically when fixedShiftsConfig changes
  const applyFixedShiftsTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const isInitialLoadRef = React.useRef(true);
  const previousFixedShiftsRef = React.useRef(JSON.stringify(fixedShiftsConfig));
  
  useEffect(() => {
    // Skip on initial load (when monthDemands is empty or just loaded)
    if (isInitialLoadRef.current || !selectedYear || !selectedMonth || monthDemands.length === 0) {
      isInitialLoadRef.current = false;
      previousFixedShiftsRef.current = JSON.stringify(fixedShiftsConfig);
      return;
    }

    // Check if fixed shifts actually changed
    const currentFixedShiftsStr = JSON.stringify(fixedShiftsConfig);
    if (currentFixedShiftsStr === previousFixedShiftsRef.current) {
      return; // No change, skip
    }

    // Debounce the application of fixed shifts
    if (applyFixedShiftsTimeoutRef.current) {
      clearTimeout(applyFixedShiftsTimeoutRef.current);
    }

    applyFixedShiftsTimeoutRef.current = setTimeout(async () => {
      try {
        const previousFixedShifts: typeof fixedShiftsConfig = JSON.parse(previousFixedShiftsRef.current);
        previousFixedShiftsRef.current = currentFixedShiftsStr;

        // Create a copy of current demands
        const updatedDemands = monthDemands.map(demand => {
          const dateObj = new Date(demand.date);
          const jsWeekday = dateObj.getDay(); // 0 = Sunday, 6 = Saturday
          // Convert to our day format: 0 = Monday, 6 = Sunday
          const ourDay = jsWeekday === 0 ? 6 : jsWeekday - 1;
          
          // Initialize demand object with current values
          const updatedDemand: any = { ...demand };
          
          // Get all shift types that are in fixed shifts (current or previous)
          const allFixedShiftTypes = new Set([
            ...fixedShiftsConfig.map(f => f.shift),
            ...previousFixedShifts.map(f => f.shift)
          ]);
          
          // For each shift type that was or is in fixed shifts, recalculate based on current config
          allFixedShiftTypes.forEach(shiftType => {
            const needKey = `need_${shiftType}` as keyof typeof demand;
            let currentValue = (demand[needKey] as number) || 0;
            
            // Subtract previous fixed shifts for this day
            previousFixedShifts.forEach(prevFixed => {
              if (prevFixed.day === ourDay && prevFixed.shift === shiftType) {
                currentValue = Math.max(0, currentValue - prevFixed.count);
              }
            });
            
            // Add new fixed shifts for this day
            let newFixedCount = 0;
            fixedShiftsConfig.forEach(fixed => {
              if (fixed.day === ourDay && fixed.shift === shiftType) {
                newFixedCount += fixed.count;
              }
            });
            
            updatedDemand[needKey] = currentValue + newFixedCount;
          });
          
          return updatedDemand;
        });

        // Update UI immediately
        setMonthDemands(updatedDemands);

        // Save to backend
        const demandsWithoutHoliday = stripDayNames(updatedDemands.map(({ holiday, ...rest }) => rest));
        await saveDemandsToBackend(demandsWithoutHoliday);
        
        // Save to localStorage
        saveDemandsToLocalStorage(demandsWithoutHoliday);
        
        showToast({ 
          type: 'success', 
          message: '✅ Fixed shifts applied to staffing needs!' 
        });
      } catch (error) {
        console.error('Failed to apply fixed shifts:', error);
        showToast({ 
          type: 'error', 
          message: '⚠️ Failed to apply fixed shifts. Please try again.' 
        });
      }
    }, 500); // Apply 500ms after last change

    return () => {
      if (applyFixedShiftsTimeoutRef.current) {
        clearTimeout(applyFixedShiftsTimeoutRef.current);
      }
    };
  }, [fixedShiftsConfig, selectedYear, selectedMonth, monthDemands, showToast, saveDemandsToLocalStorage, saveDemandsToBackend]);

  const handleRegenerate = async () => {
    if (!selectedYear || !selectedMonth) return;
    
    setRegenerating(true);
    try {
      const { base_demand, weekend_demand } = buildBaseAndWeekendDemands();
      const response = await api.post('/api/data/demands/generate', {
        year: selectedYear,
        month: selectedMonth,
        base_demand,
        weekend_demand,
        fixed_shifts: fixedShiftsConfig,
      });
      
      // The generate endpoint already saves to backend, but explicitly save again to ensure it persists
      const generatedDemands = response.data.demands;
      
      // Explicitly save to backend to ensure it's persisted (even though generate already saves)
      try {
        await saveDemandsToBackend(generatedDemands);
      } catch (saveError) {
        console.error('Failed to save regenerated demands:', saveError);
        // Continue anyway since generate endpoint should have saved it
      }
      
      setMonthDemands(addDayNames(generatedDemands));
      
      // Save to localStorage to keep it in sync
      saveDemandsToLocalStorage(generatedDemands);
      
      // Save config after regenerating
      saveShiftRequirementsConfig();
      showToast({
        type: 'success',
        message: '✅ Month regenerated with custom settings!',
      });
    } catch (error) {
      console.error('Failed to regenerate:', error);
      showToast({ type: 'error', message: 'Failed to regenerate month' });
    } finally {
      setRegenerating(false);
    }
  };

  // Get date range based on selected period
  const getDateRange = () => {
    if (!selectedYear || !selectedMonth) return null;
    
    if (selectedYear === 2026 && (selectedMonth === 2 || selectedMonth === 3) && selectedPeriod) {
      if (selectedPeriod === 'pre-ramadan') {
        return { start: new Date('2026-02-01'), end: new Date('2026-02-18') };
      } else if (selectedPeriod === 'ramadan') {
        return { start: new Date('2026-02-19'), end: new Date('2026-03-19') };
      } else if (selectedPeriod === 'post-ramadan') {
        return { start: new Date('2026-03-20'), end: new Date('2026-03-31') };
      }
    }
    return null;
  };

  // Generate calendar grid
  const generateCalendarGrid = () => {
    if (!selectedYear || !selectedMonth || monthDemands.length === 0) return [];

    const dateRange = getDateRange();
    const firstDay = dateRange ? dateRange.start : new Date(selectedYear, selectedMonth - 1, 1);
    const lastDay = dateRange ? dateRange.end : new Date(selectedYear, selectedMonth, 0);
    
    // For cross-month periods, we need to handle multiple months
    const startMonth = firstDay.getMonth() + 1;
    const startYear = firstDay.getFullYear();
    const endMonth = lastDay.getMonth() + 1;
    const endYear = lastDay.getFullYear();
    
    const startWeekday = firstDay.getDay(); // 0 = Sunday
    const daysInRange = Math.ceil((lastDay.getTime() - firstDay.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const weeks: any[][] = [];
    let currentWeek: any[] = [];

    // Add empty cells for days before range starts
    for (let i = 0; i < startWeekday; i++) {
      currentWeek.push(null);
    }

    // Add days in the range
    let currentDate = new Date(firstDay);
    for (let i = 0; i < daysInRange; i++) {
      const day = currentDate.getDate();
      const month = currentDate.getMonth() + 1;
      const year = currentDate.getFullYear();
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      const demand = monthDemands.find(d => {
        const dDate = new Date(d.date);
        return dDate.toISOString().split('T')[0] === dateStr;
      });
      
      currentWeek.push({
        day,
        date: dateStr,
        demand: demand || null,
        month,
        year
      });

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Add empty cells for remaining days in last week
    while (currentWeek.length < 7 && currentWeek.length > 0) {
      currentWeek.push(null);
    }
    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
    }

    return weeks;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!selectedYear || !selectedMonth) {
    return (
      <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded">
        Please select both a year and month first.
      </div>
    );
  }

  const calendarWeeks = generateCalendarGrid();
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-xl font-bold text-gray-900">Staffing Needs</h3>
        <p className="text-gray-600">Set how many staff members are needed for each shift type on each day</p>
      </div>

      {monthDemands.length > 0 ? (
        <>
          {/* Calendar View */}
          <div className="bg-white rounded-lg border border-gray-200 p-3 mb-6">
            <div className="grid grid-cols-7 gap-1">
              {/* Day Headers */}
              {dayLabels.map(day => (
                <div key={day} className="text-center text-xs font-medium text-gray-600 py-1.5">
                  {day}
                </div>
              ))}

              {/* Calendar Days */}
              {calendarWeeks.map((week, weekIdx) => (
                <React.Fragment key={weekIdx}>
                  {week.map((dayData, dayIdx) => {
                    if (!dayData) {
                      return <div key={`empty-${dayIdx}`} className="min-h-[80px]"></div>;
                    }

                    const { day, date, demand } = dayData;
                    // In Oman: Weekends = Friday(5), Saturday(6)
                    // Use the actual date's weekday instead of array index
                    const dateObj = new Date(date);
                    const weekday = dateObj.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
                    const isWeekend = weekday === 5 || weekday === 6; // Friday or Saturday
                    const isToday = new Date().toDateString() === new Date(date).toDateString();

                    return (
                      <div
                        key={date}
                        className={`min-h-[100px] border border-gray-300 rounded p-1.5 ${
                          isWeekend ? 'bg-gray-50' : 'bg-white'
                        } ${isToday ? 'ring-1 ring-blue-400' : ''}`}
                      >
                        {/* Date and Holiday */}
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-medium ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>
                            {day}
                          </span>
                          <div className="flex items-center gap-0.5">
                            {demand?.holiday && (
                              <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1 py-0.5 rounded">
                                {demand.holiday}
                              </span>
                            )}
                            <button
                              onClick={() => {
                                setEditingHoliday(date);
                                setHolidayInput(demand?.holiday || '');
                              }}
                              className="text-[10px] text-gray-400 hover:text-gray-600 p-0.5 rounded hover:bg-gray-100"
                              title="Add/Edit Holiday"
                            >
                              {demand?.holiday ? '✏️' : '➕'}
                            </button>
                          </div>
                        </div>

                        {/* Holiday Input */}
                        {editingHoliday === date && (
                          <div className="mb-1 flex gap-0.5">
                            <input
                              type="text"
                              value={holidayInput}
                              onChange={(e) => setHolidayInput(e.target.value)}
                              onBlur={() => {
                                // Don't save if we're deleting (X button was clicked)
                                if (!deletingHolidayRef.current) {
                                  handleHolidayChange(date, holidayInput);
                                }
                                deletingHolidayRef.current = false;
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleHolidayChange(date, holidayInput);
                                } else if (e.key === 'Escape') {
                                  setEditingHoliday(null);
                                  setHolidayInput('');
                                }
                              }}
                              placeholder="Holiday"
                              className="flex-1 text-[10px] px-1 py-0.5 border border-gray-300 rounded"
                              autoFocus
                            />
                            <button
                              onMouseDown={(e) => {
                                e.preventDefault(); // Prevent input blur
                                e.stopPropagation();
                                deletingHolidayRef.current = true; // Mark that we're deleting
                              }}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                deletingHolidayRef.current = true;
                                handleHolidayChange(date, '');
                                setHolidayInput('');
                                setEditingHoliday(null);
                              }}
                              className="text-[10px] px-1 py-0.5 bg-red-100 text-red-700 rounded hover:bg-red-200"
                            >
                              ✕
                            </button>
                          </div>
                        )}

                        {/* Shift Needs Pills */}
                        <div className="flex flex-wrap gap-1 mb-1">
                          {(() => {
                            // Only show standard shifts (those with dedicated columns in demands)
                            // Filter to only those that have a demand value > 0
                            return STANDARD_SHIFT_CODES
                              .map(shiftCode => {
                                const columnName = shiftCodeToColumnName(shiftCode);
                                const needKey = `need_${columnName}` as keyof typeof demand;
                                const count = demand?.[needKey] as number || 0;
                                const color = getShiftColor(shiftCode);
                                const description = getShiftDescription(shiftCode);

                                if (count === 0) return null;

                                // Always use black text for better readability
                                const textColor = '#000000';
                                // Make color semi-transparent (60% opacity)
                                // Convert hex to rgba for proper transparency
                                const hexToRgba = (hex: string, alpha: number) => {
                                  const r = parseInt(hex.slice(1, 3), 16);
                                  const g = parseInt(hex.slice(3, 5), 16);
                                  const b = parseInt(hex.slice(5, 7), 16);
                                  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
                                };
                                const transparentColor = hexToRgba(color, 0.6);
                                
                                return (
                                  <div
                                    key={shiftCode}
                                    className="flex items-center gap-0 rounded text-[10px] shadow-sm hover:shadow transition-shadow overflow-hidden border border-gray-400"
                                    style={{
                                      backgroundColor: transparentColor,
                                    }}
                                  >
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const newValue = Math.max(0, count - 1);
                                        handleDemandChange(date, shiftCode, newValue);
                                      }}
                                      className="px-1 py-0.5 font-medium transition-opacity hover:opacity-80"
                                      style={{ color: textColor }}
                                      title="Decrease"
                                    >
                                      −
                                    </button>
                                    <div
                                      className="px-1 py-0.5 font-semibold"
                                      style={{
                                        color: textColor,
                                      }}
                                      title={description}
                                    >
                                      {count} {shiftCode}
                                    </div>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const newValue = count + 1;
                                        if (newValue <= 20) {
                                          handleDemandChange(date, shiftCode, newValue);
                                        }
                                      }}
                                      className="px-1 py-0.5 font-medium transition-opacity hover:opacity-80"
                                      style={{ color: textColor }}
                                      title="Increase"
                                    >
                                      +
                                    </button>
                                  </div>
                                );
                              });
                          })()}
                        </div>

                        {/* Add Missing Shift Button */}
                        {(() => {
                          // Only show standard shift types (those with dedicated columns in demands)
                          // Exclude "O" which is not a demand type
                          // DO is a leave type (not in STANDARD_SHIFT_CODES), so no need to filter it
                          const availableShiftTypes = STANDARD_SHIFT_CODES.filter(
                            code => code !== 'O'
                          );
                          
                          // Check if there are any shift types not currently present
                          const hasMissingShifts = availableShiftTypes.some(shiftCode => {
                            const columnName = shiftCodeToColumnName(shiftCode);
                            const needKey = `need_${columnName}` as keyof typeof demand;
                            return (demand?.[needKey] as number || 0) === 0;
                          });
                          
                          return hasMissingShifts && (
                            <div className="relative shift-dropdown-container mt-1">
                              <button
                                onClick={() => {
                                  setAddingShift(addingShift === date ? null : date);
                                }}
                                className="text-[10px] text-gray-400 hover:text-gray-600 px-1 py-0.5 rounded border border-dashed border-gray-300 hover:border-gray-400 w-full transition-colors"
                              >
                                + Add
                              </button>
                              {addingShift === date && (
                                <div className="absolute z-10 mt-0.5 w-full bg-white border border-gray-200 rounded shadow-lg p-1 max-h-32 overflow-y-auto">
                                  {availableShiftTypes
                                    .filter(shiftCode => {
                                      const columnName = shiftCodeToColumnName(shiftCode);
                                      const needKey = `need_${columnName}` as keyof typeof demand;
                                      return (demand?.[needKey] as number || 0) === 0;
                                    })
                                    .map(shiftCode => {
                                      const color = getShiftColor(shiftCode);
                                      const description = getShiftDescription(shiftCode);
                                      return (
                                        <button
                                          key={shiftCode}
                                          onClick={() => {
                                            handleDemandChange(date, shiftCode, 1);
                                            setAddingShift(null);
                                          }}
                                          className="w-full text-left px-1.5 py-1 text-[10px] hover:bg-gray-100 rounded flex items-center gap-1.5"
                                        >
                                          <div
                                            className="w-2.5 h-2.5 rounded border"
                                            style={{ backgroundColor: `${color}80`, borderColor: color }}
                                          />
                                          <span className="font-medium">{shiftCode}</span>
                                          <span className="text-gray-500">{description}</span>
                                        </button>
                                      );
                                    })}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Configuration Tables */}
          <div className="mt-8 border-t border-gray-200 pt-6">
            <h4 className="text-lg font-bold text-gray-900 mb-4">Shift Requirements</h4>
            
            <div className="space-y-6 mb-6">
              {/* Each Weekday */}
              <div>
                <h5 className="font-semibold text-gray-700 mb-3">Each Weekday</h5>
                <div className="flex flex-wrap gap-2">
                  {weekdayConfig.map((row, idx) => {
                    const shiftColor = getShiftColor(row.Shift);
                    const description = getShiftDescription(row.Shift);
                    return (
                      <div
                        key={idx}
                        className="flex flex-col items-center gap-1.5"
                      >
                        <div
                          className="w-8 h-8 rounded-lg shadow-sm flex items-center justify-center text-black font-semibold text-xs border border-gray-400 transition-transform hover:scale-105"
                          style={{ backgroundColor: shiftColor }}
                          title={description}
                        >
                          {row.Shift}
                        </div>
                        <div className="flex items-center gap-1 bg-white rounded-md border border-gray-200 px-1 py-0.5 shadow-sm">
                          <button
                            onClick={() => {
                              const newConfig = [...weekdayConfig];
                              newConfig[idx] = { ...newConfig[idx], Count: Math.max(0, row.Count - 1) };
                              setWeekdayConfig(newConfig);
                            }}
                            className="w-4 h-4 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors text-[10px]"
                            title="Decrease"
                          >
                            −
                          </button>
                          <span className="text-[10px] font-semibold text-gray-900 min-w-[1.25rem] text-center">
                            {row.Count}
                          </span>
                          <button
                            onClick={() => {
                              const newConfig = [...weekdayConfig];
                              newConfig[idx] = { ...newConfig[idx], Count: Math.min(20, row.Count + 1) };
                              setWeekdayConfig(newConfig);
                            }}
                            className="w-4 h-4 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors text-[10px]"
                            title="Increase"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Each Weekend Day */}
              <div>
                <h5 className="font-semibold text-gray-700 mb-3">Each Weekend Day</h5>
                <div className="flex flex-wrap gap-2">
                  {weekendConfig.map((row, idx) => {
                    const shiftColor = getShiftColor(row.Shift);
                    const description = getShiftDescription(row.Shift);
                    return (
                      <div
                        key={idx}
                        className="flex flex-col items-center gap-1.5"
                      >
                        <div
                          className="w-8 h-8 rounded-lg shadow-sm flex items-center justify-center text-black font-semibold text-xs border border-gray-400 transition-transform hover:scale-105"
                          style={{ backgroundColor: shiftColor }}
                          title={description}
                        >
                          {row.Shift}
                        </div>
                        <div className="flex items-center gap-1 bg-white rounded-md border border-gray-200 px-1 py-0.5 shadow-sm">
                          <button
                            onClick={() => {
                              const newConfig = [...weekendConfig];
                              newConfig[idx] = { ...newConfig[idx], Count: Math.max(0, row.Count - 1) };
                              setWeekendConfig(newConfig);
                            }}
                            className="w-4 h-4 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors text-[10px]"
                            title="Decrease"
                          >
                            −
                          </button>
                          <span className="text-[10px] font-semibold text-gray-900 min-w-[1.25rem] text-center">
                            {row.Count}
                          </span>
                          <button
                            onClick={() => {
                              const newConfig = [...weekendConfig];
                              newConfig[idx] = { ...newConfig[idx], Count: Math.min(20, row.Count + 1) };
                              setWeekendConfig(newConfig);
                            }}
                            className="w-4 h-4 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors text-[10px]"
                            title="Increase"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Fixed Shifts */}
              <div>
                <h5 className="font-semibold text-gray-700 mb-3">Fixed Shifts</h5>
                <div className="flex flex-wrap gap-2">
                  {/* Fixed shifts (including M+P and P which are editable) */}
                  {([...fixedShiftsConfig].sort((a, b) => {
                    const diff = getFixedShiftSortKey(a.shift) - getFixedShiftSortKey(b.shift);
                    if (diff !== 0) return diff;
                    return (a.day ?? 0) - (b.day ?? 0);
                  })).map((fixed, idx) => {
                    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                    const shiftColor = getShiftColor(fixed.shift);
                    const description = getShiftDescription(fixed.shift);
                    return (
                      <div key={idx} className="flex flex-col items-center gap-1.5 relative">
                        {/* Shift square - clickable to show options */}
                        <div className="relative fixed-shift-options-container">
                          <div
                            onClick={() => {
                              setShowingShiftOptions(showingShiftOptions === idx ? null : idx);
                            }}
                            className="w-8 h-8 rounded-lg shadow-sm flex items-center justify-center text-black font-semibold text-xs border border-gray-400 transition-transform hover:scale-105 cursor-pointer"
                            style={{ backgroundColor: shiftColor }}
                            title={`${description} - Click to change shift`}
                          >
                            {fixed.shift}
                          </div>
                          {/* Shift options dropdown */}
                          {showingShiftOptions === idx && (
                            <div className="absolute z-10 mt-1 left-0 bg-white border border-gray-200 rounded shadow-lg p-1 min-w-[8rem] max-h-32 overflow-y-auto">
                              {/* Only show standard shift codes, exclude O. DO is a leave type (not in STANDARD_SHIFT_CODES), so no need to filter it */}
                              {STANDARD_SHIFT_CODES.filter(code => code !== 'O').map(code => {
                                const codeColor = getShiftColor(code);
                                const codeDescription = getShiftDescription(code);
                                return (
                                  <button
                                    key={code}
                                    onClick={() => {
                                      const newConfig = [...fixedShiftsConfig];
                                      newConfig[idx] = { ...newConfig[idx], shift: code };
                                      setFixedShiftsConfig(newConfig);
                                      setShowingShiftOptions(null);
                                    }}
                                    className="w-full text-left px-2 py-1 text-[10px] hover:bg-gray-100 rounded flex items-center gap-1.5"
                                  >
                                    <div
                                      className="w-4 h-4 rounded border"
                                      style={{ backgroundColor: `${codeColor}80`, borderColor: codeColor }}
                                    />
                                    <span className="font-medium">{code}</span>
                                    <span className="text-gray-500 text-[9px]">{codeDescription}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        {/* Day selector - clickable dropdown (or special display for P) */}
                        {fixed.day === -1 ? (
                          <div className="text-[11px] font-semibold text-gray-900 bg-white rounded-md border border-gray-200 px-1 py-0.5 shadow-sm mt-0.5">
                            1st-3rd
                          </div>
                        ) : (
                          <div className="relative">
                            <select
                              value={fixed.day}
                              onChange={(e) => {
                                const newConfig = [...fixedShiftsConfig];
                                newConfig[idx] = { ...newConfig[idx], day: parseInt(e.target.value) };
                                setFixedShiftsConfig(newConfig);
                              }}
                              onFocus={() => setEditingFixedShiftDay(idx)}
                              onBlur={() => setEditingFixedShiftDay(null)}
                              className="text-[10px] font-semibold text-gray-900 bg-white rounded-md border border-gray-200 px-1 py-0.5 shadow-sm cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary-500 appearance-none pr-5"
                            >
                              {dayNames
                                .map((name, dayIdx) => ({ name, dayIdx }))
                                .filter(({ dayIdx }) => {
                                  // Include current day or days that don't already have this shift type (excluding current entry)
                                  return dayIdx === fixed.day || !fixedShiftsConfig.some(
                                    (f, i) => i !== idx && f.shift === fixed.shift && f.day === dayIdx
                                  );
                                })
                                .map(({ name, dayIdx }) => (
                                  <option key={dayIdx} value={dayIdx}>
                                    {name}
                                  </option>
                                ))}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1">
                              <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </div>
                        )}
                        {/* Count - with +/- buttons like weekday/weekend */}
                        <div className="flex items-center gap-1 bg-white rounded-md border border-gray-200 px-1 py-0.5 shadow-sm">
                          <button
                            onClick={() => {
                              const newConfig = [...fixedShiftsConfig];
                              const newCount = Math.max(0, fixed.count - 1);
                              if (newCount === 0 && fixed.day !== -1) {
                                // Remove fixed shift if count becomes 0 and it has a day selector (not P)
                                setFixedShiftsConfig(newConfig.filter((_, i) => i !== idx));
                              } else {
                                newConfig[idx] = { ...newConfig[idx], count: newCount };
                                setFixedShiftsConfig(newConfig);
                              }
                            }}
                            className="w-4 h-4 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors text-[10px]"
                            title="Decrease"
                          >
                            −
                          </button>
                          <span className="text-[10px] font-semibold text-gray-900 min-w-[1.25rem] text-center">
                            {fixed.count}
                          </span>
                          <button
                            onClick={() => {
                              const newConfig = [...fixedShiftsConfig];
                              newConfig[idx] = { ...newConfig[idx], count: Math.min(totalEmployees, fixed.count + 1) };
                              setFixedShiftsConfig(newConfig);
                            }}
                            className="w-4 h-4 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors text-[10px]"
                            title="Increase"
                          >
                            +
                          </button>
                        </div>
                        {/* Delete button removed - fixed shifts cannot be deleted */}
                      </div>
                    );
                  })}
                  {/* Add button - square with plus sign */}
                  <div
                    onClick={() => {
                      // Find first available day for the default shift type (H)
                      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                      const usedDaysForH = new Set(
                        fixedShiftsConfig.filter(f => f.shift === 'H').map(f => f.day)
                      );
                      let firstAvailableDay = 0;
                      for (let day = 0; day < 7; day++) {
                        if (!usedDaysForH.has(day)) {
                          firstAvailableDay = day;
                          break;
                        }
                      }
                      // If all days are used, default to 0 anyway
                      setFixedShiftsConfig([...fixedShiftsConfig, { shift: 'H', day: firstAvailableDay, count: 1 }]);
                    }}
                    className="flex flex-col items-center gap-1.5 cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg shadow-sm flex items-center justify-center text-gray-400 border-2 border-dashed border-gray-300 hover:border-gray-400 hover:text-gray-600 transition-colors">
                      <span className="text-lg font-bold">+</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Regenerate and Reset Buttons */}
            <div className="flex justify-start gap-3 mt-6">
              <button
                onClick={handleResetDefaults}
                className="px-6 py-3 bg-gray-200 text-gray-700 font-bold rounded-lg hover:bg-gray-300"
              >
                Reset to Defaults
              </button>
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="px-6 py-3 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {regenerating ? 'Regenerating...' : 'Regenerate Month'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
          <div className="flex items-center justify-between">
            <span>
              No demands data available for {monthNames[selectedMonth - 1]} {selectedYear}.
            </span>
            <button
              onClick={async () => {
                if (!selectedYear || !selectedMonth) return;
                try {
                  setLoading(true);
                  const { base_demand, weekend_demand } = buildBaseAndWeekendDemands();
                  const response = await api.post('/api/data/demands/generate', {
                    year: selectedYear,
                    month: selectedMonth,
                    base_demand,
                    weekend_demand,
                    fixed_shifts: fixedShiftsConfig,
                  });
                  const generatedDemands = response.data.demands;
                  // Save to database
                  await api.post(`/api/data/demands/month/${selectedYear}/${selectedMonth}`, generatedDemands);
                  // Reload demands
                  await loadMonthDemands();
                  showToast({ message: 'Demands generated successfully!', type: 'success' });
                } catch (error: any) {
                  console.error('Failed to generate demands:', error);
                  showToast({ message: error.response?.data?.detail || 'Failed to generate demands', type: 'error' });
                } finally {
                  setLoading(false);
                }
              }}
              className="ml-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              disabled={loading || !selectedYear || !selectedMonth}
            >
              {loading ? 'Generating...' : 'Generate Demands'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Helper function to determine text color based on background
const getContrastColor = (hexColor: string): string => {
  const sanitized = hexColor.replace('#', '');
  if (![3, 6].includes(sanitized.length)) return '#000000';

  const fullHex =
    sanitized.length === 3
      ? sanitized
          .split('')
          .map((char) => char + char)
          .join('')
      : sanitized;

  const num = parseInt(fullHex, 16);
  if (Number.isNaN(num)) return '#000000';

  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;

  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
};
