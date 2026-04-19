// Shift color mapping - fallback defaults when database is unavailable
// Note: Database colors (from ShiftType and LeaveType) take precedence
// These are fallback defaults for initial render and offline scenarios
export const shiftColors: Record<string, string> = {
  // Shift Types
  '0': '#FFFFFF',      // White - Empty/Default
  'M': '#FFFFFF',      // White - Main / Morning
  'IP': '#ffffff',     // White - Inpatient
  'A': '#845699',      // Purple/Violet - Afternoon
  'N': '#FFFF00',      // Bright Yellow - Night
  'M3': '#ecd0d0',     // Light Pink-Gray/Beige - M3 (7am-2pm)
  'M4': '#a6cdf7',     // Light Blue - M4 (12pm-7pm)
  'H': '#ffcd9e',      // Peach/Light Orange - Harat Pharmacy
  'CL': '#ffffff',     // White - Clinic
  'MS': '#ffffff',     // White - Medical Store
  'E': '#4575d3',      // Blue - Evening
  'C': '#e66bcf',      // Pink/Magenta - Course
  'P': '#FFA07A',      // Light Salmon/Peach - Preparation
  'M+P': '#ec7c13',    // Orange/Brown-Orange - Main + Preparation
  'IP+P': '#ec7c13',   // Orange/Brown-Orange - Inpatient + Preparation
  'O': '#ffffff',      // White - Off Duty
  // Leave Types
  'DO': '#70c770',     // Medium Green - Day Off
  'AL': '#FFD27F',     // Light Orange/Peach - Annual Leave
  'ML': '#DDA0DD',     // Plum/Light Purple - Maternity Leave
  'W': '#D8BFD8',      // Thistle/Light Purple - Workshop
  'UL': '#F5F5F5',     // Light Gray - Unpaid Leave
  'APP': '#ec7c13',    // Orange/Brown-Orange - Appointment
  'STL': '#B0E0E6',    // Powder Blue - Study Leave
  'L': '#ded9d9',      // Light Gray/Beige - Leave
  'PH': '#a8d5e2',     // Light blue - Public Holiday (solver: O on calendar holiday)
  // Special/Empty
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
  'APP': 'Appointment',
  'P': 'Preparation',
  'M+P': 'Main + Preparation',
  'IP+P': 'Inpatient + Preparation',
  'M3': 'M3 (7am-2pm)',
  'M4': 'M4 (12pm-7pm)',
  'C': 'Clinic',
  'L': 'Leave',
  'PH': 'Public Holiday',
  '0': 'Empty',
  '': 'Empty',
};

export const getShiftColor = (shift: string): string => {
  return shiftColors[shift] || '#FFFFFF';
};

export const getShiftLabel = (shift: string): string => {
  return shiftLabels[shift] || shift;
};

