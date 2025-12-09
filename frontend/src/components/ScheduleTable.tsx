import React, { useState, useEffect } from 'react';
import { shiftColors as defaultShiftColors } from '../utils/shiftColors';
import { leaveTypesAPI, shiftTypesAPI, LeaveType, ShiftType } from '../services/api';

interface ScheduleEntry {
  employee: string;
  date: string;
  shift: string;
}

interface Employee {
  employee: string;
  pending_off?: number;
}

interface ScheduleTableProps {
  schedule: ScheduleEntry[];
  year: number;
  month: number;
  employees?: Employee[];
  editable?: boolean;
  onScheduleChange?: (updatedSchedule: ScheduleEntry[]) => void;
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

const SPECIAL_COLOR_KEYS = {
  weekend: '__weekend',
  totals: '__totals',
} as const;

const defaultSpecialColors: Record<string, string> = {
  [SPECIAL_COLOR_KEYS.weekend]: '#5f8ace',  // Medium Blue - Weekend
  [SPECIAL_COLOR_KEYS.totals]: '#684d80',   // Dark Purple-Gray - Totals Row
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
  onScheduleChange
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
      colors[lt.code] = lt.color_hex || '#F5F5F5';
    });
    // Add shift types with their colors from database
    shiftTypes.forEach(st => {
      colors[st.code] = st.color_hex || '#E5E7EB';
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
      const saved = localStorage.getItem('shiftColors');
      const dynamicColors = getDynamicShiftColors();
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge: defaults -> dynamic (from DB) -> custom (from localStorage)
        return { ...dynamicColors, ...defaultSpecialColors, ...parsed };
      }
    } catch (e) {
      console.error('Failed to load custom colors:', e);
    }
    return { ...getDynamicShiftColors(), ...defaultSpecialColors };
  };

  const [customColors, setCustomColors] = useState<Record<string, string>>(loadCustomColors);
  const [editingColor, setEditingColor] = useState<string | null>(null);
  
  // Update colors when leave types load
  useEffect(() => {
    setCustomColors(loadCustomColors());
  }, [leaveTypes]);

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

  // Get shift color (use custom if available, otherwise default)
  const getShiftColor = (shift: string): string => {
    // Check custom colors first
    if (customColors[shift]) {
      return customColors[shift];
    }
    // Check dynamic colors from leave types
    const dynamicColors = getDynamicShiftColors();
    if (dynamicColors[shift]) {
      return dynamicColors[shift];
    }
    // Fall back to default
    return defaultShiftColors[shift] || '#FFFFFF';
  };

  // Get month name
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[month - 1];

  // Filter data for the specific month - ensure strict date matching
  const monthData = schedule.filter(entry => {
    const dateStr = entry.date.split('T')[0]; // Get just the date part (YYYY-MM-DD)
    const [entryYear, entryMonth, entryDay] = dateStr.split('-').map(Number);
    return entryMonth === month && entryYear === year;
  });

  if (monthData.length === 0) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
        No schedule data found for {monthName} {year}. Please generate a schedule first.
      </div>
    );
  }

  // Get all unique employees from schedule data
  const employeesInSchedule = Array.from(new Set(monthData.map(e => e.employee)));
  
  // Get employee order from employeeData (employee management order)
  let employees: string[];
  if (employeeData && employeeData.length > 0) {
    // Use the order from employee management, but only include employees that appear in the schedule
    const employeeOrder = employeeData.map(emp => emp.employee);
    employees = employeeOrder.filter(emp => employeesInSchedule.includes(emp));
    // Add any employees in schedule but not in employeeData (shouldn't happen, but be safe)
    const missingEmployees = employeesInSchedule.filter(emp => !employeeOrder.includes(emp));
    employees = [...employees, ...missingEmployees];
  } else {
    // Fallback: sort alphabetically if no employeeData provided
    employees = employeesInSchedule.sort();
  }

  // Get all dates in the month - use local date formatting to avoid timezone issues
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    // Format as YYYY-MM-DD using local date (avoid timezone conversion issues)
    const monthStr = String(month).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    return `${year}-${monthStr}-${dayStr}`;
  });

  // Create employee pending_off lookup
  const pendingOffMap: Record<string, number> = {};
  if (employeeData) {
    employeeData.forEach(emp => {
      pendingOffMap[emp.employee] = emp.pending_off || 0;
    });
  }

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

  const weekendColor =
    customColors[SPECIAL_COLOR_KEYS.weekend] || defaultSpecialColors[SPECIAL_COLOR_KEYS.weekend];
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
              <th className="border border-black px-2 py-2 text-left font-bold sticky left-0 bg-gray-100 z-10">
                Employee
              </th>
              <th className="border border-black px-2 py-2 text-center font-bold">
                P/O
              </th>
              {dates.map(dateStr => {
                const weekend = isWeekend(dateStr);
                return (
                  <th
                    key={dateStr}
                    className="border border-black px-1 py-1 text-center font-semibold min-w-[40px]"
                    title={`${getDayOfWeek(dateStr)} ${formatDate(dateStr)}`}
                    style={weekend ? { backgroundColor: derivedWeekendHeaderColor } : undefined}
                  >
                    <div className="text-xs">{formatDate(dateStr)}</div>
                    <div className="text-xs text-gray-500">{getDayOfWeek(dateStr)}</div>
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
                <td className="border border-black px-2 py-1 font-semibold sticky left-0 bg-white z-10">
                  {employee}
                </td>
                <td className="border border-black px-2 py-1 text-center font-bold">
                  {pendingOffMap[employee] || 0}
                </td>
                {dates.map(dateStr => {
                  const shift = pivotData[employee][dateStr] || '';
                  const baseColor = getShiftColor(shift);
                  const weekend = isWeekend(dateStr);
                  const backgroundColor =
                    weekend && (!shift || shift === 'O')
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
                      className="border border-black px-1 py-1 text-center font-bold text-xs relative"
                      style={{
                        backgroundColor,
                        color: isDark ? '#000000' : '#000000',
                      }}
                      title={shift ? `${employee} - ${getDynamicShiftLabel(shift)}` : `${employee} - No shift`}
                    >
                      {editable ? (
                        <div className="shift-dropdown-container relative">
                          <div
                            className={`cursor-pointer transition-all ${isEditing ? 'ring-2 ring-blue-500 rounded' : 'hover:scale-110'}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingCell(isEditing ? null : { employee, date: dateStr });
                            }}
                    >
                      {displayText}
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
                        <div className="cursor-default">{displayText}</div>
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
                className="border border-black px-2 py-1 text-center"
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
                      className="border border-black px-1 py-1 text-center font-bold"
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
                    className="border border-black px-1 py-1 text-center font-bold"
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
                className="border border-black px-2 py-1 text-center"
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
                      className="border border-black px-1 py-1 text-center font-bold"
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
                    className="border border-black px-1 py-1 text-center font-bold"
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
      <div className="mt-6 bg-white p-4 rounded-lg shadow">
        <div className="flex justify-between items-center mb-3">
          <button
            onClick={() => {
              if (window.confirm('Reset all colors to defaults?')) {
                setCustomColors({ ...defaultShiftColors, ...defaultSpecialColors });
              }
            }}
            className="text-xs px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            Reset Colors
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-sm">
          {[
            // Only show shifts that are: 1) in shiftTypes, 2) in leaveTypes, or 3) actually used in schedule
            ...(() => {
              // Get all unique shifts from the schedule
              const shiftsInSchedule = new Set(schedule.map(entry => entry.shift).filter(Boolean));
              
              // Get shift codes from database shift types
              const shiftTypeCodes = new Set(shiftTypes.map(st => st.code));
              
              // Get leave codes from database leave types
              const leaveTypeCodes = new Set(leaveTypes.map(lt => lt.code));
              
              // Get dynamic colors
              const allColors = getDynamicShiftColors();
              
              // Build set of allowed shifts: shift types + leave types + shifts actually used in schedule
              const allowedShifts = new Set<string>();
              
              // Add all shift types
              shiftTypeCodes.forEach(code => allowedShifts.add(code));
              
              // Add all leave types
              leaveTypeCodes.forEach(code => allowedShifts.add(code));
              
              // Add shifts actually used in schedule (non-standard combinations like M+P, IP+P, etc.)
              shiftsInSchedule.forEach(shift => {
                if (shift && shift !== '0' && shift !== '') {
                  // Only add if it's not already a shift type or leave type (i.e., it's a non-standard combination)
                  if (!shiftTypeCodes.has(shift) && !leaveTypeCodes.has(shift)) {
                    allowedShifts.add(shift);
                  }
                }
              });
              
              // Filter to only show allowed shifts
              return Array.from(allowedShifts)
                .filter(shift => shift && shift !== '0' && shift !== '' && !shift.startsWith('__'))
                .map(shift => ({
                  key: shift,
                  defaultColor: allColors[shift] || '#F5F5F5',
                  label: `${shift}: ${getDynamicShiftLabel(shift)}`,
                }))
                .sort((a, b) => a.key.localeCompare(b.key)); // Sort alphabetically
            })(),
            {
              key: SPECIAL_COLOR_KEYS.weekend,
              defaultColor: defaultSpecialColors[SPECIAL_COLOR_KEYS.weekend],
              label: 'Weekend',
            },
            {
              key: SPECIAL_COLOR_KEYS.totals,
              defaultColor: defaultSpecialColors[SPECIAL_COLOR_KEYS.totals],
              label: 'Totals',
            },
          ].map(({ key, defaultColor, label }) => {
            const currentColor = customColors[key] || defaultColor;
            const isEditing = editingColor === key;
            
            return (
              <div key={key} className="flex items-center space-x-2 group">
                <div className="relative color-picker-container">
                  <div
                    className="w-6 h-6 border border-gray-300 rounded cursor-pointer hover:ring-2 hover:ring-primary-500 transition-all"
                    style={{ backgroundColor: currentColor }}
                    onClick={() => setEditingColor(isEditing ? null : key)}
                    title="Click to change color"
                  />
                  {isEditing && (
                    <div className="absolute top-8 left-0 z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-2 color-picker-container">
                      <input
                        type="color"
                        value={currentColor}
                        onChange={(e) => {
                          setCustomColors({ ...customColors, [key]: e.target.value });
                        }}
                        className="w-full h-8 cursor-pointer"
                        autoFocus
                      />
                      <div className="mt-2 flex space-x-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setCustomColors({ ...customColors, [key]: defaultColor });
                            setEditingColor(null);
                          }}
                          className="text-xs px-2 py-1 bg-gray-200 rounded hover:bg-gray-300"
                        >
                          Reset
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingColor(null);
                          }}
                          className="text-xs px-2 py-1 bg-primary-600 text-white rounded hover:bg-primary-700"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <span className="text-xs">
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

