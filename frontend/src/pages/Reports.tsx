import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { schedulesAPI, Schedule } from '../services/api';
import Plot from 'react-plotly.js';
import { calculateFairnessData, FairnessData } from '../utils/fairnessMetrics';
import { useAuth } from '../contexts/AuthContext';
import { useAuthGuard } from '../hooks/useAuthGuard';
import { useDate } from '../contexts/DateContext';
import { DatePicker } from '../components/DatePicker';
import { isTokenExpired } from '../utils/tokenUtils';

export const ReportsPage: React.FC = () => {
  const { selectedYear, selectedMonth, setSelectedYear, setSelectedMonth } = useDate();
  // FIX: Use auth guard to prevent API calls until auth is confirmed
  const { isReady: authReady } = useAuthGuard(false); // Requires auth but not manager
  const { user, loading: authLoading } = useAuth(); // Keep for isManager check
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [schedulesLoaded, setSchedulesLoaded] = useState(false); // Track if schedules list is loaded
  const [currentSchedule, setCurrentSchedule] = useState<Schedule | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [loadingSchedule, setLoadingSchedule] = useState(false); // Separate loading state for individual schedule
  const isManager = user?.employee_type === 'Manager';

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const loadSchedules = useCallback(async (signal?: AbortSignal) => {
    // FIX: Double-check token is still valid right before making the call
    // This prevents race conditions where token expires between guard check and API call
    const token = localStorage.getItem('access_token');
    if (!token || isTokenExpired(token)) {
      // Token expired between guard check and API call - skip request
      console.warn('⚠️ Token expired between guard check and API call - skipping request');
      setSchedules([]);
      setSchedulesLoaded(true);
      setLoading(false);
      return;
    }

    // FIX: Check if request was cancelled before making API call
    if (signal?.aborted) {
      return;
    }

    try {
      setLoading(true);
      setSchedulesLoaded(false);
      // FIX: Pass abort signal to axios request (axios supports AbortSignal)
      const data = await schedulesAPI.getCommittedSchedules(signal);
      
      // FIX: Check if request was cancelled after API call
      if (signal?.aborted) {
        return;
      }
      
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
      setSchedulesLoaded(true); // Mark schedules as loaded
    } catch (error) {
      console.error('Failed to load schedules:', error);
      setSchedulesLoaded(true); // Still mark as loaded so UI can show error state
    } finally {
      setLoading(false);
    }
  }, []);

  // FIX: Load schedules list ONLY after auth guard confirms we're ready
  // This ensures user is authenticated AND token is valid before making API calls
  // FIX: Add request cancellation on unmount to prevent memory leaks
  useEffect(() => {
    const abortController = new AbortController();
    
    if (authReady) {
      loadSchedules(abortController.signal);
    } else {
      // Auth not ready - clear schedules and show loading
      setSchedules([]);
      setSchedulesLoaded(false);
      setLoading(true);
    }
    
    // FIX: Cancel request on unmount or when authReady changes
    return () => {
      abortController.abort();
    };
  }, [authReady, loadSchedules]);

  // Load specific schedule ONLY after schedules list is loaded
  useEffect(() => {
    if (!schedulesLoaded) return; // Wait for schedules list to be loaded first
    
    if (selectedYear && selectedMonth) {
      // Verify the schedule exists in the list before trying to load it
      const scheduleExists = schedules.some(
        (s) => s.year === selectedYear && s.month === selectedMonth
      );
      if (scheduleExists) {
        loadSchedule(selectedYear, selectedMonth);
      } else {
        // Selected schedule doesn't exist, clear selection
        setCurrentSchedule(null);
      }
    }
  }, [selectedYear, selectedMonth, schedulesLoaded, schedules]);

  const loadSchedule = async (year: number, month: number) => {
    try {
      setLoadingSchedule(true);
      const schedule = await schedulesAPI.getSchedule(year, month);
      setCurrentSchedule(schedule);
    } catch (error) {
      console.error('Failed to load schedule:', error);
      setCurrentSchedule(null);
    } finally {
      setLoadingSchedule(false);
    }
  };

  // Get available years and months
  const availableYears = Array.from(new Set(schedules.map(s => s.year))).sort();
  // Get all available year-month combinations for the combined picker
  const availableYearMonthCombos = schedules.map(s => ({
    year: s.year,
    month: s.month,
    value: `${s.year}-${s.month}`,
    label: `${monthNames[s.month - 1]} ${s.year}`
  })).sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });

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

  // FIX: Show loading while auth is being verified
  // This prevents components from making API calls before auth is ready
  if (authLoading || !authReady) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        <span className="ml-3 text-gray-600">Loading schedules...</span>
      </div>
    );
  }

  // Show loading spinner while initial schedules list is loading
  if (loading && !schedulesLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const tabs = [
    { id: 'overview', emoji: '', label: 'Overview' },
    { id: 'fairness', emoji: '', label: 'Fairness Analysis' },
    { id: 'pending-off', emoji: '', label: 'Employee Pending Off' },
    { id: 'solver', emoji: '', label: 'Solver Metrics' },
  ] as const;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Reports & Visualization</h2>

      {schedules.length === 0 ? (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-yellow-800">
          No committed schedules available
          {isManager ? '. Commit a schedule to view reports and visualizations.' : '.'}
        </div>
      ) : (
        <>
          {/* Year and Month Selection */}
          <DatePicker 
            combined={true}
            availableYearMonthCombos={availableYearMonthCombos}
          />

          {selectedYear && selectedMonth && loadingSchedule && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              <span className="ml-3 text-gray-600">Loading schedule...</span>
            </div>
          )}

          {selectedYear && selectedMonth && currentSchedule && !loadingSchedule && monthSchedule.length > 0 ? (
            <div className="overflow-hidden rounded-lg bg-white shadow">
              {/* Tabs */}
              <div className="border-b border-gray-200">
                <div className="p-4 md:hidden">
                  <label className="sr-only" htmlFor="reports-tab-select">
                    Select report section
                  </label>
                  <select
                    id="reports-tab-select"
                    value={activeTab}
                    onChange={(e) => setActiveTab(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-primary-500"
                  >
                    {tabs.map((tab) => (
                      <option key={tab.id} value={tab.id}>
                        {`${tab.emoji} ${tab.label}`}
                      </option>
                    ))}
                  </select>
                </div>
                <nav className="hidden -mb-px overflow-x-auto md:flex">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors ${
                        activeTab === tab.id
                          ? 'border-b-2 border-primary-500 text-primary-600'
                          : 'border-b-2 border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      }`}
                    >
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </nav>
              </div>

              <div className="space-y-6 p-4 sm:p-6">
                {/* Overview Tab */}
                {activeTab === 'overview' && metrics && (
                  <div className="space-y-4">
                  <div>
                      <h3 className="text-xl font-bold text-gray-900">Monthly Overview</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        Quick stats that highlight how this roster was distributed across the team.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                      <div className="rounded-lg bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Total Assignments</p>
                        <p className="text-2xl font-bold">{metrics.totalAssignments}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Employees</p>
                        <p className="text-2xl font-bold">{metrics.employees}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Days</p>
                        <p className="text-2xl font-bold">{metrics.days}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Main Shifts</p>
                        <p className="text-2xl font-bold">{metrics.mainShifts}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Fairness Analysis Tab */}
                {activeTab === 'fairness' && fairnessData && (
                  <div className="space-y-6">
                  <div>
                      <h3 className="text-xl font-bold text-gray-900">Fairness Analysis</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        Compare how shifts are shared across the team. Scroll horizontally on smaller screens
                        to see every chart.
                      </p>
                    </div>
                    
                    {/* Fairness Metrics */}
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                      <div className="rounded-lg bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Min Working Days</p>
                        <p className="text-2xl font-bold">{fairnessData.metrics.minWork}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Max Working Days</p>
                        <p className="text-2xl font-bold">{fairnessData.metrics.maxWork}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Avg Working Days</p>
                        <p className="text-2xl font-bold">{fairnessData.metrics.avgWork.toFixed(1)}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Fairness Score</p>
                        <p className="text-2xl font-bold">{fairnessData.metrics.fairnessScore.toFixed(2)}</p>
                      </div>
                    </div>

                    <div className="-mx-4 overflow-x-auto border-t border-gray-200 pt-6 md:mx-0 md:overflow-visible">
                      <div className="flex flex-col gap-4 md:grid md:grid-cols-2 lg:grid-cols-4">
                        {/* Night Shift Distribution */}
                        {fairnessData.nightData.length > 0 ? (
                          <div className="min-w-[260px] rounded-lg border border-gray-100 p-3 shadow-sm md:min-w-0 space-y-3">
                            <h4 className="text-sm font-semibold text-gray-800">🌙 Night Shift Distribution</h4>
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
                                height: 300,
                              }}
                              config={{ responsive: true }}
                              style={{ width: '100%', minWidth: '220px' }}
                            />
                          </div>
                        ) : (
                          <div className="min-w-[260px] rounded-lg bg-gray-50 p-4 text-center md:min-w-0">
                            <p className="text-gray-600">No night shifts assigned</p>
                          </div>
                        )}

                        {/* Afternoon Shift Distribution */}
                        {fairnessData.afternoonData.length > 0 ? (
                          <div className="min-w-[260px] rounded-lg border border-gray-100 p-3 shadow-sm md:min-w-0 space-y-3">
                            <h4 className="text-sm font-semibold text-gray-800">🌅 Afternoon Shift Distribution</h4>
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
                                height: 300,
                              }}
                              config={{ responsive: true }}
                              style={{ width: '100%', minWidth: '220px' }}
                            />
                          </div>
                        ) : (
                          <div className="min-w-[260px] rounded-lg bg-gray-50 p-4 text-center md:min-w-0">
                            <p className="text-gray-600">No afternoon shifts assigned</p>
                          </div>
                        )}

                        {/* Weekend Shift Distribution */}
                        {fairnessData.weekendData.length > 0 ? (
                          <div className="min-w-[260px] rounded-lg border border-gray-100 p-3 shadow-sm md:min-w-0 space-y-3">
                            <h4 className="text-sm font-semibold text-gray-800">Weekend Shift Distribution</h4>
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
                                height: 300,
                              }}
                              config={{ responsive: true }}
                              style={{ width: '100%', minWidth: '220px' }}
                            />
                          </div>
                        ) : (
                          <div className="min-w-[260px] rounded-lg bg-gray-50 p-4 text-center md:min-w-0">
                            <p className="text-gray-600">No weekend shifts assigned</p>
                          </div>
                        )}

                        {/* Total Working Days */}
                        {fairnessData.workingData.length > 0 ? (
                          <div className="min-w-[260px] rounded-lg border border-gray-100 p-3 shadow-sm md:min-w-0 space-y-3">
                            <h4 className="text-sm font-semibold text-gray-800">Total Working Days</h4>
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
                                xaxis: { title: 'Working Days' },
                                yaxis: { title: 'Employee' },
                                height: Math.max(300, fairnessData.workingData.length * 20 + 100),
                              }}
                              config={{ responsive: true }}
                              style={{ width: '100%', minWidth: '220px' }}
                            />
                          </div>
                        ) : (
                          <div className="min-w-[260px] rounded-lg bg-gray-50 p-4 text-center md:min-w-0">
                            <p className="text-gray-600">No working shifts assigned</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Employee Pending Off Tab */}
                {activeTab === 'pending-off' && currentSchedule.employees && (
                  <div className="space-y-6">
                  <div>
                      <h3 className="text-xl font-bold text-gray-900">Employee Pending Off</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        Track remaining days off so employees know what’s still available.
                      </p>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="rounded-lg bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Total Employees</p>
                        <p className="text-2xl font-bold">{currentSchedule.employees.length}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Avg Pending Off</p>
                        <p className="text-2xl font-bold">
                          {(
                            currentSchedule.employees.reduce((sum: number, emp: any) => sum + (emp.pending_off || 0), 0) /
                            currentSchedule.employees.length
                          ).toFixed(1)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Max Pending Off</p>
                        <p className="text-2xl font-bold">
                          {Math.max(...currentSchedule.employees.map((emp: any) => emp.pending_off || 0)).toFixed(1)}
                        </p>
                      </div>
                    </div>

                    {currentSchedule.employees.length > 0 && (
                      <div className="-mx-4 overflow-x-auto md:mx-0 md:overflow-visible">
                        {(() => {
                          const sortedEmployees = currentSchedule.employees
                            .slice()
                            .sort((a: any, b: any) => (a.pending_off || 0) - (b.pending_off || 0));
                          const pendingValues = sortedEmployees.map((emp: any) => emp.pending_off || 0);
                          return (
                            <Plot
                              data={[{
                                type: 'bar',
                                x: sortedEmployees.map((emp: any) => emp.employee),
                                y: pendingValues,
                                text: pendingValues.map((value: number) => value.toFixed(1)),
                                textposition: 'auto',
                                marker: { color: '#5DADE2' },
                                orientation: 'v',
                              }]}
                              layout={{
                                xaxis: { title: 'Employee' },
                                yaxis: { title: 'Pending Off Days' },
                                height: 300,
                                margin: { l: 60, r: 20, t: 20, b: 80 },
                              }}
                              config={{ responsive: true }}
                              style={{ width: '100%', minWidth: '280px' }}
                            />
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}

                {/* Solver Metrics Tab */}
                {activeTab === 'solver' && currentSchedule.metrics && (
                  <div className="space-y-4">
                    <h3 className="text-xl font-bold text-gray-900">Solver Metrics</h3>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="rounded-lg bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Solve Time</p>
                        <p className="text-2xl font-bold">
                          {currentSchedule.metrics.solve_time
                            ? `${currentSchedule.metrics.solve_time.toFixed(2)}s`
                            : 'N/A'}
                        </p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Status</p>
                        <p className="text-2xl font-bold">{currentSchedule.metrics.status || 'Unknown'}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : selectedYear && selectedMonth && !currentSchedule && !loading && !loadingSchedule && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
              No report data available for {monthNames[selectedMonth - 1]} {selectedYear}
            </div>
          )}
        </>
      )}
    </div>
  );
};

