import React, { useState, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { FairnessData, DistributionEntry } from '../utils/fairnessMetrics';

interface FairnessLineGraphProps {
  fairnessData: FairnessData;
  employeeOrder?: string[];
  employees?: any[]; // Employee data with skills to filter single skill employees
  className?: string;
}

type MetricType = 'night' | 'afternoon' | 'm4' | 'weekend' | 'thursday' | 'working';

// Color palette for better visibility
const METRIC_COLORS: Record<MetricType, string> = {
  night: '#1f77b4',        // Blue
  afternoon: '#ff7f0e',   // Orange
  m4: '#2ca02c',          // Green
  weekend: '#d62728',     // Red
  thursday: '#9467bd',     // Purple
  working: '#8c564b',     // Brown
};

const METRIC_CONFIG: Record<MetricType, { label: string; dataKey: keyof FairnessData }> = {
  night: { label: 'Night Shifts', dataKey: 'nightData' },
  afternoon: { label: 'Afternoon Shifts', dataKey: 'afternoonData' },
  m4: { label: 'M4 Shifts', dataKey: 'm4Data' },
  weekend: { label: 'Weekend Shifts', dataKey: 'weekendData' },
  thursday: { label: 'Thursday Shifts', dataKey: 'thursdayData' },
  working: { label: 'Total Working Days', dataKey: 'workingData' },
};

export const FairnessLineGraph: React.FC<FairnessLineGraphProps> = ({
  fairnessData,
  employeeOrder,
  employees,
  className = '',
}) => {
  const [visibleMetrics, setVisibleMetrics] = useState<Set<MetricType>>(
    new Set<MetricType>(['night', 'afternoon', 'm4'] as MetricType[]) // Default to night, afternoon, m4
  );

  // Identify single skill employees (employees with only one skill)
  const singleSkillEmployees = useMemo(() => {
    if (!employees || employees.length === 0) return new Set<string>();
    
    const singleSkillSet = new Set<string>();
    employees.forEach((emp: any) => {
      // Check if employee object has skill properties (might be undefined if not loaded)
      if (!emp || typeof emp !== 'object') return;
      
      const skills = [
        emp.skill_M,
        emp.skill_IP,
        emp.skill_A,
        emp.skill_N,
        emp.skill_M3,
        emp.skill_M4,
        emp.skill_H,
        emp.skill_CL,
        emp.skill_E,
      ].filter(skill => skill === true); // Only count true values, not false or undefined
      
      if (skills.length === 1) {
        const employeeName = emp.employee || emp.name || String(emp);
        singleSkillSet.add(employeeName);
      }
    });
    
    return singleSkillSet;
  }, [employees]);

  // Get all unique employees from all metrics, excluding single skill employees
  const allEmployees = useMemo(() => {
    const employeeSet = new Set<string>();
    Object.values(METRIC_CONFIG).forEach(({ dataKey }) => {
      const data = fairnessData[dataKey] as DistributionEntry[] | undefined;
      if (data) {
        data.forEach(d => {
          // Filter out single skill employees
          if (!singleSkillEmployees.has(d.emp)) {
            employeeSet.add(d.emp);
          }
        });
      }
    });
    
    // If employeeOrder is provided, use it to ensure consistent ordering
    if (employeeOrder && employeeOrder.length > 0) {
      // Return employees in order, but only those that exist in the data and are not single skill
      return employeeOrder.filter(emp => employeeSet.has(emp) && !singleSkillEmployees.has(emp));
    }
    
    // Otherwise, return sorted employees
    return Array.from(employeeSet).sort();
  }, [fairnessData, employeeOrder, singleSkillEmployees]);

  // Prepare data for all chart types
  const metricDataMap = useMemo(() => {
    const map = new Map<MetricType, Map<string, number>>();
    
    Object.entries(METRIC_CONFIG).forEach(([metricType, config]) => {
      const data = fairnessData[config.dataKey] as DistributionEntry[] | undefined;
      if (data && data.length > 0) {
        const empMap = new Map(data.map(d => [d.emp, d.count]));
        map.set(metricType as MetricType, empMap);
      }
    });
    
    return map;
  }, [fairnessData]);

  // Prepare plot data for bar chart
  const plotData = useMemo(() => {
    const traces: any[] = [];
    const visibleMetricsArray = Array.from(visibleMetrics);
    
    // Grouped bar chart - one trace per metric
    visibleMetricsArray.forEach((metricType) => {
      const empMap = metricDataMap.get(metricType);
      if (!empMap) return;
      
      const values = allEmployees.map(emp => empMap.get(emp) || 0);
      const config = METRIC_CONFIG[metricType];
      
      traces.push({
        type: 'bar',
        name: config.label,
        x: allEmployees,
        y: values,
        marker: { color: METRIC_COLORS[metricType] },
        hovertemplate: `<b>${config.label}</b>: %{y}<extra></extra>`,
      });
    });
    
    return traces;
  }, [fairnessData, allEmployees, visibleMetrics, metricDataMap]);

  const toggleMetric = (metric: MetricType) => {
    setVisibleMetrics(prev => {
      const next = new Set(prev);
      if (next.has(metric)) {
        next.delete(metric);
      } else {
        next.add(metric);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (visibleMetrics.size === Object.keys(METRIC_CONFIG).length) {
      // All visible, hide all
      setVisibleMetrics(new Set());
    } else {
      // Some or none visible, show all
      setVisibleMetrics(new Set(Object.keys(METRIC_CONFIG) as MetricType[]));
    }
  };

  if (allEmployees.length === 0) {
    return (
      <div className={`rounded-lg bg-gray-50 p-4 text-center ${className}`}>
        <p className="text-gray-600">No data available</p>
      </div>
    );
  }

  // Get layout for bar chart
  const getLayout = () => {
    return {
      title: {
        text: 'Fairness Analysis',
        font: { size: 18, color: '#111827' },
      },
      height: 500,
      margin: { l: 60, r: 20, t: 60, b: 150 }, // Increased bottom margin for better label visibility
      xaxis: {
        title: 'Employee',
        tickangle: -90, // Vertical labels for better readability
        tickfont: { size: 11 },
        automargin: true, // Automatically adjust margins
      },
      yaxis: {
        title: 'Count',
      },
      hovermode: 'x unified',
      hoverlabel: {
        bgcolor: 'rgba(255, 255, 255, 0.95)',
        bordercolor: '#888',
        font: { size: 12 },
      },
      showlegend: false,
      barmode: 'group',
    };
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Filter Controls */}
      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleAll}
              className="text-sm font-medium text-gray-700 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-200 transition-colors"
            >
              {visibleMetrics.size === Object.keys(METRIC_CONFIG).length ? 'Hide All' : 'Show All'}
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            {Object.entries(METRIC_CONFIG).map(([metricType, config]) => {
              const isVisible = visibleMetrics.has(metricType as MetricType);
              const metricData = fairnessData[config.dataKey] as DistributionEntry[] | undefined;
              const hasData = metricData && metricData.length > 0;
              const metricTypeKey = metricType as MetricType;
              const metricColor = METRIC_COLORS[metricTypeKey];
              
              return (
                <label
                  key={metricType}
                  className={`flex items-center gap-2 cursor-pointer ${
                    !hasData ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => toggleMetric(metricTypeKey)}
                    disabled={!hasData}
                    className="w-4 h-4 rounded border-2 focus:ring-2 focus:ring-offset-1"
                    style={{
                      accentColor: metricColor,
                      borderColor: isVisible ? metricColor : '#d1d5db',
                      cursor: hasData ? 'pointer' : 'not-allowed',
                    }}
                  />
                  <span 
                    className={`text-sm ${isVisible ? 'font-medium text-gray-900' : 'text-gray-600'}`}
                    style={{ color: isVisible ? metricColor : undefined }}
                  >
                    {config.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
        {plotData.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500">Select at least one metric to display</p>
          </div>
        ) : (
          <Plot
            data={plotData}
            layout={getLayout()}
            config={{ responsive: true, displayModeBar: true }}
            style={{ width: '100%', height: '100%' }}
          />
        )}
      </div>
    </div>
  );
};
