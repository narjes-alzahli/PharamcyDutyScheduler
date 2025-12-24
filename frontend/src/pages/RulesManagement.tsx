import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { leaveTypesAPI, shiftTypesAPI, LeaveType, LeaveTypeCreate, ShiftType, ShiftTypeCreate } from '../services/api';

export const RulesManagement: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'leave-types' | 'shift-types' | 'scheduling-rules'>('leave-types');
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [showAddLeaveType, setShowAddLeaveType] = useState(false);
  const [showAddShiftType, setShowAddShiftType] = useState(false);
  const [editingLeaveType, setEditingLeaveType] = useState<LeaveType | null>(null);
  const [editingShiftType, setEditingShiftType] = useState<ShiftType | null>(null);
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
      }
    }
  }, [activeTab, currentUser]);

  const loadLeaveTypes = async () => {
    try {
      const types = await leaveTypesAPI.getLeaveTypes();
      setLeaveTypes(types);
    } catch (error) {
      console.error('Failed to load leave types:', error);
      setNotification({ message: 'Failed to load leave types', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
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

  const handleDeleteLeaveType = async (code: string) => {
    if (!window.confirm(`Are you sure you want to delete leave type "${code}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await leaveTypesAPI.deleteLeaveType(code);
      setNotification({ message: '✅ Leave type deleted successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      await loadLeaveTypes();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to delete leave type', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    }
  };

  const loadShiftTypes = async () => {
    try {
      const types = await shiftTypesAPI.getShiftTypes();
      // Filter out non-working shifts (DO, O) - only show working shifts in the UI
      // Backend still has them, but they shouldn't be displayed here
      const workingShifts = types.filter(type => type.is_working_shift === true);
      setShiftTypes(workingShifts);
    } catch (error) {
      console.error('Failed to load shift types:', error);
      setNotification({ message: 'Failed to load shift types', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
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

  const handleDeleteShiftType = async (code: string) => {
    if (!window.confirm(`Are you sure you want to delete shift type "${code}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await shiftTypesAPI.deleteShiftType(code);
      setNotification({ message: '✅ Shift type deleted successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
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
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Rules Management</h1>
        <p className="text-gray-600 mt-2">Configure leave types and view scheduling rules.</p>
      </div>

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
            🔄 Shift Types
          </button>
          <button
            onClick={() => setActiveTab('scheduling-rules')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'scheduling-rules'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            📐 Scheduling Rules
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

          {/* Add/Edit Form */}
          {(showAddLeaveType || editingLeaveType) && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h4 className="text-lg font-semibold text-gray-900 mb-4">
                {editingLeaveType ? 'Edit Leave Type' : 'Add New Leave Type'}
              </h4>
              <form onSubmit={editingLeaveType ? (e) => { e.preventDefault(); handleUpdateLeaveType(editingLeaveType.code, newLeaveType); } : handleCreateLeaveType} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
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
                    <p className="mt-1 text-xs text-gray-500">Uppercase alphanumeric code (e.g., AL, ML, STL)</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
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
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Color (Hex)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={newLeaveType.color_hex}
                        onChange={(e) => setNewLeaveType({ ...newLeaveType, color_hex: e.target.value })}
                        className="h-10 w-20 border border-gray-300 rounded"
                      />
                      <input
                        type="text"
                        value={newLeaveType.color_hex}
                        onChange={(e) => setNewLeaveType({ ...newLeaveType, color_hex: e.target.value })}
                        placeholder="#F5F5F5"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={newLeaveType.counts_as_rest}
                        onChange={(e) => setNewLeaveType({ ...newLeaveType, counts_as_rest: e.target.checked })}
                        className="mr-2"
                      />
                      <span className="text-sm text-gray-700">Counts as rest day</span>
                    </label>
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
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                  >
                    {editingLeaveType ? 'Update Leave Type' : 'Create Leave Type'}
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
          )}

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
                          <span className="text-xs text-gray-500 font-mono">{type.color_hex}</span>
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
                            className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteLeaveType(type.code)}
                            className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                          >
                            Delete
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
            <h3 className="text-xl font-bold text-gray-900">🔄 Shift Types Management</h3>
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

          {/* Add/Edit Form */}
          {(showAddShiftType || editingShiftType) && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h4 className="text-lg font-semibold text-gray-900 mb-4">
                {editingShiftType ? 'Edit Shift Type' : 'Add New Shift Type'}
              </h4>
              <form onSubmit={editingShiftType ? (e) => { e.preventDefault(); handleUpdateShiftType(editingShiftType.code, newShiftType); } : handleCreateShiftType} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
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
                    <p className="mt-1 text-xs text-gray-500">Uppercase alphanumeric code (e.g., M, IP, A, N)</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
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
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Color (Hex)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={newShiftType.color_hex}
                        onChange={(e) => setNewShiftType({ ...newShiftType, color_hex: e.target.value })}
                        className="h-10 w-20 border border-gray-300 rounded"
                      />
                      <input
                        type="text"
                        value={newShiftType.color_hex}
                        onChange={(e) => setNewShiftType({ ...newShiftType, color_hex: e.target.value })}
                        placeholder="#E5E7EB"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={newShiftType.is_working_shift}
                        onChange={(e) => setNewShiftType({ ...newShiftType, is_working_shift: e.target.checked })}
                        className="mr-2"
                      />
                      <span className="text-sm text-gray-700">Working shift (not rest/leave)</span>
                    </label>
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
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                  >
                    {editingShiftType ? 'Update Shift Type' : 'Create Shift Type'}
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
          )}

          {/* Shift Types Table */}
          {shiftTypes.length > 0 ? (
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
                          <span className="text-xs text-gray-500 font-mono">{type.color_hex}</span>
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
                            className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteShiftType(type.code)}
                            className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                          >
                            Delete
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
          <h3 className="text-xl font-bold text-gray-900 mb-4">📐 Scheduling Rules & Constraints</h3>
          <p className="text-gray-600 mb-6">
            These are the rules and constraints currently applied when the solver generates a monthly roster.
            All rules are enforced automatically to ensure compliance with operational requirements and employee preferences.
          </p>

          <div className="space-y-6">
            {/* Core Constraints */}
            <section className="border border-gray-200 rounded-lg bg-gray-50 px-5 py-4">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Core Constraints</h4>
              <ul className="list-disc pl-6 space-y-2 text-sm text-gray-700">
                <li><strong>One Shift Per Day:</strong> Each employee must work exactly one shift per day (working shift, day off, or leave).</li>
                <li><strong>Skill Requirements:</strong> Employees can only work shifts they are qualified for based on their skills (M, IP, A, N, M3, M4, H, CL).</li>
                <li><strong>Coverage Requirements:</strong> Daily demand for each shift type must be met. The solver ensures at least the minimum required coverage for each shift.</li>
                <li><strong>Clinic-Only Employees:</strong> Employees marked as clinic-only can only work CL (Clinic) shifts.</li>
              </ul>
            </section>

            {/* Time Off & Locks */}
            <section className="border border-gray-200 rounded-lg bg-gray-50 px-5 py-4">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Time Off & Special Requests</h4>
              <ul className="list-disc pl-6 space-y-2 text-sm text-gray-700">
                <li><strong>Leave Requests:</strong> Approved leave requests are enforced. Employees on leave are assigned the appropriate leave code (AL, ML, DO, etc.) for those dates.</li>
                <li><strong>Shift Locks (Force):</strong> Managers can force specific shift assignments. If a shift is locked as "must work", the employee must work that shift.</li>
                <li><strong>Shift Locks (Forbid):</strong> Managers can forbid specific shift assignments. If a shift is locked as "cannot work", the employee cannot work that shift.</li>
              </ul>
            </section>

            {/* Caps & Limits */}
            <section className="border border-gray-200 rounded-lg bg-gray-50 px-5 py-4">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Shift Caps & Limits</h4>
              <ul className="list-disc pl-6 space-y-2 text-sm text-gray-700">
                <li><strong>Night Shift Cap (maxN):</strong> Each employee has a maximum number of night shifts (N) they can work per month.</li>
                <li><strong>Afternoon Shift Cap (maxA):</strong> Each employee has a maximum number of afternoon shifts (A) they can work per month.</li>
                <li><strong>Minimum Days Off:</strong> Each employee must have at least a specified number of rest days per month. Rest days include DO, O, ML, W, and other leave codes marked as "counts as rest".</li>
              </ul>
            </section>

            {/* Rest Day Rules */}
            <section className="border border-gray-200 rounded-lg bg-gray-50 px-5 py-4">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Rest Day Rules</h4>
              <ul className="list-disc pl-6 space-y-2 text-sm text-gray-700">
                <li><strong>Weekly Rest Minimum:</strong> Each employee must have at least 1 rest day per 7-day window (week). Rest days include DO, O, ML, W, and other leave codes marked as "counts as rest".</li>
                <li><strong>Rest Codes:</strong> The following codes count as rest days: DO (Day Off), O (Off), ML (Maternity Leave), W (Weekend). Other leave types can be configured to count as rest days.</li>
              </ul>
            </section>

            {/* Sequencing Rules */}
            <section className="border border-gray-200 rounded-lg bg-gray-50 px-5 py-4">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Shift Sequencing Rules</h4>
              <ul className="list-disc pl-6 space-y-2 text-sm text-gray-700">
                <li><strong>After Night Shift Rest:</strong> After working a Night (N) shift, an employee must have a rest day (O or DO) the following day.</li>
                <li><strong>No Back-to-Back Nights:</strong> Employees cannot work Night (N) shifts on consecutive days.</li>
                <li><strong>Forbidden Adjacencies:</strong> Certain shift sequences are forbidden:
                  <ul className="list-circle pl-6 mt-2 space-y-1">
                    <li>Cannot work Main (M) shift after Night (N) shift</li>
                    <li>Cannot work Night (N) shift after Afternoon (A) shift</li>
                  </ul>
                </li>
              </ul>
            </section>

            {/* Single Skill Employees */}
            <section className="border border-gray-200 rounded-lg bg-gray-50 px-5 py-4">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Single Skill Employee Rules</h4>
              <ul className="list-disc pl-6 space-y-2 text-sm text-gray-700">
                <li><strong>Weekend Rest:</strong> Employees with only one skill must work their shift Sunday through Thursday and rest on Friday and Saturday.</li>
                <li><strong>Override:</strong> This rule can be overridden by explicit shift locks (force/forbid) or time off requests.</li>
              </ul>
            </section>

            {/* Objective Weights */}
            <section className="border border-gray-200 rounded-lg bg-gray-50 px-5 py-4">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Optimization Objectives</h4>
              <p className="text-sm text-gray-700 mb-2">The solver optimizes for multiple objectives with the following weights:</p>
              <ul className="list-disc pl-6 space-y-2 text-sm text-gray-700">
                <li><strong>Unfilled Coverage (1000.0):</strong> Highest priority - penalty for not meeting minimum coverage requirements.</li>
                <li><strong>Fairness (5.0):</strong> Weight for fair distribution of shifts among employees.</li>
                <li><strong>Area Switching (1.0):</strong> Penalty for employees switching between different work areas/shift types.</li>
                <li><strong>Day Off After Night (1.0):</strong> Reward/preference for having a day off after working a night shift.</li>
              </ul>
            </section>

            {/* Additional Notes */}
            <section className="border border-blue-200 rounded-lg bg-blue-50 px-5 py-4">
              <h4 className="text-lg font-semibold text-blue-900 mb-3">Notes</h4>
              <ul className="list-disc pl-6 space-y-2 text-sm text-blue-700">
                <li>All constraints are hard constraints (must be satisfied) except for optimization objectives which are soft constraints (preferences).</li>
                <li>If the solver cannot find a solution, it means the constraints are too restrictive. Consider adjusting employee availability, coverage requirements, or shift caps.</li>
                <li>Leave types can be configured to count as rest days or not, affecting weekly rest calculations.</li>
                <li>The solver runs for up to 5 minutes (300 seconds) to find the best solution.</li>
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
};

