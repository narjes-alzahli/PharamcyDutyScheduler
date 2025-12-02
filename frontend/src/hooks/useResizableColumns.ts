import { useState, useRef, useCallback, useEffect } from 'react';

export interface ColumnWidth {
  [key: string]: number;
}

export const useResizableColumns = (columnKeys: string[], defaultWidth: number = 150) => {
  const [columnWidths, setColumnWidths] = useState<ColumnWidth>(() => {
    const initial: ColumnWidth = {};
    columnKeys.forEach(key => {
      initial[key] = defaultWidth;
    });
    return initial;
  });

  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);
  const tableRef = useRef<HTMLTableElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent, columnKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn(columnKey);
    setStartX(e.clientX);
    const currentWidth = columnWidths[columnKey] || defaultWidth;
    setStartWidth(currentWidth);
  }, [columnWidths, defaultWidth]);

  useEffect(() => {
    if (!resizingColumn) return;

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - startX;
      const newWidth = Math.max(50, startWidth + diff); // Minimum width of 50px
      setColumnWidths(prev => ({
        ...prev,
        [resizingColumn]: newWidth
      }));
    };

    const handleMouseUp = () => {
      setResizingColumn(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn, startX, startWidth]);

  return {
    columnWidths,
    handleMouseDown,
    tableRef,
    isResizing: resizingColumn !== null
  };
};

