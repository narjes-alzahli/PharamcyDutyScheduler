import React from 'react';
import { createEmployeeColorMap } from '../utils/employeeColors';

interface EmployeeLegendProps {
  employees: string[];
  employeeOrder?: string[];
  className?: string;
}

/**
 * Scrollable legend showing employee names and their consistent colors.
 */
export const EmployeeLegend: React.FC<EmployeeLegendProps> = ({
  employees,
  employeeOrder,
  className = '',
}) => {
  if (!employees || employees.length === 0) {
    return null;
  }

  const colorMap = createEmployeeColorMap(employees);
  // Use employee order if provided, otherwise sort alphabetically
  const sortedEmployees = employeeOrder
    ? employees.slice().sort((a, b) => {
        const aIdx = employeeOrder.indexOf(a);
        const bIdx = employeeOrder.indexOf(b);
        if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      })
    : [...employees].sort();

  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-2 ${className}`}>
      <h4 className="text-xs font-semibold text-gray-800 mb-2">Employees</h4>
      <div className="max-h-32 overflow-y-auto">
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-1.5">
          {sortedEmployees.map((emp) => {
            const color = colorMap.get(emp) || '#CCCCCC';
            return (
              <div key={emp} className="flex items-center space-x-1.5 text-xs">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-gray-700 truncate">{emp}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

