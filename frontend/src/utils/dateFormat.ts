/**
 * Date formatting utilities for DD-MM-YYYY format
 */

/**
 * Format a date string (YYYY-MM-DD) to DD-MM-YYYY
 */
export const formatDateDDMMYYYY = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '';
  
  // Handle ISO format with time (YYYY-MM-DDTHH:MM:SS)
  const dateOnly = dateStr.split('T')[0];
  const parts = dateOnly.split('-');
  
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `${day}-${month}-${year}`;
  }
  
  // If already in DD-MM-YYYY format, return as is
  if (dateStr.includes('-') && dateStr.split('-').length === 3) {
    const parts2 = dateStr.split('-');
    if (parts2[0].length === 2 && parts2[2].length === 4) {
      return dateStr; // Already in DD-MM-YYYY
    }
  }
  
  return dateStr; // Fallback
};

/**
 * Parse DD-MM-YYYY to YYYY-MM-DD (for date inputs which require ISO format)
 */
export const parseDateToISO = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '';
  
  // If already in YYYY-MM-DD format, return as is
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
    return dateStr.split('T')[0]; // Remove time if present
  }
  
  // Parse DD-MM-YYYY
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    // Validate format
    if (day.length === 2 && month.length === 2 && year.length === 4) {
      // Validate date values
      const dayNum = parseInt(day, 10);
      const monthNum = parseInt(month, 10);
      const yearNum = parseInt(year, 10);
      
      // Basic validation
      if (dayNum >= 1 && dayNum <= 31 && monthNum >= 1 && monthNum <= 12 && yearNum >= 2000 && yearNum <= 2100) {
        // Create date to validate it's a real date
        const dateObj = new Date(yearNum, monthNum - 1, dayNum);
        if (dateObj.getFullYear() === yearNum && 
            dateObj.getMonth() === monthNum - 1 && 
            dateObj.getDate() === dayNum) {
          return `${year}-${month}-${day}`;
        }
      }
    }
  }
  
  // If parsing failed, try to return as-is (might already be in correct format)
  console.warn(`Failed to parse date: ${dateStr}, returning as-is`);
  return dateStr; // Fallback
};

/**
 * Format a Date object to DD-MM-YYYY
 */
export const formatDateObject = (date: Date | null | undefined): string => {
  if (!date || isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
};

