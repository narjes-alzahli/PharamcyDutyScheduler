import React, { useState, useEffect, useRef } from 'react';
import { dataAPI, solverAPI, schedulesAPI, SolveRequest, JobStatus } from '../services/api';
import { ScheduleTable } from '../components/ScheduleTable';
import { EditableTable } from '../components/EditableTable';
import { DemandsTab } from '../components/DemandsTab';
import { ScheduleAnalysis } from '../components/ScheduleAnalysis';

const SHIFT_OPTIONS = ['M', 'IP', 'A', 'N', 'M3', 'M4', 'H', 'CL', 'MS', 'C'] as const;

export const RosterGenerator: React.FC = () => {
  const [activeTab, setActiveTab] = useState('employees');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [rosterData, setRosterData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [solving, setSolving] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [generatedSchedule, setGeneratedSchedule] = useState<any[] | null>(null);
  const [generatedEmployees, setGeneratedEmployees] = useState<any[] | null>(null);
  const [scheduleMetrics, setScheduleMetrics] = useState<any>(null);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [showAddTimeOff, setShowAddTimeOff] = useState(false);
  const [showAddLock, setShowAddLock] = useState(false);
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  useEffect(() => {
    loadRosterData();
  }, []);

  // Reload roster data when switching to time-off or shift request steps to show newly approved requests
  useEffect(() => {
    if (activeTab === 'time-off' || activeTab === 'locks') {
      loadRosterData();
    }
  }, [activeTab]);

  // Reset active step when year/month are not selected
  useEffect(() => {
    if (!selectedYear || !selectedMonth) {
      setActiveTab('employees');
    }
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    clearGeneratedResults();
    setSolving(false);
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    if (jobId && solving) {
      const interval = setInterval(() => {
        checkJobStatus(jobId);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [jobId, solving]);

  const loadRosterData = async () => {
    try {
      setLoading(true);
      const data = await dataAPI.getRosterData();
      setRosterData(data);
    } catch (error) {
      console.error('Failed to load roster data:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkJobStatus = async (id: string) => {
    try {
      const status = await solverAPI.getJobStatus(id);
      setJobStatus(status);

      if (status.status === 'completed' && status.result) {
        setSolving(false);
        setGeneratedSchedule(status.result.schedule);
        setGeneratedEmployees(status.result.employees || null);
        setScheduleMetrics(status.result.metrics || { solve_time: 0, status: 'completed' });
        setActiveTab('schedule');
      } else if (status.status === 'failed') {
        setSolving(false);
        alert(`Solver failed: ${status.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to check job status:', error);
    }
  };

  const clearGeneratedResults = () => {
    setGeneratedSchedule(null);
    setGeneratedEmployees(null);
    setScheduleMetrics(null);
    setJobId(null);
    setJobStatus(null);
  };

  const handleGenerate = async () => {
    if (!selectedYear || !selectedMonth) {
      alert('Please select both year and month');
      return;
    }

    try {
      setSolving(true);
      const request: SolveRequest = {
        year: selectedYear,
        month: selectedMonth,
        time_limit: 120,
        unfilled_penalty: 1000.0,
        fairness_weight: 5.0,
        switching_penalty: 1.0,
      };

      const response = await solverAPI.solve(request);
      setJobId(response.job_id);
      setJobStatus({ job_id: response.job_id, status: 'pending' });
    } catch (error: any) {
      setSolving(false);
      alert(error.response?.data?.detail || 'Failed to start solver');
    }
  };

  const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const initialEmployeesRef = React.useRef<any[] | null>(null);
  const timeOffSaveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const locksSaveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const [saveNotification, setSaveNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Store initial employees data when it's loaded
  useEffect(() => {
    if (rosterData?.employees && !initialEmployeesRef.current) {
      initialEmployeesRef.current = JSON.parse(JSON.stringify(rosterData.employees));
    }
  }, [rosterData?.employees]);

  const handleEmployeesChange = async (newData: any[]) => {
    // Check for duplicate employee names
    const employeeNames = newData.map(emp => emp.employee?.trim()).filter(name => name);
    const duplicates = employeeNames.filter((name, index) => employeeNames.indexOf(name) !== index);
    
    if (duplicates.length > 0) {
      const uniqueDuplicates = Array.from(new Set(duplicates));
      setSaveNotification({ 
        message: `❌ Duplicate employee names found: ${uniqueDuplicates.join(', ')}. Each employee must have a unique name.`,
        type: 'error'
      });
      setTimeout(() => setSaveNotification(null), 5000);
      return;
    }

    // Check for empty employee names
    const emptyNames = newData.filter(emp => !emp.employee || !emp.employee.trim());
    if (emptyNames.length > 0) {
      setSaveNotification({ 
        message: '❌ Employee names cannot be empty. Please enter a name for all employees.',
        type: 'error'
      });
      setTimeout(() => setSaveNotification(null), 5000);
      return;
    }

    // Check if data actually changed from initial load
    const initialData = initialEmployeesRef.current || [];
    const hasChanged = JSON.stringify(initialData) !== JSON.stringify(newData);
    
    if (!hasChanged) {
      // Data hasn't changed, don't save or show notification
      return;
    }

    clearGeneratedResults();

    // Clear any existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Delay the save - only save after user stops typing for 2 seconds
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        // Save employees permanently to backend
        await dataAPI.updateEmployees(newData);
        setRosterData({ ...rosterData, employees: newData });
        // Update initial reference to current data
        initialEmployeesRef.current = JSON.parse(JSON.stringify(newData));
        // Show success notification (auto-dismisses)
        setSaveNotification({ message: '✅ Employees saved successfully!', type: 'success' });
        setTimeout(() => setSaveNotification(null), 2000);
      } catch (error: any) {
        console.error('Failed to save employees:', error);
        setSaveNotification({ 
          message: `❌ ${error.response?.data?.detail || 'Failed to save employees'}`,
          type: 'error'
        });
        setTimeout(() => setSaveNotification(null), 4000);
      }
    }, 2000); // 2 second delay after user stops typing
  };

  const handleDemandsChange = async (newData: any[]) => {
    // TODO: Implement API call to save demands
    clearGeneratedResults();
    setRosterData({ ...rosterData, demands: newData });
  };

  const handleCommitSchedule = async () => {
    if (!generatedSchedule || !selectedYear || !selectedMonth) {
      alert('No schedule to commit');
      return;
    }

    try {
      await schedulesAPI.commitSchedule(
        selectedYear,
        selectedMonth,
        generatedSchedule,
        generatedEmployees || undefined,
        scheduleMetrics || undefined
      );
      alert('✅ Schedule committed successfully! It will now appear in Monthly Roster and Reports pages.');
    } catch (error: any) {
      alert(error.response?.data?.detail || 'Failed to commit schedule');
    }
  };

  const handleTimeOffChange = (newData: any[]) => {
    clearGeneratedResults();
    setRosterData((prev: any) => (prev ? { ...prev, time_off: newData } : prev));

    if (timeOffSaveTimeoutRef.current) {
      clearTimeout(timeOffSaveTimeoutRef.current);
    }

    timeOffSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await dataAPI.updateTimeOff(newData);
        setSaveNotification({ message: '✅ Leave data saved successfully!', type: 'success' });
        setTimeout(() => setSaveNotification(null), 2000);
      } catch (error: any) {
        console.error('Failed to save time off:', error);
        setSaveNotification({
          message: `❌ ${error.response?.data?.detail || 'Failed to save leave data'}`,
          type: 'error',
        });
        setTimeout(() => setSaveNotification(null), 4000);
      }
    }, 800);
  };

  const handleLocksChange = (newData: any[]) => {
    const normalizedLocks = newData.map((lock: any) => ({
      ...lock,
      force: !!lock.force,
    }));

    clearGeneratedResults();
    setRosterData((prev: any) => (prev ? { ...prev, locks: normalizedLocks } : prev));

    if (locksSaveTimeoutRef.current) {
      clearTimeout(locksSaveTimeoutRef.current);
    }

    locksSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await dataAPI.updateLocks(normalizedLocks);
        setSaveNotification({ message: '✅ Shift requests saved successfully!', type: 'success' });
        setTimeout(() => setSaveNotification(null), 2000);
      } catch (error: any) {
        console.error('Failed to save shift requests:', error);
        setSaveNotification({
          message: `❌ ${error.response?.data?.detail || 'Failed to save shift requests'}`,
          type: 'error',
        });
        setTimeout(() => setSaveNotification(null), 4000);
      }
    }, 800);
  };

  const addEmployee = () => {
    setNewEmployeeName('');
    setShowAddEmployee(true);
  };

  const handleAddEmployeeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newEmployeeName || !newEmployeeName.trim()) {
      alert('Please enter an employee name');
      return;
    }

    const trimmedName = newEmployeeName.trim();
    
    // Check for duplicate names
    const existingNames = rosterData?.employees?.map((emp: any) => emp.employee?.trim()) || [];
    if (existingNames.includes(trimmedName)) {
      alert(`Employee "${trimmedName}" already exists. Please use a different name.`);
      return;
    }

    const newEmployee = {
      employee: trimmedName,
      skill_M: true,
      skill_IP: true,
      skill_A: true,
      skill_N: true,
      skill_M3: true,
      skill_M4: true,
      skill_H: true,
      skill_CL: true,
      clinic_only: false,
      maxN: 3,
      maxA: 3,
      min_days_off: 4,
      weight: 1.0,
      pending_off: 0,
    };
    
    const newData = [...(rosterData?.employees || []), newEmployee];
    setRosterData({ ...rosterData, employees: newData });
    setShowAddEmployee(false);
    setNewEmployeeName('');
    
    // Save immediately after adding
    await handleEmployeesChange(newData);
  };

  const addTimeOff = (employee: string, fromDate: string, toDate: string, code: string) => {
    const newTimeOff = {
      employee,
      from_date: fromDate,
      to_date: toDate,
      code,
    };
    const newData = [...(rosterData?.time_off || []), newTimeOff];
    handleTimeOffChange(newData);
    setShowAddTimeOff(false);
  };

  const addLock = (employee: string, fromDate: string, toDate: string, shift: string, force: boolean) => {
    const newLock = {
      employee,
      from_date: fromDate,
      to_date: toDate,
      shift,
      force,
    };
    const newData = [...(rosterData?.locks || []), newLock];
    handleLocksChange(newData);
    setShowAddLock(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const steps = [
    {
      id: 'employees',
      name: 'Employees',
      description: 'Add, edit, or remove staff members and their skills.',
    },
    {
      id: 'demands',
      name: 'Staffing Needs',
      description: 'Configure daily demand for each shift type.',
    },
    {
      id: 'time-off',
      name: 'Leave Requests',
      description: 'Review and adjust time-off entries before scheduling.',
    },
    {
      id: 'locks',
      name: 'Shift Requests',
      description: 'Set must-have or blocked shift assignments.',
    },
    {
      id: 'schedule',
      name: 'Generate Schedule',
      description: 'Run the solver and review results before committing.',
    },
  ];

  // Filter data for selected month
  const getMonthData = (data: any[], dateField: string) => {
    if (!selectedYear || !selectedMonth || !data) return [];
    return data.filter((item: any) => {
      const date = new Date(item[dateField]);
      return date.getFullYear() === selectedYear && date.getMonth() + 1 === selectedMonth;
    });
  };

  const selectionControls = (
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
            {[2025, 2026, 2027].map(year => (
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
            {monthNames.map((month, index) => (
              <option key={index + 1} value={index + 1}>{month}</option>
            ))}
          </select>
        </div>
      </div>
      {(!selectedYear || !selectedMonth) && (
        <div className="mt-4 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded">
          Please select both a year and month to generate the roster.
        </div>
      )}
    </div>
  );

  if (!selectedYear || !selectedMonth) {
    return (
      <div>
        <h2 className="text-3xl font-bold text-gray-900 mb-6">Roster Generator</h2>
        {selectionControls}
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-3xl font-bold text-gray-900 mb-6">Roster Generator</h2>
      {selectionControls}

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex flex-col md:flex-row">
          <aside className="md:w-56 md:pr-4 md:border-r md:border-gray-200 mb-6 md:mb-0">
            <div className="space-y-3">
              {steps.map((step, index) => {
                const isActive = activeTab === step.id;
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => setActiveTab(step.id)}
                    className={`w-full flex items-start space-x-2 rounded-lg border px-3 py-3 text-left transition ${
                      isActive
                        ? 'border-primary-500 bg-primary-50 text-primary-700 shadow-sm'
                        : 'border-gray-200 hover:border-primary-300 hover:shadow-sm'
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center w-8 h-8 mt-0.5 rounded-full border ${
                        isActive
                          ? 'bg-primary-500 border-primary-500 text-white'
                          : 'border-gray-300 text-gray-500'
                      }`}
                    >
                      {index + 1}
                    </span>
                    <div>
                      <p className={`font-semibold ${isActive ? 'text-primary-700' : 'text-gray-800'}`}>
                        {step.name}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="flex-1 md:pl-8 space-y-8" ref={contentRef}>
          {/* Employees Tab */}
          {activeTab === 'employees' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">👥 Employee Management</h3>
                  <p className="text-gray-600">Add, edit, or remove staff members and their skills</p>
                </div>
                <button
                  onClick={addEmployee}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  ➕ Add Employee
                </button>
              </div>
              
              {/* Add Employee Modal */}
              {showAddEmployee && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                  <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                    <h3 className="text-xl font-bold text-gray-900 mb-4">Add New Employee</h3>
                    <form onSubmit={handleAddEmployeeSubmit}>
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Employee Name
                        </label>
                        <input
                          type="text"
                          value={newEmployeeName}
                          onChange={(e) => setNewEmployeeName(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          placeholder="Enter employee name"
                          autoFocus
                          required
                        />
                        {newEmployeeName && (
                          <p className="mt-2 text-xs text-gray-500">
                            Username will be: <strong>{newEmployeeName.trim().toLowerCase().replace(/\s+/g, '_')}</strong>
                          </p>
                        )}
                      </div>
                      <div className="flex justify-end space-x-3">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddEmployee(false);
                            setNewEmployeeName('');
                          }}
                          className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                        >
                          Add Employee
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
              
              {/* Auto-dismissing notification toast */}
              {saveNotification && (
                <div 
                  className={`fixed top-20 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
                    saveNotification.type === 'success' 
                      ? 'bg-green-500 text-white' 
                      : 'bg-red-500 text-white'
                  }`}
                  style={{ animation: 'slideIn 0.3s ease-out' }}
                >
                  {saveNotification.message}
                </div>
              )}
              {rosterData?.employees && rosterData.employees.length > 0 ? (
                <>
                  <EditableTable
                    data={rosterData.employees}
                    columns={[
                      { key: 'employee', label: 'Employee', type: 'text' },
                      { key: 'skill_M', label: 'Main', type: 'checkbox' },
                      { key: 'skill_IP', label: 'Inpatient', type: 'checkbox' },
                      { key: 'skill_A', label: 'Afternoon', type: 'checkbox' },
                      { key: 'skill_N', label: 'Night', type: 'checkbox' },
                      { key: 'skill_M3', label: 'M3', type: 'checkbox' },
                      { key: 'skill_M4', label: 'M4', type: 'checkbox' },
                      { key: 'skill_H', label: 'Harat', type: 'checkbox' },
                      { key: 'skill_CL', label: 'Clinic', type: 'checkbox' },
                      { key: 'pending_off', label: 'Pending Off', type: 'number', min: 0, max: 50 },
                    ]}
                    onDataChange={handleEmployeesChange}
                    onDeleteRow={async (index) => {
                      const employeeToDelete = rosterData.employees[index];
                      const newData = rosterData.employees.filter((_: any, i: number) => i !== index);
                      try {
                        // Delete from backend
                        await dataAPI.deleteEmployee(employeeToDelete.employee);
                        // Update local state
                        await handleEmployeesChange(newData);
                      } catch (error: any) {
                        alert(error.response?.data?.detail || 'Failed to delete employee');
                      }
                    }}
                  />
                  <div className="grid grid-cols-4 gap-4 mt-6">
                    <div className="bg-gray-50 p-4 rounded">
                      <p className="text-sm text-gray-600">Total Employees</p>
                      <p className="text-2xl font-bold">{rosterData.employees.length}</p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded">
                      <p className="text-sm text-gray-600">Can Work Nights</p>
                      <p className="text-2xl font-bold">
                        {rosterData.employees.filter((e: any) => e.skill_N).length}
                      </p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded">
                      <p className="text-sm text-gray-600">Can Work Afternoons</p>
                      <p className="text-2xl font-bold">
                        {rosterData.employees.filter((e: any) => e.skill_A).length}
                      </p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded">
                      <p className="text-sm text-gray-600">Can Work All Shifts</p>
                      <p className="text-2xl font-bold">
                        {rosterData.employees.filter((e: any) =>
                          e.skill_M && e.skill_IP && e.skill_A && e.skill_N && e.skill_M3 && e.skill_M4 && e.skill_H && e.skill_CL
                        ).length}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-gray-600">No employees data available.</p>
              )}
            </div>
          )}

          {/* Demands Tab */}
          {activeTab === 'demands' && (
            <DemandsTab
              selectedYear={selectedYear}
              selectedMonth={selectedMonth}
              monthNames={monthNames}
            />
          )}

          {/* Time Off Tab */}
          {activeTab === 'time-off' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">🏖️ Leave Requests</h3>
                  <p className="text-gray-600">Submit and approve vacation, sick leave, and other time off requests</p>
                </div>
                <button
                  onClick={() => setShowAddTimeOff(true)}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  ➕ Add Leave
                </button>
              </div>
              {showAddTimeOff && (
                <AddTimeOffForm
                  employees={rosterData?.employees?.map((e: any) => e.employee) || []}
                  year={selectedYear || 2025}
                  month={selectedMonth || 1}
                  onSubmit={addTimeOff}
                  onCancel={() => setShowAddTimeOff(false)}
                />
              )}
              <EditableTable
                data={getMonthData(rosterData?.time_off || [], 'from_date')}
                columns={[
                  { key: 'employee', label: 'Employee', type: 'select', options: rosterData?.employees?.map((e: any) => e.employee) || [] },
                  { key: 'from_date', label: 'From Date', type: 'text' },
                  { key: 'to_date', label: 'To Date', type: 'text' },
                  { key: 'code', label: 'Code', type: 'select', options: ['DO', 'ML', 'AL', 'W', 'UL', 'APP', 'STL', 'L', 'O'] },
                ]}
                onDataChange={handleTimeOffChange}
                onDeleteRow={(index) => {
                  const monthData = getMonthData(rosterData?.time_off || [], 'from_date');
                  const newData = (rosterData?.time_off || []).filter((item: any) => {
                    const date = new Date(item.from_date);
                    return !(date.getFullYear() === selectedYear && date.getMonth() + 1 === selectedMonth && monthData.indexOf(item) === index);
                  });
                  handleTimeOffChange(newData);
                }}
              />
            </div>
          )}

          {/* Locks Tab */}
          {activeTab === 'locks' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">🔒 Shift Requests</h3>
                  <p className="text-gray-600">Force specific shifts or block certain assignments for staff</p>
                </div>
                <button
                  onClick={() => setShowAddLock(true)}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  ➕ Add Lock
                </button>
              </div>
              {showAddLock && (
                <AddLockForm
                  employees={rosterData?.employees?.map((e: any) => e.employee) || []}
                  year={selectedYear || 2025}
                  month={selectedMonth || 1}
                  onSubmit={addLock}
                  onCancel={() => setShowAddLock(false)}
                />
              )}
              <EditableTable
                data={getMonthData(rosterData?.locks || [], 'from_date').map((lock: any) => ({
                  ...lock,
                  force: lock.force ? 'Force (Must)' : 'Forbid (Cannot)',
                }))}
                columns={[
                  { key: 'employee', label: 'Employee', type: 'select', options: rosterData?.employees?.map((e: any) => e.employee) || [] },
                  { key: 'from_date', label: 'From Date', type: 'text' },
                  { key: 'to_date', label: 'To Date', type: 'text' },
                  { key: 'shift', label: 'Shift', type: 'select', options: Array.from(SHIFT_OPTIONS) },
                  { key: 'force', label: 'Action', type: 'select', options: ['Force (Must)', 'Forbid (Cannot)'] },
                ]}
                onDataChange={(newData) => {
                  const converted = newData.map((item: any) => ({
                    ...item,
                    force: item.force === 'Force (Must)',
                  }));
                  handleLocksChange(converted);
                }}
                onDeleteRow={(index) => {
                  const monthData = getMonthData(rosterData?.locks || [], 'from_date');
                  const newData = (rosterData?.locks || []).filter((item: any) => {
                    const date = new Date(item.from_date);
                    return !(date.getFullYear() === selectedYear && date.getMonth() + 1 === selectedMonth && monthData.indexOf(item) === index);
                  });
                  handleLocksChange(newData);
                }}
              />
            </div>
          )}

          {/* Schedule Generation & Review */}
          {activeTab === 'schedule' && (
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">⚙️ Generate Schedule</h3>
              <p className="text-gray-600 mb-4">
                Run the solver to build the monthly roster, review the assignments, and commit when you’re satisfied.
              </p>

              {!selectedYear || !selectedMonth ? (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
                  Please select a year and month first.
                </div>
              ) : (
                <div className="space-y-6">
                  {solving ? (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                      <div className="flex items-center space-x-4">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                        <div>
                          <p className="font-semibold text-gray-900">Generating schedule...</p>
                          <p className="text-sm text-gray-600">Status: {jobStatus?.status || 'pending'}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={handleGenerate}
                      className="w-full px-6 py-3 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700"
                    >
                      Generate Schedule
                    </button>
                  )}

                  {jobStatus?.status === 'failed' && (
                    <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
                      <p className="font-semibold">Generation failed:</p>
                      <p>{jobStatus.error || 'Unknown error'}</p>
                    </div>
                  )}

                  {generatedSchedule && selectedYear && selectedMonth ? (
                    <>
                      <ScheduleTable
                        schedule={generatedSchedule}
                        year={selectedYear}
                        month={selectedMonth}
                        employees={generatedEmployees || rosterData?.employees}
                      />

                      <ScheduleAnalysis
                        schedule={generatedSchedule}
                        employees={generatedEmployees || rosterData?.employees}
                        metrics={scheduleMetrics}
                        year={selectedYear}
                        month={selectedMonth}
                      />

                      <div className="mt-8 border-t border-gray-200 pt-6">
                        <h3 className="text-xl font-bold text-gray-900 mb-4">Ready to Use This Schedule?</h3>
                        <div className="flex items-center space-x-4">
                          <button
                            onClick={handleCommitSchedule}
                            className="px-6 py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700"
                          >
                            Commit Schedule
                          </button>
                          <p className="text-sm text-gray-600">
                            After committing, this schedule will be available in Monthly Roster and Reports pages for your staff.
                          </p>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
  );
};

// Helper components
const AddTimeOffForm: React.FC<{
  employees: string[];
  year: number;
  month: number;
  onSubmit: (employee: string, fromDate: string, toDate: string, code: string) => void;
  onCancel: () => void;
}> = ({ employees, year, month, onSubmit, onCancel }) => {
  const [employee, setEmployee] = useState(employees[0] || '');
  const [fromDate, setFromDate] = useState(`${year}-${month.toString().padStart(2, '0')}-01`);
  const [toDate, setToDate] = useState(`${year}-${month.toString().padStart(2, '0')}-01`);
  const [code, setCode] = useState('DO');

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
      <h4 className="font-semibold mb-4">Add Leave Request</h4>
      <div className="grid grid-cols-4 gap-4">
        <select value={employee} onChange={(e) => setEmployee(e.target.value)} className="px-3 py-2 border rounded">
          {employees.map(emp => <option key={emp} value={emp}>{emp}</option>)}
        </select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-3 py-2 border rounded" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-3 py-2 border rounded" />
        <select value={code} onChange={(e) => setCode(e.target.value)} className="px-3 py-2 border rounded">
          {['DO', 'ML', 'AL', 'W', 'UL', 'APP', 'STL', 'L', 'O'].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="mt-4 flex space-x-2">
        <button onClick={() => onSubmit(employee, fromDate, toDate, code)} className="px-4 py-2 bg-primary-600 text-white rounded">Add</button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-200 rounded">Cancel</button>
      </div>
    </div>
  );
};

const AddLockForm: React.FC<{
  employees: string[];
  year: number;
  month: number;
  onSubmit: (employee: string, fromDate: string, toDate: string, shift: string, force: boolean) => void;
  onCancel: () => void;
}> = ({ employees, year, month, onSubmit, onCancel }) => {
  const [employee, setEmployee] = useState(employees[0] || '');
  const [fromDate, setFromDate] = useState(`${year}-${month.toString().padStart(2, '0')}-01`);
  const [toDate, setToDate] = useState(`${year}-${month.toString().padStart(2, '0')}-01`);
  const [shift, setShift] = useState<typeof SHIFT_OPTIONS[number]>(SHIFT_OPTIONS[0]);
  const [force, setForce] = useState(true);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
      <h4 className="font-semibold mb-4">Add Shift Request</h4>
      <div className="grid grid-cols-5 gap-4">
        <select value={employee} onChange={(e) => setEmployee(e.target.value)} className="px-3 py-2 border rounded">
          {employees.map(emp => <option key={emp} value={emp}>{emp}</option>)}
        </select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-3 py-2 border rounded" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-3 py-2 border rounded" />
        <select value={shift} onChange={(e) => setShift(e.target.value as typeof SHIFT_OPTIONS[number])} className="px-3 py-2 border rounded">
          {SHIFT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={force ? 'Force' : 'Forbid'} onChange={(e) => setForce(e.target.value === 'Force')} className="px-3 py-2 border rounded">
          <option value="Force">Force (Must)</option>
          <option value="Forbid">Forbid (Cannot)</option>
        </select>
      </div>
      <div className="mt-4 flex space-x-2">
        <button onClick={() => onSubmit(employee, fromDate, toDate, shift, force)} className="px-4 py-2 bg-primary-600 text-white rounded">Add</button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-200 rounded">Cancel</button>
      </div>
    </div>
  );
};
