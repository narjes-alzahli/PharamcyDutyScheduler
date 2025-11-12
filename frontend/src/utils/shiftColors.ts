// Shift color mapping (matching Python schedule_display.py)
export const shiftColors: Record<string, string> = {
  'M': '#FFFFFF',      // White - Main shift
  'O': '#E6F3FF',      // Light blue - Off (from schedule)
  'IP': '#F0F8FF',     // Very light blue - Inpatient
  'A': '#FFA500',      // Orange - Afternoon (2:30pm - 9:30pm)
  'N': '#FFFF00',      // Yellow - Night (9:30pm - 7am)
  'DO': '#90EE90',     // Light green - Day Off
  'AL': '#FFD27F',     // Light orange - Annual Leave
  'CL': '#FFB6C1',     // Light pink - Clinic
  'ML': '#DDA0DD',     // Plum - Maternity Leave
  'W': '#D8BFD8',      // Thistle - Workshop
  'UL': '#F5F5F5',     // Light gray - Unpaid Leave
  'H': '#FFE4E1',      // Misty rose - Harat Pharmacy
  'STL': '#B0E0E6',    // Powder blue - Study Leave
  'ATT': '#E0E0E0',    // Light gray - Attending
  'APP': '#FF6B6B',    // Light red - Appointment
  'RT': '#87CEEB',     // Sky blue - Return
  'EV': '#DDA0DD',     // Plum - Event
  'P': '#FFA07A',      // Light salmon - Pharmacy
  'M+P': '#FFB6C1',    // Light pink - Main + Pharmacy
  'IP+P': '#FFB6C1',   // Light pink - Inpatient + Pharmacy
  'M3': '#FFFFFF',     // White - M3 (7am-2pm)
  'M4': '#FFFFFF',     // White - M4 (12pm-7pm)
  'M3+P': '#FFB6C1',   // Light pink - M3 + Pharmacy
  'DR+M': '#FFB6C1',   // Light pink - Doctor + Main
  'V+P': '#FF6B6B',    // Light red - V + Pharmacy
  'C': '#F0F8FF',      // Very light blue - Clinic
  'L': '#F5F5F5',      // Light gray - Leave
  '0': '#FFFFFF',      // White - Empty/Default
  '': '#FFFFFF',       // White - Empty
};

export const shiftLabels: Record<string, string> = {
  'M': 'Main',
  'O': 'Off',
  'IP': 'Inpatient',
  'A': 'Afternoon (2:30pm-9:30pm)',
  'N': 'Night (9:30pm-7am)',
  'DO': 'Day Off',
  'AL': 'Annual Leave',
  'CL': 'Clinic',
  'ML': 'Maternity Leave',
  'W': 'Workshop',
  'UL': 'Unpaid Leave',
  'H': 'Harat Pharmacy',
  'STL': 'Study Leave',
  'ATT': 'Attending',
  'APP': 'Appointment',
  'RT': 'Return',
  'EV': 'Event',
  'P': 'Pharmacy',
  'M+P': 'Main + Pharmacy',
  'IP+P': 'Inpatient + Pharmacy',
  'M3': 'M3 (7am-2pm)',
  'M4': 'M4 (12pm-7pm)',
  'M3+P': 'M3 + Pharmacy',
  'DR+M': 'Doctor + Main',
  'V+P': 'V + Pharmacy',
  'C': 'Clinic',
  'L': 'Leave',
  '0': 'Empty',
  '': 'Empty',
};

export const getShiftColor = (shift: string): string => {
  return shiftColors[shift] || '#FFFFFF';
};

export const getShiftLabel = (shift: string): string => {
  return shiftLabels[shift] || shift;
};

