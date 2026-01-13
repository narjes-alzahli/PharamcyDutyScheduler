import React, { useState, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { calculateFairnessData, FairnessData } from '../utils/fairnessMetrics';
import { FairnessLineGraph } from './FairnessLineGraph';

interface ScheduleAnalysisProps {
  schedule: any[];
  employees?: any[];
  metrics?: any;
  year: number;
  month: number;
}

export const ScheduleAnalysis: React.FC<ScheduleAnalysisProps> = ({
  schedule,
  employees,
  metrics,
  year,
  month,
}) => {
  const [expandedSections, setExpandedSections] = useState({
    summary: false,
    fairness: false,
    employeeDetails: false,
    technical: false,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Calculate metrics
  const totalAssignments = schedule.length;
  const uniqueEmployees = new Set(schedule.map((s: any) => s.employee)).size;
  const uniqueDates = new Set(schedule.map((s: any) => s.date.split('T')[0])).size;
  const mainShifts = schedule.filter((s: any) => ['M', 'M3', 'M4'].includes(s.shift)).length;

  // Calculate shift distribution
  const shiftCounts: { [key: string]: number } = {};
  schedule.forEach((s: any) => {
    shiftCounts[s.shift] = (shiftCounts[s.shift] || 0) + 1;
  });

  // Get employee order from employees prop (same as schedule table)
  const employeeOrder = useMemo(() => {
    if (!employees || employees.length === 0) return undefined;
    return employees.map((emp: any) => emp.employee);
  }, [employees]);

  const fairnessData = calculateFairnessData(schedule, employeeOrder);

  const employeeDetails = employees || [];
  // Use employee order from schedule instead of sorting by pending_off
  // Reverse the order so graphs start with the last employee
  const orderedEmployeesByPendingOff = employeeOrder
    ? employeeDetails.slice().sort((a: any, b: any) => {
        const aIdx = employeeOrder.indexOf(a.employee);
        const bIdx = employeeOrder.indexOf(b.employee);
        if (aIdx === -1 && bIdx === -1) return 0;
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return bIdx - aIdx; // Reverse: bIdx - aIdx instead of aIdx - bIdx
      })
    : employeeDetails.slice().sort((a: any, b: any) => (a.pending_off || 0) - (b.pending_off || 0));
  const pendingOffValues = orderedEmployeesByPendingOff.map(
    (emp: any) => emp.pending_off || 0
  );
  const totalEmployees = employeeDetails.length;
  const averagePendingOff =
    totalEmployees > 0
      ? employeeDetails.reduce(
          (sum: number, emp: any) => sum + (emp.pending_off || 0),
          0
        ) / totalEmployees
      : 0;
  const maxPendingOff =
    pendingOffValues.length > 0 ? Math.max(...pendingOffValues) : 0;

  return (
    <div className="mt-8 space-y-4">
      <h3 className="text-xl font-bold text-gray-900">Schedule Analysis</h3>

      {/* Schedule Summary */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <button
          onClick={() => toggleSection('summary')}
          className="w-full px-4 py-3 text-left font-semibold text-gray-900 hover:bg-gray-50 flex justify-between items-center"
        >
          <span>Schedule Summary</span>
          <span>{expandedSections.summary ? '▼' : '▶'}</span>
        </button>
        {expandedSections.summary && (
          <div className="p-4 border-t border-gray-200">
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-gray-50 p-4 rounded">
                <p className="text-sm text-gray-600">Total Assignments</p>
                <p className="text-2xl font-bold">{totalAssignments}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded">
                <p className="text-sm text-gray-600">Employees</p>
                <p className="text-2xl font-bold">{uniqueEmployees}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded">
                <p className="text-sm text-gray-600">Days</p>
                <p className="text-2xl font-bold">{uniqueDates}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded">
                <p className="text-sm text-gray-600">Main Shifts</p>
                <p className="text-2xl font-bold">{mainShifts}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Fairness Analysis */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <button
          onClick={() => toggleSection('fairness')}
          className="w-full px-4 py-3 text-left font-semibold text-gray-900 hover:bg-gray-50 flex justify-between items-center"
        >
          <span>Fairness Analysis</span>
          <span>{expandedSections.fairness ? '▼' : '▶'}</span>
        </button>
        {expandedSections.fairness && (
          <div className="p-4 border-t border-gray-200">
            <FairnessLineGraph
              fairnessData={fairnessData}
              employeeOrder={employeeOrder}
              employees={employees}
            />
          </div>
        )}
      </div>

      {/* Pending Off */}
      {employeeDetails.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg">
          <button
            onClick={() => toggleSection('employeeDetails')}
            className="w-full px-4 py-3 text-left font-semibold text-gray-900 hover:bg-gray-50 flex justify-between items-center"
          >
            <span>Pending Off</span>
            <span>{expandedSections.employeeDetails ? '▼' : '▶'}</span>
          </button>
          {expandedSections.employeeDetails && (
            <div className="p-4 border-t border-gray-200">
              {/* Pending Off Chart */}
              <div className="w-full">
                <Plot
                  data={[
                    {
                      x: orderedEmployeesByPendingOff.map((emp: any) => emp.employee),
                      y: pendingOffValues,
                      type: 'bar',
                      text: pendingOffValues.map((value: number) => Math.round(value).toString()),
                      textposition: 'auto',
                      marker: { color: '#5DADE2' },
                    },
                  ]}
                  layout={{
                    xaxis: { title: 'Employee' },
                    yaxis: { title: 'Pending Off Days' },
                    height: 200,
                    margin: { l: 50, r: 10, t: 10, b: 60 },
                    autosize: true,
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Technical Details */}
      {metrics && (
        <div className="bg-white border border-gray-200 rounded-lg">
          <button
            onClick={() => toggleSection('technical')}
            className="w-full px-4 py-3 text-left font-semibold text-gray-900 hover:bg-gray-50 flex justify-between items-center"
          >
            <span>Technical Details</span>
            <span>{expandedSections.technical ? '▼' : '▶'}</span>
          </button>
          {expandedSections.technical && (
            <div className="p-4 border-t border-gray-200">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Solve Time</p>
                  <p className="text-2xl font-bold">{metrics.solve_time?.toFixed(2) || '0.00'}s</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Status</p>
                  <p className="text-2xl font-bold">{metrics.status || 'Unknown'}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

