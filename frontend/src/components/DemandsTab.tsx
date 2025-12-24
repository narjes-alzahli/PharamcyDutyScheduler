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

  // Get shift color from database or fallback to default colors
  const getShiftColor = (shiftCode: string): string => {
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
                    const isWeekend = dayIdx === 0 || dayIdx === 6; // Sunday or Saturday
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
                              placeholder="Holiday"
                              className="flex-1 text-[10px] px-1 py-0.5 border border-gray-300 rounded"
                              autoFocus
                            />
                            <button
                              onClick={() => {
                                handleHolidayChange(date, '');
                                setHolidayInput('');
                              }}
                              className="text-[10px] px-1 py-0.5 bg-red-100 text-red-700 rounded hover:bg-red-200"
                            >
                              ✕
                            </button>
                          </div>
                        )}

                        {/* Shift Needs Pills */}
                        <div className="flex flex-wrap gap-1 mb-1">
                          {SHIFT_CODES.map(shiftCode => {
                            const needKey = `need_${shiftCode}` as keyof typeof demand;
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
                          })}
                        </div>

                        {/* Add Missing Shift Button */}
                        {SHIFT_CODES.some(shiftCode => {
                          const needKey = `need_${shiftCode}` as keyof typeof demand;
                          return (demand?.[needKey] as number || 0) === 0;
                        }) && (
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

              {/* H Shifts (Fixed) */}
              <div>
                <h5 className="font-semibold text-gray-700 mb-3">H Shifts (Fixed)</h5>
                <div className="flex flex-wrap gap-2">
                  <div className="flex flex-col items-center gap-1.5">
                    <div
                      className="w-8 h-8 rounded-lg shadow-sm flex items-center justify-center text-black font-semibold text-xs border border-gray-400"
                      style={{ backgroundColor: getShiftColor('H') }}
                      title="H Shift - Monday"
                    >
                      H
                    </div>
                    <div className="flex items-center gap-1.5 bg-gray-50 rounded-md border border-gray-200 px-1.5 py-0.5">
                      <span className="text-xs text-gray-500">Mon</span>
                      <span className="text-xs font-semibold text-gray-600">1</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-1.5">
                    <div
                      className="w-8 h-8 rounded-lg shadow-sm flex items-center justify-center text-black font-semibold text-xs border border-gray-400"
                      style={{ backgroundColor: getShiftColor('H') }}
                      title="H Shift - Wednesday"
                    >
                      H
                    </div>
                    <div className="flex items-center gap-1.5 bg-gray-50 rounded-md border border-gray-200 px-1.5 py-0.5">
                      <span className="text-xs text-gray-500">Wed</span>
                      <span className="text-xs font-semibold text-gray-600">1</span>
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
