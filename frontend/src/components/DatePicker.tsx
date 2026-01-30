import React from 'react';
import { useDate } from '../contexts/DateContext';

interface YearMonthCombo {
  year: number;
  month: number;
  value: string;
  label: string;
  period?: string; // Optional period identifier (e.g., 'pre-ramadan', 'ramadan', 'post-ramadan')
}

interface DatePickerProps {
  /** Show a compact inline version (for header/sidebar) */
  compact?: boolean;
  /** Show only available years/months (for viewing committed schedules) */
  availableYears?: number[];
  availableMonths?: number[];
  /** Pre-computed year-month combinations (for combined picker with filtering) */
  availableYearMonthCombos?: YearMonthCombo[];
  /** Custom className */
  className?: string;
  /** Use combined month/year picker (single input) */
  combined?: boolean;
  /** Optional callback when value changes, receives full value (including period if present) */
  onValueChange?: (value: string) => void;
  /** Optional selected period to help determine the correct dropdown value */
  selectedPeriod?: string | null;
}

export const DatePicker: React.FC<DatePickerProps> = ({
  compact = false,
  availableYears,
  availableMonths,
  availableYearMonthCombos,
  className = '',
  combined = true,
  onValueChange,
  selectedPeriod,
}) => {
  const { selectedYear, selectedMonth, setDate } = useDate();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Generate year options
  const yearOptions = availableYears || [2025, 2026, 2027];
  
  // Generate month options
  const monthOptions = availableMonths || Array.from({ length: 12 }, (_, i) => i + 1);

  // Generate combined options (for custom combined picker)
  const getCombinedOptions = (): YearMonthCombo[] => {
    // If pre-computed combinations are provided, use them
    if (availableYearMonthCombos && availableYearMonthCombos.length > 0) {
      return availableYearMonthCombos;
    }
    
    // Otherwise, generate all combinations
    const options: YearMonthCombo[] = [];
    yearOptions.forEach(year => {
      monthOptions.forEach(month => {
        options.push({
          value: `${year}-${month}`,
          label: `${monthNames[month - 1]} ${year}`,
          year,
          month
        });
      });
    });
    return options;
  };

  // Handle combined month/year input (HTML5 month input or custom select)
  const handleCombinedChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value; // Format: "YYYY-MM" or "YYYY-MM-period"
    if (onValueChange) {
      // Call custom callback with full value (including period if present)
      onValueChange(value);
    }
    if (value) {
      // Extract year and month (handle period-specific values like "2026-2-ramadan")
      const parts = value.split('-');
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]);
      if (!isNaN(year) && !isNaN(month)) {
        setDate(year, month);
      } else {
        setDate(null, null);
      }
    } else {
      setDate(null, null);
    }
  };

  // Format current selection for month input (YYYY-MM)
  const monthInputValue = selectedYear && selectedMonth 
    ? `${selectedYear}-${selectedMonth.toString().padStart(2, '0')}`
    : '';

  // Format current selection for custom select (YYYY-M or YYYY-M-period)
  // If we have availableYearMonthCombos, find the matching one to get the full value
  const combinedSelectValue = selectedYear && selectedMonth 
    ? (availableYearMonthCombos && availableYearMonthCombos.length > 0
        ? (() => {
            // If we have a selectedPeriod, try to find exact match with period first
            if (selectedPeriod) {
              const periodMatch = availableYearMonthCombos.find(
                opt => opt.year === selectedYear && opt.month === selectedMonth && opt.period === selectedPeriod
              );
              if (periodMatch) {
                return periodMatch.value;
              }
            }
            // Try to find exact match by year and month
            const exactMatch = availableYearMonthCombos.find(
              opt => opt.year === selectedYear && opt.month === selectedMonth
            );
            if (exactMatch) {
              return exactMatch.value;
            }
            // Fallback to standard format
            return `${selectedYear}-${selectedMonth}`;
          })()
        : `${selectedYear}-${selectedMonth}`)
    : '';

  if (combined) {
    const combinedOptions = getCombinedOptions();
    const hasFiltering = availableYearMonthCombos && availableYearMonthCombos.length > 0;

    // Use custom select when filtering is needed or when we have pre-computed options
    if (hasFiltering) {
      // Custom select for filtered options
      if (compact) {
        return (
          <div className={`flex items-center ${className}`}>
            <select
              value={combinedSelectValue}
              onChange={handleCombinedChange}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">Select...</option>
              {combinedOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        );
      }

      return (
        <div className={`bg-white rounded-lg shadow p-6 ${className}`}>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Month & Year
            </label>
            <select
              value={combinedSelectValue}
              onChange={handleCombinedChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">Select Month & Year...</option>
              {combinedOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {(!selectedYear || !selectedMonth) && (
            <div className="mt-4 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded">
              Please select a month and year.
            </div>
          )}
        </div>
      );
    } else {
      // HTML5 month input when all options available
      const minYear = availableYears ? Math.min(...availableYears) : 2025;
      const maxYear = availableYears ? Math.max(...availableYears) : 2027;
      const minDate = `${minYear}-01`;
      const maxDate = `${maxYear}-12`;

      if (compact) {
        return (
          <div className={`flex items-center ${className}`}>
            <input
              type="month"
              value={monthInputValue}
              onChange={handleCombinedChange}
              min={minDate}
              max={maxDate}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        );
      }

      return (
        <div className={`bg-white rounded-lg shadow p-6 ${className}`}>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Month & Year
            </label>
            <input
              type="month"
              value={monthInputValue}
              onChange={handleCombinedChange}
              min={minDate}
              max={maxDate}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          {(!selectedYear || !selectedMonth) && (
            <div className="mt-4 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded">
              Please select a month and year.
            </div>
          )}
        </div>
      );
    }
  }

  // Fallback to separate dropdowns if combined=false
  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <select
          value={selectedYear || ''}
          onChange={(e) => {
            const year = e.target.value ? parseInt(e.target.value) : null;
            setDate(year, year ? selectedMonth : null);
          }}
          className="px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        >
          <option value="">Year</option>
          {yearOptions.map(year => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>
        <select
          value={selectedMonth || ''}
          onChange={(e) => setDate(selectedYear, e.target.value ? parseInt(e.target.value) : null)}
          disabled={!selectedYear}
          className="px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
        >
          <option value="">Month</option>
          {monthOptions.map((month: number) => (
            <option key={month} value={month}>{monthNames[month - 1]}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg shadow p-6 ${className}`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Year</label>
          <select
            value={selectedYear || ''}
            onChange={(e) => {
              const year = e.target.value ? parseInt(e.target.value) : null;
              setDate(year, year ? selectedMonth : null);
            }}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option value="">Select Year...</option>
            {yearOptions.map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Month</label>
          <select
            value={selectedMonth || ''}
            onChange={(e) => setDate(selectedYear, e.target.value ? parseInt(e.target.value) : null)}
            disabled={!selectedYear}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            <option value="">Select Month...</option>
            {monthOptions.map((month: number) => (
              <option key={month} value={month}>{monthNames[month - 1]}</option>
            ))}
          </select>
        </div>
      </div>
      {(!selectedYear || !selectedMonth) && (
        <div className="mt-4 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded">
          Please select both a year and month.
        </div>
      )}
    </div>
  );
};

