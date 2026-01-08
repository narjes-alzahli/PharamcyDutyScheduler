/**
 * Calculate pending_off values dynamically from schedule data.
 * This matches the backend calculation logic:
 * pending_off = (weekend_shifts + night_shifts + initial_pending_off) - DOs_given
 */

export interface PendingOffData {
  employee: string;
  pending_off: number;
  night_shifts: number;
  weekend_shifts: number;
  DOs_given: number;
  total_working_days: number;
}

export interface HolidayMap {
  [dateStr: string]: string | undefined;
}

/**
 * Calculate pending_off for all employees from schedule data.
 * 
 * @param schedule - Array of schedule entries {employee, date, shift}
 * @param initialPendingOff - Map of employee name to initial pending_off value (from previous month)
 * @param holidays - Map of date strings (YYYY-MM-DD) to holiday names (optional)
 * @param year - Year of the schedule
 * @param month - Month of the schedule (1-12)
 * @returns Array of employee data with calculated pending_off values
 */
export const calculatePendingOff = (
  schedule: Array<{ employee: string; date: string; shift: string }>,
  initialPendingOff: Record<string, number> = {},
  holidays: HolidayMap = {},
  year?: number,
  month?: number
): PendingOffData[] => {
  const employeeData: Record<string, {
    night_shifts: number;
    weekend_shifts: number;
    DOs_given: number;
    total_working_days: number;
  }> = {};

  // Initialize all employees from initialPendingOff
  Object.keys(initialPendingOff).forEach(emp => {
    if (!employeeData[emp]) {
      employeeData[emp] = {
        night_shifts: 0,
        weekend_shifts: 0,
        DOs_given: 0,
        total_working_days: 0,
      };
    }
  });

  // Process schedule entries
  schedule.forEach(entry => {
    const { employee, date: dateStr, shift } = entry;
    
    if (!employeeData[employee]) {
      employeeData[employee] = {
        night_shifts: 0,
        weekend_shifts: 0,
        DOs_given: 0,
        total_working_days: 0,
      };
    }

    const empData = employeeData[employee];
    
    // Parse date
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // Friday or Saturday
    
    // Check if holiday (date should be in YYYY-MM-DD format)
    const dateOnly = dateStr.split('T')[0];
    const isHoliday = holidays[dateOnly] !== undefined;
    
    // Working shifts
    const workingShifts = ['M', 'IP', 'A', 'N', 'M3', 'M4', 'H', 'CL'];
    if (workingShifts.includes(shift)) {
      empData.total_working_days += 1;
      
      // Night shift counting logic: Friday/Saturday/vacation counts as 2
      if (shift === 'N') {
        if (isWeekend || isHoliday) {
          empData.night_shifts += 2; // Count as 2 for pending_off calculation
        } else {
          empData.night_shifts += 1;
        }
      }
      
      // Weekend shifts (Friday=5, Saturday=6) - any shift on weekend
      if (isWeekend) {
        empData.weekend_shifts += 1;
      }
    }
    
    // Count only "DO" (Day Off) codes for pending_off calculation
    if (shift === 'DO') {
      empData.DOs_given += 1;
    }
  });

  // Calculate final pending_off for each employee
  const result: PendingOffData[] = Object.keys(employeeData).map(employee => {
    const data = employeeData[employee];
    const initial = initialPendingOff[employee] || 0;
    
    // Calculate pending_off: (weekend_shifts + night_shifts + initial_pending_off) - DOs_given
    const pending_off = data.weekend_shifts + data.night_shifts + initial - data.DOs_given;
    
    return {
      employee,
      pending_off: Math.round(pending_off), // Round to integer
      night_shifts: data.night_shifts,
      weekend_shifts: data.weekend_shifts,
      DOs_given: data.DOs_given,
      total_working_days: data.total_working_days,
    };
  });

  return result;
};

