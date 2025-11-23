import React, { useState, useEffect } from 'react';
import { shiftColors as defaultShiftColors, getShiftLabel } from '../utils/shiftColors';
import { leaveTypesAPI, LeaveType } from '../services/api';

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
  [SPECIAL_COLOR_KEYS.weekend]: '#E8FDF2',
  [SPECIAL_COLOR_KEYS.totals]: '#D8DDE5',
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

export const ScheduleTable: React.FC<ScheduleTableProps> = ({ schedule, year, month, employees: employeeData }) => {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  
  // Load leave types from API to get dynamic colors and labels
  useEffect(() => {
    const loadLeaveTypes = async () => {
      try {
        const types = await leaveTypesAPI.getLeaveTypes(true); // Only active types
        setLeaveTypes(types);
      } catch (error) {
        console.error('Failed to load leave types:', error);
      }
    };
    loadLeaveTypes();
  }, []);
  
  // Get dynamic shift colors including leave types from database
  const getDynamicShiftColors = (): Record<string, string> => {
    const colors: Record<string, string> = { ...defaultShiftColors };
    // Add leave types with their colors from database (even if not in defaultShiftColors)
    leaveTypes.forEach(lt => {
      // Always add leave type, use color from DB or a default
      colors[lt.code] = lt.color_hex || '#F5F5F5';
    });
    return colors;
  };
  
  // Get dynamic shift labels including leave types from database
  const getDynamicShiftLabel = (shift: string): string => {
    // Check if it's a leave type from database
    const leaveType = leaveTypes.find(lt => lt.code === shift);
    if (leaveType) {
      return leaveType.display_name || shift;
    }
    // Fall back to hardcoded labels
    return getShiftLabel(shift);
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

  // Get all unique employees
  const employees = Array.from(new Set(monthData.map(e => e.employee))).sort();
  
  // Reorder: clinic employees at the bottom
  const clinicEmployees = ['Rasha', 'Hawra', 'Abdullah'];
  const otherEmployees = employees.filter(emp => !clinicEmployees.includes(emp));
  const reorderedEmployees = [...otherEmployees, ...clinicEmployees.filter(emp => employees.includes(emp))];

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
  reorderedEmployees.forEach(emp => {
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
            {reorderedEmployees.map(employee => (
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
                  // Get display label for shift (for leave types, show display_name from DB)
                  const displayText = shift ? (() => {
                    const leaveType = leaveTypes.find(lt => lt.code === shift);
                    // For leave types from DB, optionally show display name, otherwise just code
                    // But usually we just show the code (CS, AL, etc.) for consistency
                    return shift;
                  })() : '';

                  return (
                    <td
                      key={dateStr}
                      className="border border-black px-1 py-1 text-center font-bold text-xs cursor-pointer transition-transform hover:scale-110"
                      style={{
                        backgroundColor,
                        color: isDark ? '#000000' : '#000000',
                      }}
                      title={shift ? `${employee} - ${getDynamicShiftLabel(shift)}` : `${employee} - No shift`}
                    >
                      {displayText}
                    </td>
                  );
                })}
              </tr>
            ))}
            
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
                // Count M shifts for this date
                const mainCount = reorderedEmployees.reduce((count, emp) => {
                  const shift = pivotData[emp][dateStr] || '';
                  return count + (shift === 'M' ? 1 : 0);
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
                // Count IP shifts for this date
                const ipCount = reorderedEmployees.reduce((count, emp) => {
                  const shift = pivotData[emp][dateStr] || '';
                  return count + (shift === 'IP' ? 1 : 0);
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
            // Get all shifts used in the schedule + default colors + leave types from database
            ...(() => {
              // Get all unique shifts from the schedule
              const shiftsInSchedule = new Set(schedule.map(entry => entry.shift).filter(Boolean));
              
              // Start with dynamic colors (includes leave types from DB)
              const allColors = getDynamicShiftColors();
              
              // Ensure all shifts from schedule have a color entry (even if not in defaults or DB yet)
              shiftsInSchedule.forEach(shift => {
                if (!allColors[shift] && shift && shift !== '0' && shift !== '') {
                  // Try to find leave type in DB
                  const leaveType = leaveTypes.find(lt => lt.code === shift);
                  allColors[shift] = leaveType?.color_hex || '#F5F5F5'; // Default gray if not found
                }
              });
              
              return Object.entries(allColors)
                .filter(([shift]) => shift && shift !== '0' && shift !== '' && !shift.startsWith('__'))
              .map(([shift, defaultColor]) => ({
                key: shift,
                defaultColor,
                  label: `${shift}: ${getDynamicShiftLabel(shift)}`,
                }));
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

