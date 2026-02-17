import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { leaveTypesAPI, shiftTypesAPI, LeaveType, LeaveTypeCreate, ShiftType, ShiftTypeCreate } from '../services/api';
import { LoadingSkeleton } from '../components/LoadingSkeleton';

export const RulesManagement: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'leave-types' | 'shift-types' | 'scheduling-rules'>('leave-types');
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [loadingLeaveTypes, setLoadingLeaveTypes] = useState(true);
  const [loadingShiftTypes, setLoadingShiftTypes] = useState(true);
  const [showAddLeaveType, setShowAddLeaveType] = useState(false);
  const [showAddShiftType, setShowAddShiftType] = useState(false);
  const [editingLeaveType, setEditingLeaveType] = useState<LeaveType | null>(null);
  const [editingShiftType, setEditingShiftType] = useState<ShiftType | null>(null);
  const [deletingLeaveType, setDeletingLeaveType] = useState<LeaveType | null>(null);
  const [deletingShiftType, setDeletingShiftType] = useState<ShiftType | null>(null);
  const [newLeaveType, setNewLeaveType] = useState<LeaveTypeCreate>({
    code: '',
    description: '',
    color_hex: '#F5F5F5',
    counts_as_rest: true,
    is_active: true,
  });
  const [newShiftType, setNewShiftType] = useState<ShiftTypeCreate>({
    code: '',
    description: '',
    color_hex: '#E5E7EB',
    is_working_shift: true,
    is_active: true,
  });
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (currentUser?.employee_type === 'Manager') {
      if (activeTab === 'leave-types') {
        loadLeaveTypes();
      } else if (activeTab === 'shift-types') {
        loadShiftTypes();
      } else {
        // Reset loading states when switching to scheduling-rules tab
        setLoadingLeaveTypes(false);
        setLoadingShiftTypes(false);
      }
    }
  }, [activeTab, currentUser]);

  const loadLeaveTypes = async () => {
    try {
      setLoadingLeaveTypes(true);
      const types = await leaveTypesAPI.getLeaveTypes();
      setLeaveTypes(types);
    } catch (error) {
      console.error('Failed to load leave types:', error);
      setNotification({ message: 'Failed to load leave types', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
    } finally {
      setLoadingLeaveTypes(false);
    }
  };

  const handleCreateLeaveType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeaveType.code || !newLeaveType.description) {
      setNotification({ message: 'Code and description are required', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    try {
      await leaveTypesAPI.createLeaveType(newLeaveType);
      setNotification({ message: '✅ Leave type created successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      setShowAddLeaveType(false);
      setNewLeaveType({
        code: '',
        description: '',
        color_hex: '#F5F5F5',
        counts_as_rest: true,
        is_active: true,
      });
      await loadLeaveTypes();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to create leave type', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    }
  };

  const handleUpdateLeaveType = async (code: string, update: Partial<LeaveType>) => {
    try {
      await leaveTypesAPI.updateLeaveType(code, update);
      setNotification({ message: '✅ Leave type updated successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      setEditingLeaveType(null);
      await loadLeaveTypes();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to update leave type', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    }
  };

  const handleDeleteLeaveType = async () => {
    if (!deletingLeaveType) return;

    try {
      await leaveTypesAPI.deleteLeaveType(deletingLeaveType.code);
      setNotification({ message: '✅ Leave type deleted successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      setDeletingLeaveType(null);
      await loadLeaveTypes();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to delete leave type', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    }
  };

  const loadShiftTypes = async () => {
    try {
      setLoadingShiftTypes(true);
      const types = await shiftTypesAPI.getShiftTypes();
      // Filter out non-working shifts (DO, O) - only show working shifts in the UI
      // Backend still has them, but they shouldn't be displayed here
      const workingShifts = types.filter(type => type.is_working_shift === true);
      setShiftTypes(workingShifts);
    } catch (error) {
      console.error('Failed to load shift types:', error);
      setNotification({ message: 'Failed to load shift types', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
    } finally {
      setLoadingShiftTypes(false);
    }
  };

  const handleCreateShiftType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShiftType.code || !newShiftType.description) {
      setNotification({ message: 'Code and description are required', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    try {
      await shiftTypesAPI.createShiftType(newShiftType);
      setNotification({ message: '✅ Shift type created successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      setShowAddShiftType(false);
      setNewShiftType({
        code: '',
        description: '',
        color_hex: '#E5E7EB',
        is_working_shift: true,
        is_active: true,
      });
      await loadShiftTypes();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to create shift type', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    }
  };

  const handleUpdateShiftType = async (code: string, update: Partial<ShiftType>) => {
    try {
      await shiftTypesAPI.updateShiftType(code, update);
      setNotification({ message: '✅ Shift type updated successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      setEditingShiftType(null);
      await loadShiftTypes();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to update shift type', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    }
  };

  const handleDeleteShiftType = async () => {
    if (!deletingShiftType) return;

    try {
      await shiftTypesAPI.deleteShiftType(deletingShiftType.code);
      setNotification({ message: '✅ Shift type deleted successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      setDeletingShiftType(null);
      await loadShiftTypes();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to delete shift type', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    }
  };

  if (currentUser?.employee_type !== 'Manager') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600">Only managers can access Rules Management.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Rules Management</h2>

      {notification && (
        <div className={`mb-4 p-4 rounded-lg ${
          notification.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {notification.message}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('leave-types')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'leave-types'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Leave Types
          </button>
          <button
            onClick={() => setActiveTab('shift-types')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'shift-types'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Shift Types
          </button>
          <button
            onClick={() => setActiveTab('scheduling-rules')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'scheduling-rules'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Scheduling Rules
          </button>
        </nav>
      </div>

      {/* Leave Types Tab */}
      {activeTab === 'leave-types' && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-900">Leave Types Management</h3>
            <button
              onClick={() => {
                setShowAddLeaveType(true);
                setEditingLeaveType(null);
                setNewLeaveType({
                  code: '',
                  description: '',
                  color_hex: '#F5F5F5',
                  counts_as_rest: true,
                  is_active: true,
                });
              }}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              ➕ Add Leave Type
            </button>
          </div>

          {/* Leave Types Table */}
          {leaveTypes.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Code</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Description</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Color</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {leaveTypes.map((type) => (
                    <tr key={type.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 border border-gray-300">
                        <span className="font-mono">{type.code}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{type.description || '-'}</td>
                      <td className="px-4 py-3 text-sm border border-gray-300">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-6 h-6 rounded border border-gray-300"
                            style={{ backgroundColor: type.color_hex }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm border border-gray-300">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          type.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {type.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm border border-gray-300">
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setEditingLeaveType(type);
                              setShowAddLeaveType(false);
                              setNewLeaveType({
                                code: type.code,
                                description: type.description || '',
                                color_hex: type.color_hex,
                                counts_as_rest: type.counts_as_rest,
                                is_active: type.is_active,
                              });
                            }}
                            className="text-blue-600 hover:text-blue-800"
                            title="Edit leave type"
                            aria-label="Edit leave type"
                          >
                            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                              <path d="M11 3H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 0 3L12 12l-4 1 1-4 6.5-6.5a2.121 2.121 0 0 1 3 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              setDeletingLeaveType(type);
                              setShowAddLeaveType(false);
                              setEditingLeaveType(null);
                            }}
                            className="text-red-600 hover:text-red-800"
                            title="Delete leave type"
                            aria-label="Delete leave type"
                          >
                            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                              <path d="M3 6h14M8 6V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2m3 0v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM8 9v6M12 9v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-600">No leave types found. Click "Add Leave Type" to create one.</p>
          )}
        </div>
      )}

      {/* Shift Types Tab */}
      {activeTab === 'shift-types' && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-900">Shift Types Management</h3>
            <button
              onClick={() => {
                setShowAddShiftType(true);
                setEditingShiftType(null);
                setNewShiftType({
                  code: '',
                  description: '',
                  color_hex: '#E5E7EB',
                  is_working_shift: true,
                  is_active: true,
                });
              }}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              ➕ Add Shift Type
            </button>
          </div>

          {/* Shift Types Table */}
          {loadingShiftTypes ? (
            <LoadingSkeleton type="table" rows={5} columns={5} />
          ) : shiftTypes.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Code</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Description</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Color</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {shiftTypes.map((type) => (
                    <tr key={type.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 border border-gray-300">
                        <span className="font-mono">{type.code}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{type.description || '-'}</td>
                      <td className="px-4 py-3 text-sm border border-gray-300">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-6 h-6 rounded border border-gray-300"
                            style={{ backgroundColor: type.color_hex }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm border border-gray-300">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          type.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {type.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm border border-gray-300">
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setEditingShiftType(type);
                              setShowAddShiftType(false);
                              setNewShiftType({
                                code: type.code,
                                description: type.description || '',
                                color_hex: type.color_hex,
                                is_working_shift: type.is_working_shift,
                                is_active: type.is_active,
                              });
                            }}
                            className="text-blue-600 hover:text-blue-800"
                            title="Edit shift type"
                            aria-label="Edit shift type"
                          >
                            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                              <path d="M11 3H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 0 3L12 12l-4 1 1-4 6.5-6.5a2.121 2.121 0 0 1 3 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              setDeletingShiftType(type);
                              setShowAddShiftType(false);
                              setEditingShiftType(null);
                            }}
                            className="text-red-600 hover:text-red-800"
                            title="Delete shift type"
                            aria-label="Delete shift type"
                          >
                            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                              <path d="M3 6h14M8 6V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2m3 0v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM8 9v6M12 9v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-600">No shift types found. Click "Add Shift Type" to create one.</p>
          )}
        </div>
      )}

      {/* Scheduling Rules Tab */}
      {activeTab === 'scheduling-rules' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-xl font-bold text-gray-900 mb-4">How the Schedule is Created</h3>

          <div className="space-y-6">
            {/* Core Constraints */}
            <section className="border border-gray-200 rounded-lg bg-gray-50 px-5 py-4">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Basic Rules</h4>
              <ul className="list-disc pl-6 space-y-2 text-sm text-gray-700">
                <li>Each person works one shift per day (or has a day off)</li>
                <li>People only work shifts they're trained for</li>
                <li>Every day must have enough staff to cover all shifts</li>
                <li>Staff with only the Clinic (CL) skill only work clinic shifts</li>
              </ul>
            </section>

            {/* Time Off & Locks */}
            <section className="border border-gray-200 rounded-lg bg-gray-50 px-5 py-4">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Time Off & Special Assignments</h4>
              <ul className="list-disc pl-6 space-y-2 text-sm text-gray-700">
                <li>Approved time off requests are automatically scheduled</li>
                <li>Managers can lock shifts: require someone to work a shift, or prevent them from working it</li>
              </ul>
            </section>

            {/* Caps & Limits */}
            <section className="border border-gray-200 rounded-lg bg-gray-50 px-5 py-4">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Shift Limits</h4>
              <ul className="list-disc pl-6 space-y-2 text-sm text-gray-700">
                <li>Maximum number of night shifts per person per month</li>
                <li>Maximum number of afternoon shifts per person per month</li>
                <li>Minimum number of rest days per person per month</li>
              </ul>
            </section>

            {/* Rest Day Rules */}
            <section className="border border-gray-200 rounded-lg bg-gray-50 px-5 py-4">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Weekly Rest</h4>
              <ul className="list-disc pl-6 space-y-2 text-sm text-gray-700">
                <li>Everyone must have at least 1 rest day per week</li>
                <li>Rest days include: days off, leave, and weekends</li>
              </ul>
            </section>

            {/* Sequencing Rules */}
            <section className="border border-gray-200 rounded-lg bg-gray-50 px-5 py-4">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Shift Patterns</h4>
              <ul className="list-disc pl-6 space-y-2 text-sm text-gray-700">
                <li>After working a night shift, you must have a day off the next day</li>
                <li>You cannot work night shifts on back-to-back days</li>
                <li>Some shift combinations are not allowed (e.g., morning after night)</li>
              </ul>
            </section>

            {/* Single Skill Employees */}
            <section className="border border-gray-200 rounded-lg bg-gray-50 px-5 py-4">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Employees with One Skill</h4>
              <ul className="list-disc pl-6 space-y-2 text-sm text-gray-700">
                <li>Work Sunday through Thursday, rest on Friday and Saturday</li>
                <li>This can be changed if needed (e.g., for time off or special assignments)</li>
              </ul>
            </section>

            {/* Objective Weights */}
            <section className="border border-gray-200 rounded-lg bg-gray-50 px-5 py-4">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Schedule Quality</h4>
              <ul className="list-disc pl-6 space-y-2 text-sm text-gray-700">
                <li>Ensures all shifts are covered (most important)</li>
                <li>Distributes shifts fairly among staff</li>
                <li>Prefers giving days off after night shifts</li>
              </ul>
            </section>
          </div>
        </div>
      )}

      {/* Leave Type Add/Edit Modal */}
      {(showAddLeaveType || editingLeaveType) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-gray-900">
                  {editingLeaveType ? 'Edit Leave Type' : 'Add New Leave Type'}
                </h3>
                <button
                  onClick={() => {
                    setShowAddLeaveType(false);
                    setEditingLeaveType(null);
                    setNewLeaveType({
                      code: '',
                      description: '',
                      color_hex: '#F5F5F5',
                      counts_as_rest: true,
                      is_active: true,
                    });
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
              <form onSubmit={editingLeaveType ? (e) => { e.preventDefault(); handleUpdateLeaveType(editingLeaveType.code, newLeaveType); } : handleCreateLeaveType} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Code <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newLeaveType.code}
                    onChange={(e) => setNewLeaveType({ ...newLeaveType, code: e.target.value.toUpperCase() })}
                    placeholder="e.g., AL, ML, STL"
                    required
                    disabled={!!editingLeaveType}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100"
                    maxLength={10}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={newLeaveType.description || ''}
                    onChange={(e) => setNewLeaveType({ ...newLeaveType, description: e.target.value })}
                    placeholder="e.g., Annual Leave"
                    rows={2}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div className="flex items-center gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Color
                    </label>
                    <input
                      type="color"
                      value={newLeaveType.color_hex}
                      onChange={(e) => setNewLeaveType({ ...newLeaveType, color_hex: e.target.value })}
                      className="h-10 w-16 border border-gray-300 rounded"
                    />
                  </div>
                  <div className="flex items-center pt-6">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={newLeaveType.is_active}
                        onChange={(e) => setNewLeaveType({ ...newLeaveType, is_active: e.target.checked })}
                        className="mr-2"
                      />
                      <span className="text-sm text-gray-700">Active</span>
                    </label>
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                  >
                    {editingLeaveType ? 'Update' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddLeaveType(false);
                      setEditingLeaveType(null);
                      setNewLeaveType({
                        code: '',
                        description: '',
                        color_hex: '#F5F5F5',
                        counts_as_rest: true,
                        is_active: true,
                      });
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Shift Type Add/Edit Modal */}
      {(showAddShiftType || editingShiftType) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-gray-900">
                  {editingShiftType ? 'Edit Shift Type' : 'Add New Shift Type'}
                </h3>
                <button
                  onClick={() => {
                    setShowAddShiftType(false);
                    setEditingShiftType(null);
                    setNewShiftType({
                      code: '',
                      description: '',
                      color_hex: '#E5E7EB',
                      is_working_shift: true,
                      is_active: true,
                    });
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
              <form onSubmit={editingShiftType ? (e) => { e.preventDefault(); handleUpdateShiftType(editingShiftType.code, newShiftType); } : handleCreateShiftType} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Code <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newShiftType.code}
                    onChange={(e) => setNewShiftType({ ...newShiftType, code: e.target.value.toUpperCase() })}
                    placeholder="e.g., M, IP, A, N"
                    required
                    disabled={!!editingShiftType}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100"
                    maxLength={10}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={newShiftType.description || ''}
                    onChange={(e) => setNewShiftType({ ...newShiftType, description: e.target.value })}
                    placeholder="e.g., Morning"
                    rows={2}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div className="flex items-center gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Color
                    </label>
                    <input
                      type="color"
                      value={newShiftType.color_hex}
                      onChange={(e) => setNewShiftType({ ...newShiftType, color_hex: e.target.value })}
                      className="h-10 w-16 border border-gray-300 rounded"
                    />
                  </div>
                  <div className="flex items-center pt-6">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={newShiftType.is_active}
                        onChange={(e) => setNewShiftType({ ...newShiftType, is_active: e.target.checked })}
                        className="mr-2"
                      />
                      <span className="text-sm text-gray-700">Active</span>
                    </label>
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                  >
                    {editingShiftType ? 'Update' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddShiftType(false);
                      setEditingShiftType(null);
                      setNewShiftType({
                        code: '',
                        description: '',
                        color_hex: '#E5E7EB',
                        is_working_shift: true,
                        is_active: true,
                      });
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Leave Type Confirmation Modal */}
      {deletingLeaveType && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Delete Leave Type</h3>
              <p className="text-gray-700 mb-6">
                Are you sure you want to delete leave type <strong>"{deletingLeaveType.code}"</strong>? This action cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setDeletingLeaveType(null)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteLeaveType}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Shift Type Confirmation Modal */}
      {deletingShiftType && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Delete Shift Type</h3>
              <p className="text-gray-700 mb-6">
                Are you sure you want to delete shift type <strong>"{deletingShiftType.code}"</strong>? This action cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setDeletingShiftType(null)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteShiftType}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

