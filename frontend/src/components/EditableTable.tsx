import React, { useState, useRef } from 'react';
import { CalendarDatePicker } from './CalendarDatePicker';
import { formatDateDDMMYYYY, parseDateToISO } from '../utils/dateFormat';
import { useResizableColumns } from '../hooks/useResizableColumns';
import { useTableSort } from '../hooks/useTableSort';
import { useTableSearch } from '../hooks/useTableSearch';
import { SearchBar } from './SearchBar';

interface EditableTableProps {
  data: any[];
  columns: Array<{
    key: string;
    label: string;
    type?: 'text' | 'number' | 'checkbox' | 'select';
    options?: string[];
    min?: number;
    max?: number;
    readOnly?: boolean;
    sortable?: boolean; // Whether this column can be sorted
  }>;
  onDataChange: (newData: any[]) => void;
  onAddRow?: () => void;
  onDeleteRow?: (index: number) => void;
  debounceMs?: number; // Optional debounce delay
  searchable?: boolean; // Whether to show search bar
  searchPlaceholder?: string;
}

export const EditableTable: React.FC<EditableTableProps> = ({
  data,
  columns,
  onDataChange,
  onAddRow,
  onDeleteRow,
  debounceMs = 2000, // Default 2 second debounce to prevent constant saves
  searchable = true,
  searchPlaceholder = 'Search table...',
}) => {
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [localData, setLocalData] = useState(data);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Resizable columns
  const columnKeys = columns.map(col => col.key);
  const { columnWidths, handleMouseDown, tableRef, isResizing } = useResizableColumns(columnKeys, 150);
  
  // Search functionality
  const searchableKeys = columns.map(col => col.key);
  const { searchTerm, setSearchTerm, filteredData: searchedData } = useTableSearch(localData, searchableKeys);
  
  // Sort functionality
  const { sortedData, sortConfig, handleSort } = useTableSort(searchedData);
  
  // Use sorted data for display
  const displayData = sortedData;

  React.useEffect(() => {
    setLocalData(data);
  }, [data]);

  const handleCellChange = (rowIndex: number, colKey: string, value: any) => {
    const oldValue = localData[rowIndex]?.[colKey];
    const newData = [...localData];
    newData[rowIndex] = { ...newData[rowIndex], [colKey]: value };
    setLocalData(newData);
    
    // Log date changes
    if (colKey.includes('date') || colKey === 'from_date' || colKey === 'to_date') {
      console.log(`📅 EditableTable: Date changed in row ${rowIndex}, ${colKey}:`, {
        oldValue: oldValue,
        newValue: value,
        rowData: newData[rowIndex],
      });
    }
    
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    // For text inputs, debounce the save. For checkboxes/selects, save immediately
    const isTextInput = columns.find(col => col.key === colKey)?.type === 'text' || 
                        columns.find(col => col.key === colKey)?.type === 'number';
    
    if (isTextInput && debounceMs > 0) {
      // Debounce text/number inputs
      debounceTimerRef.current = setTimeout(() => {
        console.log(`⏱️ EditableTable: Calling onDataChange after debounce for ${colKey}`);
        onDataChange(newData);
      }, debounceMs);
    } else {
      // Save immediately for checkboxes and selects
      console.log(`⚡ EditableTable: Calling onDataChange immediately for ${colKey}`);
      onDataChange(newData);
    }
    
    // Return the newData so callers can use it instead of stale localData
    return newData;
  };

  const handleBlur = () => {
    setEditingCell(null);
    // Save immediately when user leaves the field
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    console.log('👋 EditableTable: handleBlur called, saving data immediately');
    onDataChange(localData);
  };
  
  // Separate function for when we have updated data (e.g., from CalendarDatePicker)
  const handleBlurWithData = (updatedData: any[]) => {
    setEditingCell(null);
    // Save immediately when user leaves the field
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    console.log('👋 EditableTable: handleBlurWithData called, saving updated data immediately', {
      dataLength: updatedData.length,
      firstRow: updatedData[0],
    });
    onDataChange(updatedData);
  };

  const renderCell = (row: any, rowIndex: number, col: typeof columns[0]) => {
    const rawValue = row[col.key] ?? '';
    // Check if this is a date field (from_date, to_date, date, etc.)
    const isDateField = col.key.toLowerCase().includes('date') || col.key.toLowerCase().includes('_date');
    const isEditing = editingCell?.row === rowIndex && editingCell?.col === col.key;

    if (col.readOnly) {
      return <span className="text-sm">{isDateField ? formatDateDDMMYYYY(String(rawValue || '')) : String(rawValue || '')}</span>;
    }

    if (isEditing || !editingCell) {
      if (col.type === 'checkbox') {
        return (
          <input
            type="checkbox"
            checked={!!rawValue}
            onChange={(e) => handleCellChange(rowIndex, col.key, e.target.checked)}
            onBlur={handleBlur}
            className="mx-auto accent-primary-600"
          />
        );
      } else if (col.type === 'select' && col.options) {
        return (
          <select
            value={rawValue}
            onChange={(e) => handleCellChange(rowIndex, col.key, e.target.value)}
            onBlur={handleBlur}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
            autoFocus={isEditing}
          >
            {col.options.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      } else if (col.type === 'number') {
        return (
          <input
            type="number"
            value={rawValue ?? ''}
            onChange={(e) => {
              const inputValue = e.target.value;
              // Use parseFloat to support decimals and negative numbers
              if (inputValue === '') {
                handleCellChange(rowIndex, col.key, 0);
              } else {
                const numValue = parseFloat(inputValue);
                if (!isNaN(numValue)) {
                  handleCellChange(rowIndex, col.key, numValue);
                }
              }
            }}
            onBlur={handleBlur}
            min={col.min}
            max={col.max}
            step="any"
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-center"
            autoFocus={isEditing}
          />
        );
      } else if (isDateField) {
        // For date fields, use calendar date picker (returns YYYY-MM-DD format)
        // Normalize the value to YYYY-MM-DD format for the date picker
        const normalizedValue = rawValue ? (rawValue.match(/^\d{4}-\d{2}-\d{2}/) ? rawValue.split('T')[0] : parseDateToISO(String(rawValue))) : '';
        return (
          <div className="relative" style={{ zIndex: isEditing ? 1000 : 'auto' }}>
            <CalendarDatePicker
              value={normalizedValue}
              onChange={(date) => {
                console.log(`📅 CalendarDatePicker onChange: row ${rowIndex}, ${col.key}, date=${date}`);
                // Ensure date is in YYYY-MM-DD format
                const isoDate = date.match(/^\d{4}-\d{2}-\d{2}$/) ? date : parseDateToISO(date);
                console.log(`📅 CalendarDatePicker: normalized to ISO format: ${isoDate}`);
                
                // Validate date range if editing from_date or to_date
                if (col.key === 'from_date' || col.key === 'to_date') {
                  const currentRow = data[rowIndex];
                  const otherDateKey = col.key === 'from_date' ? 'to_date' : 'from_date';
                  const otherDate = parseDateToISO(currentRow[otherDateKey]);
                  
                  console.log(`📅 Date validation: ${col.key}=${isoDate}, ${otherDateKey}=${otherDate}`);
                  
                  if (otherDate && isoDate) {
                    if (col.key === 'from_date' && isoDate > otherDate) {
                      alert(`From date (${isoDate}) cannot be after To date (${otherDate})`);
                      console.warn(`❌ Date validation failed: from_date > to_date`);
                      return; // Don't update if invalid
                    }
                    if (col.key === 'to_date' && isoDate < otherDate) {
                      alert(`To date (${isoDate}) cannot be before From date (${otherDate})`);
                      console.warn(`❌ Date validation failed: to_date < from_date`);
                      return; // Don't update if invalid
                    }
                  }
                }
                
                console.log(`✅ CalendarDatePicker: Calling handleCellChange with ${isoDate}`);
                const updatedData = handleCellChange(rowIndex, col.key, isoDate);
                handleBlurWithData(updatedData); // Close edit mode after selection, pass updated data
              }}
              placeholder="Select date"
              className="w-full"
            />
          </div>
        );
      } else {
        return (
          <input
            type="text"
            value={rawValue}
            onChange={(e) => handleCellChange(rowIndex, col.key, e.target.value)}
            onBlur={handleBlur}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
            autoFocus={isEditing}
          />
        );
      }
    } else {
      return (
        <div
          onClick={() => setEditingCell({ row: rowIndex, col: col.key })}
          className="px-2 py-1 cursor-pointer hover:bg-gray-50 min-h-[32px] flex items-center"
        >
          {col.type === 'checkbox' ? (
            rawValue ? <span className="text-primary-600 font-semibold">✓</span> : ''
          ) : (
            isDateField ? formatDateDDMMYYYY(String(rawValue || '')) : String(rawValue || '')
          )}
        </div>
      );
    }
  };

  return (
    <div className="overflow-x-auto overflow-y-visible">
      <table ref={tableRef} className="min-w-full divide-y divide-gray-200 border border-gray-300" style={{ tableLayout: 'auto', width: '100%' }}>
        <thead className="bg-gray-50 sticky top-0 z-10">
          <tr>
            {columns.map((col, index) => {
              const width = columnWidths[col.key] || 150;
              const isLast = index === columns.length - 1 && !onDeleteRow;
              // Add min-width for number columns to ensure numbers are visible
              const minWidthClass = col.type === 'number' ? 'min-w-[80px]' : 
                                   col.readOnly && col.key === 'date' ? 'min-w-[120px]' :
                                   col.readOnly && col.key === 'day_name' ? 'min-w-[70px]' :
                                   '';
              return (
              <th
                key={col.key}
                style={{ width: `${width}px`, position: 'sticky', top: 0, zIndex: 10 }}
                className={`px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300 bg-gray-50 ${minWidthClass}`}
              >
                <div className="flex items-center justify-between">
                  <span>{col.label}</span>
                  {!isLast && (
                    <div
                      onMouseDown={(e) => handleMouseDown(e, col.key)}
                      className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${isResizing ? 'bg-blue-500' : ''}`}
                      style={{ userSelect: 'none' }}
                    />
                  )}
                </div>
              </th>
              );
            })}
            {onDeleteRow && (
              <th 
                style={{ width: '100px', position: 'sticky', top: 0, zIndex: 10 }}
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300 bg-gray-50"
              >
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {displayData.map((row, displayIndex) => {
            // Find original index in localData for editing/deleting
            // Use a combination of column values to find the matching row
            const findOriginalIndex = () => {
              // Try to find by matching all column values
              for (let i = 0; i < localData.length; i++) {
                const matches = columns.every(col => {
                  const rowVal = row[col.key];
                  const dataVal = localData[i][col.key];
                  // Handle null/undefined
                  if (rowVal == null && dataVal == null) return true;
                  if (rowVal == null || dataVal == null) return false;
                  // Compare values
                  return String(rowVal) === String(dataVal);
                });
                if (matches) return i;
              }
              // Fallback to display index if no match found
              return displayIndex;
            };
            const originalIndex = findOriginalIndex();
            return (
            <tr key={`row-${displayIndex}-${originalIndex}`} className="hover:bg-gray-50">
              {columns.map(col => {
                const width = columnWidths[col.key] || 150;
                // Add min-width for number columns to ensure numbers are visible
                const minWidthClass = col.type === 'number' ? 'min-w-[80px]' : 
                                     col.readOnly && col.key === 'date' ? 'min-w-[120px]' :
                                     col.readOnly && col.key === 'day_name' ? 'min-w-[70px]' :
                                     '';
                return (
                <td
                  key={col.key}
                  style={{ width: `${width}px` }}
                    className={`px-4 py-2 whitespace-nowrap text-sm border border-gray-300 ${minWidthClass} ${col.type === 'text' && col.key.toLowerCase().includes('date') ? 'relative overflow-visible' : ''}`}
                >
                  {renderCell(row, originalIndex, col)}
                </td>
                );
              })}
              {onDeleteRow && (
                <td style={{ width: '100px' }} className="px-4 py-2 whitespace-nowrap text-sm border border-gray-300">
                  <button
                    onClick={() => onDeleteRow(originalIndex)}
                    className="text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                </td>
              )}
            </tr>
          );
          })}
        </tbody>
      </table>
      {onAddRow && (
        <div className="mt-4">
          <button
            onClick={onAddRow}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            + Add Row
          </button>
        </div>
      )}
    </div>
  );
};

