import React, { useState, useRef } from 'react';
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
    const newData = [...localData];
    newData[rowIndex] = { ...newData[rowIndex], [colKey]: value };
    setLocalData(newData);
    
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
        onDataChange(newData);
      }, debounceMs);
    } else {
      // Save immediately for checkboxes and selects
      onDataChange(newData);
    }
  };

  const handleBlur = () => {
    setEditingCell(null);
    // Save immediately when user leaves the field
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    onDataChange(localData);
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
            value={rawValue}
            onChange={(e) => handleCellChange(rowIndex, col.key, parseInt(e.target.value) || 0)}
            onBlur={handleBlur}
            min={col.min}
            max={col.max}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-center"
            autoFocus={isEditing}
          />
        );
      } else if (isDateField) {
        // For date fields, use text input with DD-MM-YYYY format
        const displayValue = formatDateDDMMYYYY(rawValue);
        return (
          <input
            type="text"
            value={displayValue}
            onChange={(e) => {
              // Convert DD-MM-YYYY back to YYYY-MM-DD for storage
              const isoDate = parseDateToISO(e.target.value);
              handleCellChange(rowIndex, col.key, isoDate);
            }}
            onBlur={handleBlur}
            placeholder="DD-MM-YYYY"
            pattern="\d{2}-\d{2}-\d{4}"
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
            autoFocus={isEditing}
          />
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
    <div className="overflow-x-auto">
      <table ref={tableRef} className="min-w-full divide-y divide-gray-200 border border-gray-300" style={{ tableLayout: 'fixed', width: '100%' }}>
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
                    className={`px-4 py-2 whitespace-nowrap text-sm border border-gray-300 ${minWidthClass}`}
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

