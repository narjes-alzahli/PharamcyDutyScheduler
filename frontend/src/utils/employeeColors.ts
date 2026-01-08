/**
 * Utility for consistent color mapping across all charts.
 * Generates a color for each employee that remains consistent across all visualizations.
 */

const COLOR_PALETTE = [
  '#FFB6C1', // Light Pink
  '#FFA07A', // Light Salmon
  '#98D8C8', // Mint
  '#F7DC6F', // Light Yellow
  '#BB8FCE', // Light Purple
  '#85C1E2', // Light Blue
  '#FFE4E1', // Misty Rose
  '#F0E68C', // Khaki
  '#DDA0DD', // Plum
  '#B0E0E6', // Powder Blue
  '#98FB98', // Pale Green
  '#F5DEB3', // Wheat
  '#E1BEE7', // Light Purple 2
  '#C8E6C9', // Light Green
  '#FFF9C4', // Light Yellow 2
  '#FFCCBC', // Peach Puff
  '#B3E5FC', // Light Blue 2
  '#F8BBD0', // Pink
  '#C5E1A5', // Light Green 2
  '#B2DFDB', // Light Cyan
  '#FFE082', // Amber
  '#CE93D8', // Light Purple 3
  '#90CAF9', // Light Blue 3
];

/**
 * Create a color map for all employees in the data.
 * Returns a function that can be used to get colors for a specific set of employees.
 */
export const createEmployeeColorMap = (allEmployees: string[]): Map<string, string> => {
  const colorMap = new Map<string, string>();
  const sortedEmployees = [...allEmployees].sort(); // Sort for consistency
  
  sortedEmployees.forEach((emp, index) => {
    colorMap.set(emp, COLOR_PALETTE[index % COLOR_PALETTE.length]);
  });
  
  return colorMap;
};

/**
 * Get colors array for a specific distribution, ensuring consistent colors for each employee.
 */
export const getColorsForDistribution = (
  distribution: Array<{ emp: string }>,
  colorMap: Map<string, string>
): string[] => {
  return distribution.map(d => colorMap.get(d.emp) || '#CCCCCC');
};

