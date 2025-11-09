import React, { useState, useRef } from 'react';

interface EditableTableProps {
  data: any[];
  columns: Array<{
    key: string;
    label: string;
    type?: 'text' | 'number' | 'checkbox' | 'select';
    options?: string[];
    min?: number;
    max?: number;
  }>;
  onDataChange: (newData: any[]) => void;
  onAddRow?: () => void;
  onDeleteRow?: (index: number) => void;
  debounceMs?: number; // Optional debounce delay
}

export const EditableTable: React.FC<EditableTableProps> = ({
  data,
  columns,
  onDataChange,
  onAddRow,
  onDeleteRow,
  debounceMs = 2000, // Default 2 second debounce to prevent constant saves
}) => {
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [localData, setLocalData] = useState(data);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

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
    const isEditing = editingCell?.row === rowIndex && editingCell?.col === col.key;
    const value = row[col.key] ?? '';

    if (isEditing || !editingCell) {
      if (col.type === 'checkbox') {
        return (
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => handleCellChange(rowIndex, col.key, e.target.checked)}
            onBlur={handleBlur}
            className="mx-auto accent-primary-600"
          />
        );
      } else if (col.type === 'select' && col.options) {
        return (
          <select
            value={value}
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
            value={value}
            onChange={(e) => handleCellChange(rowIndex, col.key, parseInt(e.target.value) || 0)}
            onBlur={handleBlur}
            min={col.min}
            max={col.max}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-center"
            autoFocus={isEditing}
          />
        );
      } else {
        return (
          <input
            type="text"
            value={value}
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
            value ? <span className="text-primary-600 font-semibold">✓</span> : ''
          ) : (
            String(value || '')
          )}
        </div>
      );
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
        <thead className="bg-gray-50">
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300"
              >
                {col.label}
              </th>
            ))}
            {onDeleteRow && <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">Actions</th>}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {localData.map((row, rowIndex) => (
            <tr key={rowIndex} className="hover:bg-gray-50">
              {columns.map(col => (
                <td
                  key={col.key}
                  className="px-4 py-2 whitespace-nowrap text-sm border border-gray-300"
                >
                  {renderCell(row, rowIndex, col)}
                </td>
              ))}
              {onDeleteRow && (
                <td className="px-4 py-2 whitespace-nowrap text-sm border border-gray-300">
                  <button
                    onClick={() => onDeleteRow(rowIndex)}
                    className="text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                </td>
              )}
            </tr>
          ))}
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

