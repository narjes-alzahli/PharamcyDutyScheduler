import React, { useState, useEffect, useMemo } from 'react';
import { schedulesAPI, Schedule } from '../services/api';
import Plot from 'react-plotly.js';
import { calculateFairnessData, FairnessData } from '../utils/fairnessMetrics';

export const ReportsPage: React.FC = () => {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [currentSchedule, setCurrentSchedule] = useState<Schedule | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  useEffect(() => {
    loadSchedules();
  }, []);

  useEffect(() => {
    if (selectedYear && selectedMonth) {
      loadSchedule(selectedYear, selectedMonth);
    }
  }, [selectedYear, selectedMonth]);

  const loadSchedules = async () => {
    try {
      setLoading(true);
      const data = await schedulesAPI.getCommittedSchedules();
      setSchedules(data);
      if (data.length === 0) {
        setSelectedYear(null);
        setSelectedMonth(null);
        setCurrentSchedule(null);
      } else if (
        selectedYear &&
        selectedMonth &&
        !data.some((s) => s.year === selectedYear && s.month === selectedMonth)
      ) {
        setCurrentSchedule(null);
        setSelectedMonth(null);
      }
    } catch (error) {
      console.error('Failed to load schedules:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSchedule = async (year: number, month: number) => {
    try {
      const schedule = await schedulesAPI.getSchedule(year, month);
      setCurrentSchedule(schedule);
    } catch (error) {
      console.error('Failed to load schedule:', error);
      setCurrentSchedule(null);
    }
  };

  // Get available years and months
  const availableYears = Array.from(new Set(schedules.map(s => s.year))).sort();
  const availableMonths = selectedYear
    ? Array.from(
        new Set(
          schedules
            .filter(s => s.year === selectedYear)
            .map(s => s.month)
        )
      ).sort()
    : [];

  // Filter schedule data for selected month
  const getMonthSchedule = () => {
    if (!currentSchedule || !selectedYear || !selectedMonth) return [];
    return currentSchedule.schedule.filter((entry: any) => {
      const date = new Date(entry.date);
      return date.getFullYear() === selectedYear && date.getMonth() + 1 === selectedMonth;
    });
  };

  const monthSchedule = getMonthSchedule();

  // Calculate metrics
  const calculateMetrics = () => {
    if (!monthSchedule.length) return null;

    const uniqueEmployees = new Set(monthSchedule.map((s: any) => s.employee));
    const uniqueDates = new Set(monthSchedule.map((s: any) => s.date.split('T')[0]));
    const mainShifts = monthSchedule.filter((s: any) => ['M', 'M3', 'M4'].includes(s.shift)).length;

    return {
      totalAssignments: monthSchedule.length,
      employees: uniqueEmployees.size,
      days: uniqueDates.size,
      mainShifts,
    };
  };

  const fairnessData: FairnessData | null = useMemo(() => {
    if (!monthSchedule.length) return null;
    return calculateFairnessData(monthSchedule);
  }, [monthSchedule]);
  const metrics = calculateMetrics();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const tabs = [
    { id: 'overview', name: '📊 Overview' },
    { id: 'fairness', name: '📈 Fairness Analysis' },
    { id: 'pending-off', name: '👥 Employee Pending Off' },
    { id: 'solver', name: '⚙️ Solver Metrics' },
  ];

  return (
    <div>
      <h2 className="text-3xl font-bold text-gray-900 mb-6">Reports & Visualization</h2>

      {schedules.length === 0 ? (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
          No committed schedules available. Please generate and commit a schedule in the Roster Generator first.
        </div>
      ) : (
        <>
          {/* Year and Month Selection */}
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Select Year</label>
                <select
                  value={selectedYear || ''}
                  onChange={(e) => {
                    setSelectedYear(e.target.value ? parseInt(e.target.value) : null);
                    setSelectedMonth(null);
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select Year...</option>
                  {availableYears.map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Select Month</label>
                <select
                  value={selectedMonth || ''}
                  onChange={(e) => setSelectedMonth(e.target.value ? parseInt(e.target.value) : null)}
                  disabled={!selectedYear}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100"
                >
                  <option value="">Select Month...</option>
                  {availableMonths.map(month => (
                    <option key={month} value={month}>{monthNames[month - 1]}</option>
                  ))}
                </select>
              </div>
            </div>

            {(!selectedYear || !selectedMonth) && (
              <div className="mt-4 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded">
                Please select both a year and month to view reports.
              </div>
            )}
          </div>

          {selectedYear && selectedMonth && currentSchedule && monthSchedule.length > 0 ? (
            <div className="bg-white rounded-lg shadow">
              {/* Tabs */}
              <div className="border-b border-gray-200">
                <nav className="flex -mb-px overflow-x-auto">
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-6 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                        activeTab === tab.id
                          ? 'border-primary-500 text-primary-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      {tab.name}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="p-6">
                {/* Overview Tab */}
                {activeTab === 'overview' && metrics && (
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 mb-4">Monthly Overview</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-600">Total Assignments</p>
                        <p className="text-2xl font-bold">{metrics.totalAssignments}</p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-600">Employees</p>
                        <p className="text-2xl font-bold">{metrics.employees}</p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-600">Days</p>
                        <p className="text-2xl font-bold">{metrics.days}</p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-600">Main Shifts</p>
                        <p className="text-2xl font-bold">{metrics.mainShifts}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Fairness Analysis Tab */}
                {activeTab === 'fairness' && fairnessData && (
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 mb-4">Fairness Analysis</h3>
                    
                    {/* Fairness Metrics */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-600">Min Working Days</p>
                        <p className="text-2xl font-bold">{fairnessData.metrics.minWork}</p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-600">Max Working Days</p>
                        <p className="text-2xl font-bold">{fairnessData.metrics.maxWork}</p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-600">Avg Working Days</p>
                        <p className="text-2xl font-bold">{fairnessData.metrics.avgWork.toFixed(1)}</p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-600">Fairness Score</p>
                        <p className="text-2xl font-bold">{fairnessData.metrics.fairnessScore.toFixed(2)}</p>
                      </div>
                    </div>

                    <div className="border-t border-gray-200 pt-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* Night Shift Distribution */}
                        {fairnessData.nightData.length > 0 ? (
                          <div>
                            <Plot
                              data={[{
                                type: 'pie',
                                values: fairnessData.nightData.map(d => d.count),
                                labels: fairnessData.nightData.map(d => d.emp),
                                textinfo: 'percent+label',
                                textposition: 'inside',
                                marker: { colors: ['#FFB6C1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'] },
                              }]}
                              layout={{
                                title: '🌙 Night Shift Distribution',
                                height: 300,
                              }}
                              style={{ width: '100%' }}
                            />
                          </div>
                        ) : (
                          <div className="bg-gray-50 p-4 rounded-lg text-center">
                            <p className="text-gray-600">No night shifts assigned</p>
                          </div>
                        )}

                        {/* Afternoon Shift Distribution */}
                        {fairnessData.afternoonData.length > 0 ? (
                          <div>
                            <Plot
                              data={[{
                                type: 'pie',
                                values: fairnessData.afternoonData.map(d => d.count),
                                labels: fairnessData.afternoonData.map(d => d.emp),
                                textinfo: 'percent+label',
                                textposition: 'inside',
                                marker: { colors: ['#FFE4E1', '#F0E68C', '#DDA0DD', '#B0E0E6', '#98FB98', '#F5DEB3'] },
                              }]}
                              layout={{
                                title: '🌅 Afternoon Shift Distribution',
                                height: 300,
                              }}
                              style={{ width: '100%' }}
                            />
                          </div>
                        ) : (
                          <div className="bg-gray-50 p-4 rounded-lg text-center">
                            <p className="text-gray-600">No afternoon shifts assigned</p>
                          </div>
                        )}

                        {/* Weekend Shift Distribution */}
                        {fairnessData.weekendData.length > 0 ? (
                          <div>
                            <Plot
                              data={[{
                                type: 'pie',
                                values: fairnessData.weekendData.map(d => d.count),
                                labels: fairnessData.weekendData.map(d => d.emp),
                                textinfo: 'percent+label',
                                textposition: 'inside',
                                marker: { colors: ['#C5E1A5', '#FFCCBC', '#B2DFDB', '#FFE082', '#CE93D8', '#90CAF9'] },
                              }]}
                              layout={{
                                title: '📅 Weekend Shift Distribution',
                                height: 300,
                              }}
                              style={{ width: '100%' }}
                            />
                          </div>
                        ) : (
                          <div className="bg-gray-50 p-4 rounded-lg text-center">
                            <p className="text-gray-600">No weekend shifts assigned</p>
                          </div>
                        )}

                        {/* Total Working Days */}
                        {fairnessData.workingData.length > 0 ? (
                          <div>
                            <Plot
                              data={[{
                                type: 'bar',
                                x: fairnessData.workingData.map(d => d.count),
                                y: fairnessData.workingData.map(d => d.emp),
                                orientation: 'h',
                                text: fairnessData.workingData.map(d => d.count),
                                textposition: 'auto',
                                marker: { color: 'lightcoral' },
                              }]}
                              layout={{
                                title: '📊 Total Working Days',
                                xaxis: { title: 'Working Days' },
                                yaxis: { title: 'Employee' },
                                height: Math.max(300, fairnessData.workingData.length * 20 + 100),
                              }}
                              style={{ width: '100%' }}
                            />
                          </div>
                        ) : (
                          <div className="bg-gray-50 p-4 rounded-lg text-center">
                            <p className="text-gray-600">No working shifts assigned</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Employee Pending Off Tab */}
                {activeTab === 'pending-off' && currentSchedule.employees && (
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 mb-4">Employee Pending Off</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-600">Total Employees</p>
                        <p className="text-2xl font-bold">{currentSchedule.employees.length}</p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-600">Avg Pending Off</p>
                        <p className="text-2xl font-bold">
                          {(
                            currentSchedule.employees.reduce((sum: number, emp: any) => sum + (emp.pending_off || 0), 0) /
                            currentSchedule.employees.length
                          ).toFixed(1)}
                        </p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-600">Max Pending Off</p>
                        <p className="text-2xl font-bold">
                          {Math.max(...currentSchedule.employees.map((emp: any) => emp.pending_off || 0)).toFixed(1)}
                        </p>
                      </div>
                    </div>

                    {currentSchedule.employees.length > 0 && (
                      <div>
                        <Plot
                          data={[{
                            type: 'bar',
                            x: currentSchedule.employees
                              .sort((a: any, b: any) => (a.pending_off || 0) - (b.pending_off || 0))
                              .map((emp: any) => emp.employee),
                            y: currentSchedule.employees
                              .sort((a: any, b: any) => (a.pending_off || 0) - (b.pending_off || 0))
                              .map((emp: any) => emp.pending_off || 0),
                            text: currentSchedule.employees
                              .sort((a: any, b: any) => (a.pending_off || 0) - (b.pending_off || 0))
                              .map((emp: any) => emp.pending_off || 0),
                            textposition: 'auto',
                            marker: { color: '#4ECDC4' },
                          }]}
                          layout={{
                            xaxis: { title: 'Employee' },
                            yaxis: { title: 'Pending Off Days' },
                            height: 300,
                          }}
                          style={{ width: '100%' }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Solver Metrics Tab */}
                {activeTab === 'solver' && currentSchedule.metrics && (
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 mb-4">Solver Metrics</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-600">Solve Time</p>
                        <p className="text-2xl font-bold">
                          {currentSchedule.metrics.solve_time
                            ? `${currentSchedule.metrics.solve_time.toFixed(2)}s`
                            : 'N/A'}
                        </p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-600">Status</p>
                        <p className="text-2xl font-bold">{currentSchedule.metrics.status || 'Unknown'}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : selectedYear && selectedMonth && !currentSchedule && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
              No report data available for {monthNames[selectedMonth - 1]} {selectedYear}
            </div>
          )}
        </>
      )}
    </div>
  );
};

