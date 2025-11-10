import React, { useState, useEffect } from 'react';
import { shiftColors as defaultShiftColors, getShiftLabel } from '../utils/shiftColors';

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

const WEEKEND_HEADER_BACKGROUND = '#D1FAE5'; // Light green for weekend headers
const WEEKEND_BACKGROUND = '#E8FDF2'; // Slightly different green for weekend cells
const TOTAL_MAIN_BACKGROUND = '#E5E7EB'; // Light gray for TOTAL MAIN
const TOTAL_IP_BACKGROUND = '#D1D5DB'; // Slightly darker gray for TOTAL IP

export const ScheduleTable: React.FC<ScheduleTableProps> = ({ schedule, year, month, employees: employeeData }) => {
  // Load custom colors from localStorage or use defaults
  const loadCustomColors = (): Record<string, string> => {
    try {
      const saved = localStorage.getItem('shiftColors');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with defaults to ensure all shifts have colors
        return { ...defaultShiftColors, ...parsed };
      }
    } catch (e) {
      console.error('Failed to load custom colors:', e);
    }
    return { ...defaultShiftColors };
  };

  const [customColors, setCustomColors] = useState<Record<string, string>>(loadCustomColors);
  const [editingColor, setEditingColor] = useState<string | null>(null);

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
    return customColors[shift] || defaultShiftColors[shift] || '#FFFFFF';
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

  const isWeekend = (dateStr: string) => {
    const day = getDayOfWeek(dateStr);
    return day === 'Fri' || day === 'Sat';
  };

  return (
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
                    style={weekend ? { backgroundColor: WEEKEND_HEADER_BACKGROUND } : undefined}
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
                      ? WEEKEND_BACKGROUND
                      : baseColor;
                  const isDark = shift === 'M' || shift === 'M3' || shift === 'M4';

                  return (
                    <td
                      key={dateStr}
                      className="border border-black px-1 py-1 text-center font-bold text-xs cursor-pointer transition-transform hover:scale-110"
                      style={{
                        backgroundColor,
                        color: isDark ? '#000000' : '#000000',
                      }}
                      title={shift ? `${employee} - ${getShiftLabel(shift)}` : `${employee} - No shift`}
                    >
                      {shift || ''}
                    </td>
                  );
                })}
              </tr>
            ))}
            
            {/* TOTAL MAIN row */}
            <tr className="bg-gray-200 font-bold">
              <td className="border border-black px-2 py-1 text-center" colSpan={2}>
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
                    style={{ backgroundColor: TOTAL_MAIN_BACKGROUND }}
                  >
                    {mainCount}
                  </td>
                );
              })}
            </tr>
            
            {/* TOTAL IP row */}
            <tr className="bg-gray-200 font-bold">
              <td className="border border-black px-2 py-1 text-center" colSpan={2}>
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
                    style={{ backgroundColor: TOTAL_IP_BACKGROUND }}
                  >
                    {ipCount}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Legend with Color Pickers */}
      <div className="mt-6 bg-white p-4 rounded-lg shadow">
        <div className="flex justify-between items-center mb-3">
          <button
            onClick={() => {
              if (window.confirm('Reset all colors to defaults?')) {
                setCustomColors({ ...defaultShiftColors });
              }
            }}
            className="text-xs px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            Reset Colors
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-sm">
          {Object.entries(defaultShiftColors).map(([shift, defaultColor]) => {
            if (!shift || shift === '0' || shift === '') return null;
            const currentColor = customColors[shift] || defaultColor;
            const isEditing = editingColor === shift;
            
            return (
              <div key={shift} className="flex items-center space-x-2 group">
                <div className="relative color-picker-container">
                  <div
                    className="w-6 h-6 border border-gray-300 rounded cursor-pointer hover:ring-2 hover:ring-primary-500 transition-all"
                    style={{ backgroundColor: currentColor }}
                    onClick={() => setEditingColor(isEditing ? null : shift)}
                    title="Click to change color"
                  />
                  {isEditing && (
                    <div className="absolute top-8 left-0 z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-2 color-picker-container">
                      <input
                        type="color"
                        value={currentColor}
                        onChange={(e) => {
                          setCustomColors({ ...customColors, [shift]: e.target.value });
                        }}
                        className="w-full h-8 cursor-pointer"
                        autoFocus
                      />
                      <div className="mt-2 flex space-x-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setCustomColors({ ...customColors, [shift]: defaultColor });
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
                  <strong>{shift}</strong>: {getShiftLabel(shift)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

