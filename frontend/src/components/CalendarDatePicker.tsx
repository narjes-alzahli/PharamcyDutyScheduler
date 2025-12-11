import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface CalendarDatePickerProps {
  value: string; // YYYY-MM-DD format
  onChange: (date: string) => void; // Returns YYYY-MM-DD format
  placeholder?: string;
  className?: string;
  required?: boolean;
  min?: string; // YYYY-MM-DD format
  max?: string; // YYYY-MM-DD format
  disabled?: boolean;
}

export const CalendarDatePicker: React.FC<CalendarDatePickerProps> = ({
  value,
  onChange,
  placeholder = 'Select date',
  className = '',
  required = false,
  min,
  max,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [positionAbove, setPositionAbove] = useState(false);
  const [calendarPosition, setCalendarPosition] = useState({ top: 0, left: 0, width: 0 });
  const calendarRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);

  // Parse value to Date object
  const selectedDate = value ? new Date(value + 'T00:00:00') : null;

  // Calculate position when opening calendar
  useEffect(() => {
    if (isOpen && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const calendarHeight = 400; // Approximate height of calendar
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      // Position above if there's not enough space below but enough space above
      const shouldPositionAbove = spaceBelow < calendarHeight && spaceAbove > calendarHeight;
      setPositionAbove(shouldPositionAbove);
      
      // Calculate position for portal (relative to viewport)
      const top = shouldPositionAbove 
        ? rect.top - calendarHeight - 4  // Position above
        : rect.bottom + 4;  // Position below
      
      setCalendarPosition({
        top: Math.max(4, Math.min(top, viewportHeight - calendarHeight - 4)), // Keep within viewport
        left: rect.left,
        width: Math.min(rect.width, 320), // Use input width or max 320px
      });
      
      // Scroll into view if needed
      if (spaceBelow < calendarHeight && spaceAbove < calendarHeight) {
        inputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [isOpen]);

  // Close calendar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // Check if click is outside both the input and the calendar (which is in a portal)
      if (
        inputRef.current && 
        !inputRef.current.contains(target) &&
        calendarRef.current &&
        !calendarRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      // Use a small delay to avoid closing immediately when opening
      const timeoutId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
      return () => {
        clearTimeout(timeoutId);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  // Update currentMonth when value changes
  useEffect(() => {
    if (selectedDate && !isNaN(selectedDate.getTime())) {
      setCurrentMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    }
  }, [value]);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Get days in month
  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  // Get first day of month (0 = Sunday, 1 = Monday, etc.)
  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  // Navigate months
  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth(prev => {
      const newDate = new Date(prev);
      if (direction === 'prev') {
        newDate.setMonth(prev.getMonth() - 1);
      } else {
        newDate.setMonth(prev.getMonth() + 1);
      }
      return newDate;
    });
  };

  // Select date
  const selectDate = (day: number) => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const date = new Date(year, month, day);
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    console.log(`📅 CalendarDatePicker selectDate called: day=${day}, dateStr=${dateStr}`);
    console.log(`📅 Current value: ${value}, min: ${min}, max: ${max}`);
    
    // Check min/max constraints
    if (min && dateStr < min) {
      console.warn(`❌ Date ${dateStr} is before min ${min}`);
      return;
    }
    if (max && dateStr > max) {
      console.warn(`❌ Date ${dateStr} is after max ${max}`);
      return;
    }
    
    console.log(`✅ CalendarDatePicker: Calling onChange with ${dateStr}`);
    onChange(dateStr);
    setIsOpen(false);
    console.log(`✅ CalendarDatePicker: Calendar closed after selection`);
  };

  // Check if date is disabled
  const isDateDisabled = (day: number): boolean => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    if (min && dateStr < min) return true;
    if (max && dateStr > max) return true;
    return false;
  };

  // Check if date is selected
  const isDateSelected = (day: number): boolean => {
    if (!selectedDate) return false;
    return (
      selectedDate.getFullYear() === currentMonth.getFullYear() &&
      selectedDate.getMonth() === currentMonth.getMonth() &&
      selectedDate.getDate() === day
    );
  };

  // Check if date is today
  const isToday = (day: number): boolean => {
    const today = new Date();
    return (
      today.getFullYear() === currentMonth.getFullYear() &&
      today.getMonth() === currentMonth.getMonth() &&
      today.getDate() === day
    );
  };

  // Generate calendar days
  const generateCalendarDays = () => {
    const daysInMonth = getDaysInMonth(currentMonth);
    const firstDay = getFirstDayOfMonth(currentMonth);
    const days: (number | null)[] = [];

    // Add empty cells for days before the first day of the month
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day);
    }

    return days;
  };

  const formatDisplayValue = (): string => {
    if (!value) return '';
    try {
      const date = new Date(value + 'T00:00:00');
      if (isNaN(date.getTime())) return value;
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    } catch {
      return value;
    }
  };

  const calendarDays = generateCalendarDays();

  return (
    <div className={`relative ${className}`}>
      <div
        ref={inputRef}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`
          w-full rounded-lg border border-gray-300 px-4 py-2 text-sm
          focus:ring-2 focus:ring-primary-500 focus:border-transparent
          cursor-pointer bg-white
          ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-60' : 'hover:border-gray-400'}
          ${required && !value ? 'border-red-300' : ''}
        `}
      >
        <div className="flex items-center justify-between">
          <span className={value ? 'text-gray-900' : 'text-gray-500'}>
            {value ? formatDisplayValue() : placeholder}
          </span>
          <svg
            className="w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      </div>

      {isOpen && !disabled && typeof document !== 'undefined' && createPortal(
        <div 
          ref={calendarRef}
          className="fixed z-[9999] bg-white rounded-lg shadow-lg border border-gray-200 p-4"
          style={{
            top: `${calendarPosition.top}px`,
            left: `${calendarPosition.left}px`,
            width: `${calendarPosition.width || 320}px`,
            minWidth: '320px',
            maxWidth: '90vw',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Month/Year Navigation */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => navigateMonth('prev')}
              className="p-1 hover:bg-gray-100 rounded"
              type="button"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h3 className="font-semibold text-gray-900">
              {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </h3>
            <button
              onClick={() => navigateMonth('next')}
              className="p-1 hover:bg-gray-100 rounded"
              type="button"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Day names header */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {dayNames.map(day => (
              <div key={day} className="text-center text-xs font-medium text-gray-500 py-1">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar days */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, index) => {
              if (day === null) {
                return <div key={index} className="p-2" />;
              }

              const disabled = isDateDisabled(day);
              const selected = isDateSelected(day);
              const today = isToday(day);

              return (
                <button
                  key={index}
                  onClick={() => !disabled && selectDate(day)}
                  disabled={disabled}
                  className={`
                    p-2 text-sm rounded
                    ${disabled
                      ? 'text-gray-300 cursor-not-allowed'
                      : 'hover:bg-gray-100 cursor-pointer'
                    }
                    ${selected
                      ? 'bg-primary-600 text-white hover:bg-primary-700'
                      : 'text-gray-900'
                    }
                    ${today && !selected
                      ? 'bg-blue-50 font-semibold'
                      : ''
                    }
                  `}
                  type="button"
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Today button */}
          <div className="mt-3 pt-3 border-t border-gray-200">
            <button
              onClick={() => {
                const today = new Date();
                const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                console.log(`📅 CalendarDatePicker: "Today" button clicked, dateStr=${todayStr}`);
                if ((!min || todayStr >= min) && (!max || todayStr <= max)) {
                  console.log(`✅ CalendarDatePicker: Calling onChange with Today date ${todayStr}`);
                  onChange(todayStr);
                  setIsOpen(false);
                } else {
                  console.warn(`❌ CalendarDatePicker: Today date ${todayStr} is outside min/max range`);
                }
              }}
              className="w-full text-sm text-primary-600 hover:text-primary-700 font-medium py-1"
              type="button"
            >
              Today
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
