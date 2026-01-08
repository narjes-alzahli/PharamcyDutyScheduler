import React from 'react';
import Plot from 'react-plotly.js';
import { DistributionEntry } from '../utils/fairnessMetrics';
import { getColorsForDistribution } from '../utils/employeeColors';

interface PieChartProps {
  data: DistributionEntry[];
  title: string;
  colorMap: Map<string, string>;
  emptyMessage?: string;
  className?: string;
}

/**
 * Reusable pie chart component for shift distributions.
 * Displays labels and values inside the pie, with hover showing only name and count (no percentage).
 * Uses consistent colors for each employee across all charts.
 */
export const PieChart: React.FC<PieChartProps> = ({
  data,
  title,
  colorMap,
  emptyMessage = 'No data available',
  className = '',
}) => {
  if (!data || data.length === 0) {
    return (
      <div className={`min-w-[260px] rounded-lg bg-gray-50 p-4 text-center md:min-w-0 ${className}`}>
        <p className="text-gray-600">{emptyMessage}</p>
      </div>
    );
  }

  const colors = getColorsForDistribution(data, colorMap);

  return (
    <div className={`rounded-lg border border-gray-100 p-2 shadow-sm space-y-1.5 w-full ${className}`}>
      <h4 className="text-xs font-semibold text-gray-800 mb-1">{title}</h4>
      <Plot
        data={[{
          type: 'pie',
          values: data.map(d => d.count),
          labels: data.map(d => d.emp),
          textinfo: 'label+value',
          textposition: 'inside',
          hovertemplate: '%{label}<br>%{value}<extra></extra>',
          marker: { colors: colors },
          // Plotly pie charts maintain the order of the data array
          // The data is already reversed in toDistribution function
        }]}
        layout={{
          height: 220,
          showlegend: false,
          autosize: true,
          margin: { l: 5, r: 5, t: 5, b: 5 },
        }}
        config={{ responsive: true }}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};

