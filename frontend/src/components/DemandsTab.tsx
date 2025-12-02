import React, { useState, useEffect, useCallback, useRef } from 'react';
import { EditableTable } from './EditableTable';
import { useToast } from '../contexts/ToastContext';
import { shiftTypesAPI, ShiftType } from '../services/api';
import api from '../services/api';
import { shiftColors as defaultShiftColors } from '../utils/shiftColors';

interface DemandsTabProps {
  selectedYear: number | null;
  selectedMonth: number | null;
  monthNames: string[];
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

export const DemandsTab: React.FC<DemandsTabProps> = ({ selectedYear, selectedMonth, monthNames }) => {
  const [monthDemands, setMonthDemands] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [editingHoliday, setEditingHoliday] = useState<string | null>(null);
  const [holidayInput, setHolidayInput] = useState<string>('');
  const [addingShift, setAddingShift] = useState<string | null>(null); // date for which we're adding a shift
  const [weekdayConfig, setWeekdayConfig] = useState([
    { Shift: 'M', Count: 6 },
    { Shift: 'IP', Count: 3 },
    { Shift: 'A', Count: 1 },
    { Shift: 'N', Count: 1 },
    { Shift: 'M3', Count: 1 },
    { Shift: 'M4', Count: 1 },
    { Shift: 'CL', Count: 2 },
  ]);
  const [weekendConfig, setWeekendConfig] = useState([
    { Shift: 'A', Count: 1 },
    { Shift: 'N', Count: 1 },
    { Shift: 'M3', Count: 1 },
  ]);
  // H shifts are now fixed: 2 on Monday, 2 on Wednesday (not configurable)
  // Removed haratConfig since H is no longer editable
  const [regenerating, setRegenerating] = useState(false);
  const { showToast } = useToast();

  // Load shift types to get colors
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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addingShift && !(event.target as Element).closest('.shift-dropdown-container')) {
        setAddingShift(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [addingShift]);

  // Balanced color palette - medium saturation, pleasant and readable
  const harmoniousColors: Record<string, string> = {
    'M': '#7DD3FC',   // Sky blue
    'IP': '#38BDF8',   // Light blue
    'A': '#FB923C',   // Orange
    'N': '#FACC15',   // Yellow
    'M3': '#4ADE80',   // Green
    'M4': '#34D399',   // Emerald
    'H': '#F472B6',   // Pink
    'CL': '#A78BFA',   // Violet
  };

  // Get shift color from database or fallback to harmonious palette
  const getShiftColor = (shiftCode: string): string => {
    // Use harmonious colors for better visual appeal
    if (harmoniousColors[shiftCode]) {
      return harmoniousColors[shiftCode];
    }
    const shiftType = shiftTypes.find(st => st.code === shiftCode);
    if (shiftType) {
      return shiftType.color_hex || defaultShiftColors[shiftCode] || '#FFFFFF';
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

  const generateDefaults = useCallback(async (year: number, month: number) => {
    const base_demand = {
      'M': 6, 'IP': 3, 'A': 1, 'N': 1, 'M3': 1, 'M4': 1, 'CL': 2 // H: Fixed to 2 on Monday and Wednesday (not configurable)
    };
    const weekend_demand = {
      'M': 0, 'IP': 0, 'A': 1, 'N': 1, 'M3': 1, 'M4': 0, 'CL': 0
    };
    
    try {
      const response = await api.post('/api/data/demands/generate', {
        year,
        month,
        base_demand,
        weekend_demand,
      });
      setMonthDemands(addDayNames(response.data.demands));
    } catch (error) {
      console.error('Failed to generate defaults:', error);
    }
  }, []);

  // Cleanup timeout on unmount (no longer needed since we save immediately, but keep for safety)
  useEffect(() => {
    return () => {
      if (demandSaveTimeoutRef.current) {
        clearTimeout(demandSaveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedYear || !selectedMonth) {
      setLoading(false);
      return;
    }
    
    const loadMonthDemands = async () => {
      try {
        setLoading(true);
        
        // First, check localStorage for recent changes
        const localBackup = loadDemandsFromLocalStorage();
        const localTimestamp = localBackup?.timestamp || 0;
        const now = Date.now();
        const isLocalRecent = localTimestamp > 0 && (now - localTimestamp) < 300000; // 5 minutes
        
        // Load from backend
        let backendDemands: any[] = [];
        let backendTimestamp = 0;
        try {
          const response = await api.get(`/api/data/demands/month/${selectedYear}/${selectedMonth}`);
          backendDemands = response.data || [];
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
    };
    
    loadMonthDemands();
  }, [selectedYear, selectedMonth, generateDefaults]);

  const handleResetDefaults = async () => {
    if (!selectedYear || !selectedMonth) return;
    setLoading(true);
    // Reset weekday config table to defaults
    setWeekdayConfig([
      { Shift: 'M', Count: 6 },
      { Shift: 'IP', Count: 3 },
      { Shift: 'A', Count: 1 },
      { Shift: 'N', Count: 1 },
      { Shift: 'M3', Count: 1 },
      { Shift: 'M4', Count: 1 },
      { Shift: 'CL', Count: 2 },
    ]);
    await generateDefaults(selectedYear, selectedMonth);
    setLoading(false);
  };

  // Debounce timer for saving demands
  const demandSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    
    const updatedDemands = monthDemands.map(demand => {
      if (demand.date === date) {
        return {
          ...demand,
          [`need_${shiftCode}`]: value
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
      await api.post(`/api/data/demands/month/${selectedYear}/${selectedMonth}`, demandsWithoutHoliday);
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
    
    // Update local state for UI
    const updatedDemands = monthDemands.map(demand => {
      if (demand.date === date) {
        return {
          ...demand,
          holiday: holiday
        };
      }
      return demand;
    });
    
    setMonthDemands(updatedDemands);
    setEditingHoliday(null);
    
    // Save holidays separately (not in demands)
    try {
      // Build holidays object from current demands
      const holidays: Record<string, string> = {};
      updatedDemands.forEach(demand => {
        if (demand.holiday && demand.holiday.trim()) {
          holidays[demand.date] = demand.holiday.trim();
        }
      });
      
      // Save holidays separately
      await api.post(`/api/data/holidays/month/${selectedYear}/${selectedMonth}`, holidays);
      
      // Also update demands (without holiday column) to ensure consistency
      const demandsWithoutHoliday = stripDayNames(updatedDemands.map(({ holiday, ...rest }) => rest));
      await api.post(`/api/data/demands/month/${selectedYear}/${selectedMonth}`, demandsWithoutHoliday);
      
      showToast({ type: 'success', message: '✅ Holiday saved!' });
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
      // H shifts are fixed (2 on Mon, 2 on Wed) - not saved in config
    };
    localStorage.setItem(configKey, JSON.stringify(config));
  }, [selectedYear, selectedMonth, weekdayConfig, weekendConfig]);

  // Load shift requirements configuration from localStorage
  const loadShiftRequirementsConfig = useCallback(() => {
    if (!selectedYear || !selectedMonth) return;
    const configKey = `shift_requirements_${selectedYear}_${selectedMonth}`;
    const saved = localStorage.getItem(configKey);
    if (saved) {
      try {
        const config = JSON.parse(saved);
        if (config.weekday) setWeekdayConfig(config.weekday);
        if (config.weekend) setWeekendConfig(config.weekend);
        // H shifts are fixed (2 on Mon, 2 on Wed) - not loaded from config
      } catch (error) {
        console.error('Failed to load shift requirements config:', error);
      }
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
  }, [weekdayConfig, weekendConfig, saveShiftRequirementsConfig]);

  const handleRegenerate = async () => {
    if (!selectedYear || !selectedMonth) return;
    
    setRegenerating(true);
    try {
      const base_demand: any = {
        'M': 0, 'IP': 0, 'A': 0, 'N': 0, 'M3': 0, 'M4': 0, 'H': 0, 'CL': 0
      };
      const weekend_demand: any = {
        'M': 0, 'IP': 0, 'A': 0, 'N': 0, 'M3': 0, 'M4': 0, 'H': 0, 'CL': 0
      };
      
      // Extract values from configs
      weekdayConfig.forEach(item => {
        // H shifts are fixed (2 on Mon, 2 on Wed) - not from config
        if (item.Shift !== 'H') {
          base_demand[item.Shift] = item.Count;
        }
      });
      // H shifts are fixed: 2 on Monday, 2 on Wednesday (handled in backend)
      
      weekendConfig.forEach(item => {
        weekend_demand[item.Shift] = item.Count;
      });
      
      const response = await api.post('/api/data/demands/generate', {
        year: selectedYear,
        month: selectedMonth,
        base_demand,
        weekend_demand,
      });
      
      // The generate endpoint already saves to backend, but explicitly save again to ensure it persists
      const generatedDemands = response.data.demands;
      
      // Explicitly save to backend to ensure it's persisted (even though generate already saves)
      try {
        await api.post(`/api/data/demands/month/${selectedYear}/${selectedMonth}`, generatedDemands);
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

  // Generate calendar grid
  const generateCalendarGrid = () => {
    if (!selectedYear || !selectedMonth || monthDemands.length === 0) return [];

    const firstDay = new Date(selectedYear, selectedMonth - 1, 1);
    const lastDay = new Date(selectedYear, selectedMonth, 0);
    const daysInMonth = lastDay.getDate();
    const startWeekday = firstDay.getDay(); // 0 = Sunday

    const weeks: any[][] = [];
    let currentWeek: any[] = [];

    // Add empty cells for days before month starts
    for (let i = 0; i < startWeekday; i++) {
      currentWeek.push(null);
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const demand = monthDemands.find(d => {
        const dDate = new Date(d.date);
        return dDate.getDate() === day && dDate.getMonth() === selectedMonth - 1;
      });
      
      currentWeek.push({
        day,
        date: dateStr,
        demand: demand || null
      });

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
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
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-xl font-bold text-gray-900">📋 Staffing Needs</h3>
          <p className="text-gray-600">Set how many staff members are needed for each shift type on each day</p>
        </div>
        <button
          onClick={handleResetDefaults}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
        >
          🔄 Reset to Defaults
        </button>
      </div>

      {monthDemands.length > 0 ? (
        <>
          {/* Calendar View */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-4 mb-6">
            <div className="grid grid-cols-7 gap-2">
              {/* Day Headers */}
              {dayLabels.map(day => (
                <div key={day} className="text-center text-sm font-semibold text-gray-700 py-2">
                  {day}
                </div>
              ))}

              {/* Calendar Days */}
              {calendarWeeks.map((week, weekIdx) => (
                <React.Fragment key={weekIdx}>
                  {week.map((dayData, dayIdx) => {
                    if (!dayData) {
                      return <div key={`empty-${dayIdx}`} className="min-h-[120px]"></div>;
                    }

                    const { day, date, demand } = dayData;
                    const isWeekend = dayIdx === 0 || dayIdx === 6; // Sunday or Saturday
                    const isToday = new Date().toDateString() === new Date(date).toDateString();

                    return (
                      <div
                        key={date}
                        className={`min-h-[140px] border border-gray-200 rounded-lg p-2.5 ${
                          isWeekend ? 'bg-gray-50/50' : 'bg-white'
                        } ${isToday ? 'ring-2 ring-primary-400 ring-opacity-50' : ''}`}
                      >
                        {/* Date and Holiday */}
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-sm font-semibold ${isToday ? 'text-primary-600' : 'text-gray-900'}`}>
                            {day}
                          </span>
                          <div className="flex items-center gap-1">
                            {demand?.holiday && (
                              <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
                                {demand.holiday}
                              </span>
                            )}
                            <button
                              onClick={() => {
                                setEditingHoliday(date);
                                setHolidayInput(demand?.holiday || '');
                              }}
                              className="text-xs text-gray-500 hover:text-gray-700 p-1 rounded hover:bg-gray-100"
                              title="Add/Edit Holiday"
                            >
                              {demand?.holiday ? '✏️' : '➕'}
                            </button>
                          </div>
                        </div>

                        {/* Holiday Input */}
                        {editingHoliday === date && (
                          <div className="mb-2 flex gap-1">
                            <input
                              type="text"
                              value={holidayInput}
                              onChange={(e) => setHolidayInput(e.target.value)}
                              onBlur={() => {
                                handleHolidayChange(date, holidayInput);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleHolidayChange(date, holidayInput);
                                } else if (e.key === 'Escape') {
                                  setEditingHoliday(null);
                                  setHolidayInput('');
                                }
                              }}
                              placeholder="Holiday name"
                              className="flex-1 text-xs px-2 py-1 border border-gray-300 rounded"
                              autoFocus
                            />
                            <button
                              onClick={() => {
                                handleHolidayChange(date, '');
                                setHolidayInput('');
                              }}
                              className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200"
                            >
                              ✕
                            </button>
                          </div>
                        )}

                        {/* Shift Needs Pills */}
                        <div className="flex flex-wrap gap-1.5 mb-1">
                          {SHIFT_CODES.map(shiftCode => {
                            const needKey = `need_${shiftCode}` as keyof typeof demand;
                            const count = demand?.[needKey] as number || 0;
                            const color = getShiftColor(shiftCode);
                            const description = getShiftDescription(shiftCode);

                            if (count === 0) return null;

                            // Always use black text for better readability
                            const textColor = '#000000';
                            // Make color semi-transparent (60% opacity) with softer, more appealing colors
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
                                className="flex items-center gap-0 rounded-md shadow-sm hover:shadow transition-shadow overflow-hidden"
                                style={{
                                  backgroundColor: transparentColor,
                                  border: `1px solid ${color}`,
                                }}
                              >
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const newValue = Math.max(0, count - 1);
                                    handleDemandChange(date, shiftCode, newValue);
                                  }}
                                  className="px-1.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80"
                                  style={{ color: textColor }}
                                  title="Decrease"
                                >
                                  −
                                </button>
                                <div
                                  className="px-2 py-0.5 text-xs font-semibold"
                                  style={{
                                    color: textColor,
                                  }}
                                  title={description}
                                >
                                  {shiftCode} {count}
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const newValue = count + 1;
                                    if (newValue <= 20) {
                                      handleDemandChange(date, shiftCode, newValue);
                                    }
                                  }}
                                  className="px-1.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80"
                                  style={{ color: textColor }}
                                  title="Increase"
                                >
                                  +
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        {/* Add Missing Shift Button */}
                        {SHIFT_CODES.some(shiftCode => {
                          const needKey = `need_${shiftCode}` as keyof typeof demand;
                          return (demand?.[needKey] as number || 0) === 0;
                        }) && (
                          <div className="relative shift-dropdown-container">
                            <button
                              onClick={() => {
                                setAddingShift(addingShift === date ? null : date);
                              }}
                              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded border border-dashed border-gray-300 hover:border-gray-400 w-full transition-colors"
                            >
                              + Add shift
                            </button>
                            {addingShift === date && (
                              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg p-1 max-h-32 overflow-y-auto">
                                {SHIFT_CODES.filter(shiftCode => {
                                  const needKey = `need_${shiftCode}` as keyof typeof demand;
                                  return (demand?.[needKey] as number || 0) === 0;
                                }).map(shiftCode => {
                                  const color = getShiftColor(shiftCode);
                                  const description = getShiftDescription(shiftCode);
                                  return (
                                    <button
                                      key={shiftCode}
                                      onClick={() => {
                                        handleDemandChange(date, shiftCode, 1);
                                        setAddingShift(null);
                                      }}
                                      className="w-full text-left px-2 py-1.5 text-xs hover:bg-gray-100 rounded flex items-center gap-2"
                                    >
                                      <div
                                        className="w-3 h-3 rounded border"
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
                        )}
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
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              {/* Each Weekday */}
              <div>
                <h5 className="font-semibold text-gray-700 mb-2">Each Weekday</h5>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 border-b border-gray-200">Shift</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 border-b border-gray-200">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weekdayConfig.map((row, idx) => {
                        const shiftColor = getShiftColor(row.Shift);
                        const hexToRgba = (hex: string, alpha: number) => {
                          const r = parseInt(hex.slice(1, 3), 16);
                          const g = parseInt(hex.slice(3, 5), 16);
                          const b = parseInt(hex.slice(5, 7), 16);
                          return `rgba(${r}, ${g}, ${b}, ${alpha})`;
                        };
                        return (
                          <tr key={idx} className="border-b border-gray-100">
                            <td className="px-3 py-2 text-sm font-medium" style={{ backgroundColor: hexToRgba(shiftColor, 0.2) }}>
                              {row.Shift}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                value={row.Count}
                                onChange={(e) => {
                                  const newConfig = [...weekdayConfig];
                                  newConfig[idx] = { ...newConfig[idx], Count: parseInt(e.target.value) || 0 };
                                  setWeekdayConfig(newConfig);
                                }}
                                min={0}
                                max={20}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-center"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Each Weekend Day */}
              <div>
                <h5 className="font-semibold text-gray-700 mb-2">Each Weekend Day</h5>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 border-b border-gray-200">Shift</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 border-b border-gray-200">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weekendConfig.map((row, idx) => {
                        const shiftColor = getShiftColor(row.Shift);
                        const hexToRgba = (hex: string, alpha: number) => {
                          const r = parseInt(hex.slice(1, 3), 16);
                          const g = parseInt(hex.slice(3, 5), 16);
                          const b = parseInt(hex.slice(5, 7), 16);
                          return `rgba(${r}, ${g}, ${b}, ${alpha})`;
                        };
                        return (
                          <tr key={idx} className="border-b border-gray-100">
                            <td className="px-3 py-2 text-sm font-medium" style={{ backgroundColor: hexToRgba(shiftColor, 0.2) }}>
                              {row.Shift}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                value={row.Count}
                                onChange={(e) => {
                                  const newConfig = [...weekendConfig];
                                  newConfig[idx] = { ...newConfig[idx], Count: parseInt(e.target.value) || 0 };
                                  setWeekendConfig(newConfig);
                                }}
                                min={0}
                                max={20}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-center"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* H Shifts (Fixed) */}
              <div>
                <h5 className="font-semibold text-gray-700 mb-2">H Shifts (Fixed)</h5>
                <p className="text-xs text-gray-500 mb-2">
                  H shifts are fixed: 1 shift on Monday, 1 shift on Wednesday (not configurable)
                </p>
                <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 border-b border-gray-200">Day</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 border-b border-gray-200">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-100">
                        <td className="px-3 py-2 text-sm font-medium" style={{ backgroundColor: 'rgba(244, 114, 182, 0.2)' }}>
                          Monday
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-600">1</td>
                      </tr>
                      <tr className="border-b border-gray-100">
                        <td className="px-3 py-2 text-sm font-medium" style={{ backgroundColor: 'rgba(244, 114, 182, 0.2)' }}>
                          Wednesday
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-600">1</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Regenerate Button */}
            <div className="flex justify-start">
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
          No demands data available for {monthNames[selectedMonth - 1]} {selectedYear}. Generating defaults...
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
