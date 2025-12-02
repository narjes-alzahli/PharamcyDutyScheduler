import React, { ReactNode } from 'react';
import { useResizableColumns } from '../hooks/useResizableColumns';

interface ResizableTableProps {
  children: ReactNode;
  columnKeys: string[];
  defaultWidth?: number;
  className?: string;
}

export const ResizableTable: React.FC<ResizableTableProps> = ({
  children,
  columnKeys,
  defaultWidth = 150,
  className = 'min-w-full divide-y divide-gray-200 border border-gray-300'
}) => {
  const { columnWidths, handleMouseDown, tableRef, isResizing } = useResizableColumns(columnKeys, defaultWidth);

  // Clone children and inject resizing functionality
  const enhancedChildren = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      const childProps = child.props as { children?: React.ReactNode; style?: React.CSSProperties };
      if (child.type === 'thead') {
        // Enhance thead with resizable headers
        const theadChildren = React.Children.map(childProps.children, (row) => {
          if (React.isValidElement(row) && row.type === 'tr') {
            const rowProps = row.props as { children?: React.ReactNode };
            const cells = React.Children.map(rowProps.children, (cell, index) => {
              if (React.isValidElement(cell) && cell.type === 'th') {
                const cellProps = cell.props as { children?: React.ReactNode; style?: React.CSSProperties };
                const cellKey = (cell.key as string) || `col-${index}`;
                const width = columnWidths[cellKey] || defaultWidth;
                const isLast = index === React.Children.count(rowProps.children || []) - 1;
                
                return React.cloneElement(cell, {
                  key: cellKey,
                  style: { 
                    ...cellProps.style,
                    width: `${width}px`,
                    position: 'relative' as const
                  },
                  children: (
                    <>
                      {cellProps.children}
                      {!isLast && (
                        <div
                          onMouseDown={(e) => handleMouseDown(e, cellKey)}
                          className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 ${isResizing ? 'bg-blue-500' : ''}`}
                          style={{ userSelect: 'none' }}
                        />
                      )}
                    </>
                  )
                } as any);
              }
              return cell;
            });
            return React.cloneElement(row, { children: cells } as any);
          }
          return row;
        });
        return React.cloneElement(child, { children: theadChildren } as any);
      } else if (child.type === 'tbody') {
        // Enhance tbody cells with matching widths
        const tbodyChildren = React.Children.map(childProps.children, (row) => {
          if (React.isValidElement(row) && row.type === 'tr') {
            const rowProps = row.props as { children?: React.ReactNode };
            const cells = React.Children.map(rowProps.children, (cell, index) => {
              if (React.isValidElement(cell) && (cell.type === 'td' || cell.type === 'th')) {
                const cellProps = cell.props as { style?: React.CSSProperties };
                const cellKey = (cell.key as string) || `col-${index}`;
                const width = columnWidths[cellKey] || defaultWidth;
                return React.cloneElement(cell, {
                  key: cellKey,
                  style: {
                    ...cellProps.style,
                    width: `${width}px`
                  }
                } as any);
              }
              return cell;
            });
            return React.cloneElement(row, { children: cells } as any);
          }
          return row;
        });
        return React.cloneElement(child, { children: tbodyChildren } as any);
      }
    }
    return child;
  });

  return (
    <table ref={tableRef} className={className} style={{ tableLayout: 'fixed', width: '100%' }}>
      {enhancedChildren}
    </table>
  );
};

