import React, { useState } from 'react';
import Plot from 'react-plotly.js';

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

  // Calculate employee shift counts
  const employeeShiftCounts: { [key: string]: number } = {};
  schedule.forEach((s: any) => {
    employeeShiftCounts[s.employee] = (employeeShiftCounts[s.employee] || 0) + 1;
  });

  // Fairness analysis - shift distribution by employee
  const nightShifts = ['N'];
  const afternoonShifts = ['A'];
  const mainShiftTypes = ['M', 'M3', 'M4'];

  const nightData = schedule.filter((s: any) => nightShifts.includes(s.shift));
  const afternoonData = schedule.filter((s: any) => afternoonShifts.includes(s.shift));
  const mainData = schedule.filter((s: any) => mainShiftTypes.includes(s.shift));

  // Calculate night shift distribution
  const nightCounts: { [key: string]: number } = {};
  nightData.forEach((s: any) => {
    nightCounts[s.employee] = (nightCounts[s.employee] || 0) + 1;
  });

  // Calculate afternoon shift distribution
  const afternoonCounts: { [key: string]: number } = {};
  afternoonData.forEach((s: any) => {
    afternoonCounts[s.employee] = (afternoonCounts[s.employee] || 0) + 1;
  });

  // Calculate main shift distribution
  const mainCounts: { [key: string]: number } = {};
  mainData.forEach((s: any) => {
    mainCounts[s.employee] = (mainCounts[s.employee] || 0) + 1;
  });

  // Calculate total shifts per employee
  const totalShiftsPerEmployee: { [key: string]: number } = {};
  schedule.forEach((s: any) => {
    totalShiftsPerEmployee[s.employee] = (totalShiftsPerEmployee[s.employee] || 0) + 1;
  });

  return (
    <div className="mt-8 space-y-4">
      <h3 className="text-xl font-bold text-gray-900">📈 Schedule Analysis</h3>

      {/* Schedule Summary */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <button
          onClick={() => toggleSection('summary')}
          className="w-full px-4 py-3 text-left font-semibold text-gray-900 hover:bg-gray-50 flex justify-between items-center"
        >
          <span>📊 Schedule Summary - Key numbers and metrics</span>
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
          <span>🔍 Fairness Analysis - How fair is the schedule?</span>
          <span>{expandedSections.fairness ? '▼' : '▶'}</span>
        </button>
        {expandedSections.fairness && (
          <div className="p-4 border-t border-gray-200 space-y-6">
            {/* Fairness Metrics */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              {(() => {
                const workingShifts = ['M', 'IP', 'A', 'N', 'M3', 'M4', 'H', 'CL'];
                const workingData = schedule.filter((s: any) => workingShifts.includes(s.shift));
                const workingCounts: { [key: string]: number } = {};
                workingData.forEach((s: any) => {
                  workingCounts[s.employee] = (workingCounts[s.employee] || 0) + 1;
                });
                const counts = Object.values(workingCounts);
                const maxWork = Math.max(...counts);
                const minWork = Math.min(...counts);
                const avgWork = counts.reduce((a, b) => a + b, 0) / counts.length;
                const nonMaxCounts = counts.filter(c => c < maxWork);
                const maxWorkNonClinical = nonMaxCounts.length > 0 ? Math.max(...nonMaxCounts) : maxWork;
                const fairnessScore = 1 - (maxWorkNonClinical - minWork) / Math.max(maxWorkNonClinical, 1);

                return (
                  <>
                    <div className="bg-gray-50 p-4 rounded">
                      <p className="text-sm text-gray-600">Min Working Days</p>
                      <p className="text-2xl font-bold">{minWork}</p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded">
                      <p className="text-sm text-gray-600">Max Working Days (Non-Clinical)</p>
                      <p className="text-2xl font-bold">{maxWorkNonClinical}</p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded">
                      <p className="text-sm text-gray-600">Avg Working Days</p>
                      <p className="text-2xl font-bold">{avgWork.toFixed(1)}</p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded">
                      <p className="text-sm text-gray-600">Fairness Score</p>
                      <p className="text-2xl font-bold">{fairnessScore.toFixed(2)}</p>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Night Shift Distribution */}
              {Object.keys(nightCounts).length > 0 ? (
                <div>
                  <h4 className="font-semibold mb-2">🌙 Night Shift Distribution</h4>
                  <Plot
                    data={[
                      {
                        values: Object.values(nightCounts),
                        labels: Object.keys(nightCounts),
                        type: 'pie',
                      },
                    ]}
                    layout={{
                      title: 'Night Shift Distribution',
                      height: 300,
                    }}
                    config={{ responsive: true }}
                    style={{ width: '100%' }}
                  />
                </div>
              ) : (
                <div className="bg-gray-50 p-4 rounded text-center">
                  <p className="text-gray-500">No night shifts assigned</p>
                </div>
              )}

              {/* Afternoon Shift Distribution */}
              {Object.keys(afternoonCounts).length > 0 ? (
                <div>
                  <h4 className="font-semibold mb-2">🌅 Afternoon Shift Distribution</h4>
                  <Plot
                    data={[
                      {
                        values: Object.values(afternoonCounts),
                        labels: Object.keys(afternoonCounts),
                        type: 'pie',
                      },
                    ]}
                    layout={{
                      title: 'Afternoon Shift Distribution',
                      height: 300,
                    }}
                    config={{ responsive: true }}
                    style={{ width: '100%' }}
                  />
                </div>
              ) : (
                <div className="bg-gray-50 p-4 rounded text-center">
                  <p className="text-gray-500">No afternoon shifts assigned</p>
                </div>
              )}

              {/* Weekend Shift Distribution */}
              {(() => {
                const weekendShifts = schedule.filter((s: any) => {
                  const date = new Date(s.date);
                  const day = date.getDay();
                  return day === 5 || day === 6; // Friday or Saturday
                });
                const weekendCounts: { [key: string]: number } = {};
                weekendShifts.forEach((s: any) => {
                  weekendCounts[s.employee] = (weekendCounts[s.employee] || 0) + 1;
                });
                return Object.keys(weekendCounts).length > 0 ? (
                  <div>
                    <h4 className="font-semibold mb-2">📅 Weekend Shift Distribution</h4>
                    <Plot
                      data={[
                        {
                          values: Object.values(weekendCounts),
                          labels: Object.keys(weekendCounts),
                          type: 'pie',
                        },
                      ]}
                      layout={{
                        title: 'Weekend Shift Distribution',
                        height: 300,
                      }}
                      config={{ responsive: true }}
                      style={{ width: '100%' }}
                    />
                  </div>
                ) : (
                  <div className="bg-gray-50 p-4 rounded text-center">
                    <p className="text-gray-500">No weekend shifts assigned</p>
                  </div>
                );
              })()}

              {/* Total Working Days */}
              {(() => {
                const workingShifts = ['M', 'IP', 'A', 'N', 'M3', 'M4', 'H', 'CL'];
                const workingData = schedule.filter((s: any) => workingShifts.includes(s.shift));
                const workingCounts: { [key: string]: number } = {};
                workingData.forEach((s: any) => {
                  workingCounts[s.employee] = (workingCounts[s.employee] || 0) + 1;
                });
                const sortedEntries = Object.entries(workingCounts).sort((a, b) => a[1] - b[1]);
                return sortedEntries.length > 0 ? (
                  <div>
                    <h4 className="font-semibold mb-2">📊 Total Working Days</h4>
                    <Plot
                      data={[
                        {
                          x: sortedEntries.map(e => e[1]),
                          y: sortedEntries.map(e => e[0]),
                          type: 'bar',
                          orientation: 'h',
                          marker: { color: 'lightcoral' },
                        },
                      ]}
                      layout={{
                        title: 'Total Working Days',
                        xaxis: { title: 'Working Days' },
                        yaxis: { title: 'Employee' },
                        height: Math.max(300, sortedEntries.length * 20 + 100),
                      }}
                      config={{ responsive: true }}
                      style={{ width: '100%' }}
                    />
                  </div>
                ) : (
                  <div className="bg-gray-50 p-4 rounded text-center">
                    <p className="text-gray-500">No working shifts assigned</p>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Employee Details */}
      {employees && employees.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg">
          <button
            onClick={() => toggleSection('employeeDetails')}
            className="w-full px-4 py-3 text-left font-semibold text-gray-900 hover:bg-gray-50 flex justify-between items-center"
          >
            <span>👥 Employee Details - Individual staff information</span>
            <span>{expandedSections.employeeDetails ? '▼' : '▶'}</span>
          </button>
          {expandedSections.employeeDetails && (
            <div className="p-4 border-t border-gray-200">
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Total Employees</p>
                  <p className="text-2xl font-bold">{employees.length}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Avg Pending Off</p>
                  <p className="text-2xl font-bold">
                    {(
                      employees.reduce((sum: number, emp: any) => sum + (emp.pending_off || 0), 0) /
                      employees.length
                    ).toFixed(1)}
                  </p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Max Pending Off</p>
                  <p className="text-2xl font-bold">
                    {Math.max(...employees.map((emp: any) => emp.pending_off || 0))}
                  </p>
                </div>
              </div>

              {/* Pending Off Chart */}
              <div>
                <h4 className="font-semibold mb-2">Pending Off Days</h4>
                <Plot
                  data={[
                    {
                      x: employees
                        .sort((a: any, b: any) => (a.pending_off || 0) - (b.pending_off || 0))
                        .map((emp: any) => emp.employee),
                      y: employees
                        .sort((a: any, b: any) => (a.pending_off || 0) - (b.pending_off || 0))
                        .map((emp: any) => emp.pending_off || 0),
                      type: 'bar',
                      marker: { color: '#4ECDC4' },
                    },
                  ]}
                  layout={{
                    xaxis: { title: 'Employee' },
                    yaxis: { title: 'Pending Off Days' },
                    height: 300,
                  }}
                  config={{ responsive: true }}
                  style={{ width: '100%' }}
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
            <span>⚙️ Technical Details - How the schedule was created</span>
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

