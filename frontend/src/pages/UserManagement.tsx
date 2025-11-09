import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { dataAPI, usersAPI, requestsAPI } from '../services/api';
import api from '../services/api';

interface User {
  username: string;
  employee_name: string;
  employee_type: string;
  password_hidden: string;
}

export const UserManagement: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [employeeType, setEmployeeType] = useState('Staff');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'leave' | 'shift'>('users');
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [shiftRequests, setShiftRequests] = useState<any[]>([]);
  const [processingRequest, setProcessingRequest] = useState<string | null>(null);

  const pendingLeaveCount = leaveRequests.filter((req) => req.status === 'Pending').length;
  const pendingShiftCount = shiftRequests.filter((req) => req.status === 'Pending').length;

  useEffect(() => {
    loadData();
    if (currentUser?.employee_type === 'Manager') {
      loadRequests();
    }
  }, []);

  useEffect(() => {
    if (currentUser?.employee_type === 'Manager' && (activeTab === 'leave' || activeTab === 'shift')) {
      loadRequests();
    }
  }, [activeTab, currentUser]);

  const loadRequests = async () => {
    try {
      const [leaveRes, shiftRes] = await Promise.all([
        requestsAPI.getAllLeaveRequests(),
        requestsAPI.getAllShiftRequests(),
      ]);
      setLeaveRequests(leaveRes);
      setShiftRequests(shiftRes);
      const pendingCount =
        leaveRes.filter((req: any) => req.status === 'Pending').length +
        shiftRes.filter((req: any) => req.status === 'Pending').length;
      window.dispatchEvent(
        new CustomEvent('pendingRequestsUpdated', { detail: { count: pendingCount } })
      );
    } catch (error) {
      console.error('Failed to load requests:', error);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [usersRes, employeesRes] = await Promise.all([
        api.get('/api/users/'),
        dataAPI.getEmployees(),
      ]);
      setUsers(usersRes.data);
      setEmployees(employeesRes);
      if (employeesRes.length > 0) {
        setSelectedEmployee(employeesRes[0].employee);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedEmployee) {
      alert('Please select an employee');
      return;
    }

    try {
      setUpdating(true);
      await api.put('/api/users/', {
        employee_name: selectedEmployee,
        password: newPassword || undefined,
        employee_type: employeeType,
      });
      
      setNotification({ message: '✅ User account updated successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      setNewPassword('');
      await loadData();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to update user account', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteUser = async (username: string, employeeName: string) => {
    if (!window.confirm(`Are you sure you want to delete the user account for "${employeeName}" (${username})? This action cannot be undone.`)) {
      return;
    }

    try {
      setDeleting(username);
      await usersAPI.deleteUser(username);
      setNotification({ message: '✅ User account deleted successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      await loadData();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to delete user account', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setDeleting(null);
    }
  };

  const getUsername = (employeeName: string) => {
    return employeeName.toLowerCase().replace(' ', '_');
  };

  const handleApproveLeave = async (requestId: string) => {
    try {
      setProcessingRequest(requestId);
      await requestsAPI.approveLeaveRequest(requestId);
      setNotification({ message: '✅ Leave request approved successfully! It has been added to the roster.', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
      await loadRequests();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to approve leave request', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleRejectLeave = async (requestId: string) => {
    if (!window.confirm('Are you sure you want to reject this leave request?')) {
      return;
    }
    try {
      setProcessingRequest(requestId);
      await requestsAPI.rejectLeaveRequest(requestId);
      setNotification({ message: 'Leave request rejected', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      await loadRequests();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to reject leave request', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleApproveShift = async (requestId: string) => {
    try {
      setProcessingRequest(requestId);
      await requestsAPI.approveShiftRequest(requestId);
      setNotification({ message: '✅ Shift request approved successfully! It has been added to the roster.', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
      await loadRequests();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to approve shift request', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleRejectShift = async (requestId: string) => {
    if (!window.confirm('Are you sure you want to reject this shift request?')) {
      return;
    }
    try {
      setProcessingRequest(requestId);
      await requestsAPI.rejectShiftRequest(requestId);
      setNotification({ message: 'Shift request rejected', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      await loadRequests();
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to reject shift request', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setProcessingRequest(null);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-3xl font-bold text-gray-900 mb-6">User Management</h2>
      
      {/* Auto-dismissing notification toast */}
      {notification && (
        <div 
          className={`fixed top-20 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
            notification.type === 'success' 
              ? 'bg-green-500 text-white' 
              : 'bg-red-500 text-white'
          }`}
          style={{ animation: 'slideIn 0.3s ease-out' }}
        >
          {notification.message}
        </div>
      )}

      {/* Tabs for Managers */}
      {currentUser?.employee_type === 'Manager' && (
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('users')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'users'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              👥 User Accounts
            </button>
            <button
              onClick={() => setActiveTab('leave')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'leave'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="inline-flex items-center space-x-2">
                <span>🏖️ Leave Requests</span>
                {pendingLeaveCount > 0 && (
                  <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-2 text-xs font-semibold text-white bg-red-600 rounded-full">
                    {pendingLeaveCount}
                  </span>
                )}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('shift')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'shift'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="inline-flex items-center space-x-2">
                <span>🔒 Shift Requests</span>
                {pendingShiftCount > 0 && (
                  <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-2 text-xs font-semibold text-white bg-red-600 rounded-full">
                    {pendingShiftCount}
                  </span>
                )}
              </span>
            </button>
          </nav>
        </div>
      )}

      {/* Leave Requests Tab */}
      {activeTab === 'leave' && currentUser?.employee_type === 'Manager' && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
              <span>🏖️ Leave Requests</span>
              {pendingLeaveCount > 0 && (
                <span className="inline-flex items-center justify-center h-7 min-w-[1.75rem] px-2 text-xs font-semibold text-white bg-red-600 rounded-full">
                  {pendingLeaveCount}
                </span>
              )}
            </h3>
            {pendingLeaveCount > 0 && (
              <span className="text-sm text-gray-500">
                Pending approval
              </span>
            )}
          </div>
          {leaveRequests.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Employee</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">From Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">To Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Reason</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Submitted</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {leaveRequests.map((req) => (
                    <tr key={req.request_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900 border border-gray-300">{req.employee}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{formatDate(req.from_date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{formatDate(req.to_date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{req.leave_type}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{req.reason || '-'}</td>
                      <td className="px-4 py-3 text-sm border border-gray-300">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          req.status === 'Approved' ? 'bg-green-100 text-green-800' :
                          req.status === 'Rejected' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {req.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 border border-gray-300">{formatDateTime(req.submitted_at)}</td>
                      <td className="px-4 py-3 text-sm border border-gray-300">
                        {req.status === 'Pending' ? (
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleApproveLeave(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              {processingRequest === req.request_id ? 'Processing...' : 'Approve'}
                            </button>
                            <button
                              onClick={() => handleRejectLeave(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500">
                            {req.approved_by && `By ${req.approved_by}`}
                            {req.approved_at && ` on ${formatDate(req.approved_at)}`}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-600">No leave requests found.</p>
          )}
        </div>
      )}

      {/* Shift Requests Tab */}
      {activeTab === 'shift' && currentUser?.employee_type === 'Manager' && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
              <span>🔒 Shift Requests</span>
              {pendingShiftCount > 0 && (
                <span className="inline-flex items-center justify-center h-7 min-w-[1.75rem] px-2 text-xs font-semibold text-white bg-red-600 rounded-full">
                  {pendingShiftCount}
                </span>
              )}
            </h3>
            {pendingShiftCount > 0 && (
              <span className="text-sm text-gray-500">
                Pending approval
              </span>
            )}
          </div>
          {shiftRequests.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Employee</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">From Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">To Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Shift</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Reason</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Submitted</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border border-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {shiftRequests.map((req) => (
                    <tr key={req.request_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900 border border-gray-300">{req.employee}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{formatDate(req.from_date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{formatDate(req.to_date || req.from_date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{req.shift}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">
                        {req.force ? 'Force (Must)' : 'Forbid (Cannot)'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 border border-gray-300">{req.reason || '-'}</td>
                      <td className="px-4 py-3 text-sm border border-gray-300">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          req.status === 'Approved' ? 'bg-green-100 text-green-800' :
                          req.status === 'Rejected' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {req.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 border border-gray-300">{formatDateTime(req.submitted_at)}</td>
                      <td className="px-4 py-3 text-sm border border-gray-300">
                        {req.status === 'Pending' ? (
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleApproveShift(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              {processingRequest === req.request_id ? 'Processing...' : 'Approve'}
                            </button>
                            <button
                              onClick={() => handleRejectShift(req.request_id)}
                              disabled={processingRequest === req.request_id}
                              className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500">
                            {req.approved_by && `By ${req.approved_by}`}
                            {req.approved_at && ` on ${formatDate(req.approved_at)}`}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-600">No shift requests found.</p>
          )}
        </div>
      )}

      {/* User Accounts Tab */}
      {activeTab === 'users' && (
        <>
      {/* Display Current Users */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h3 className="text-xl font-bold text-gray-900 mb-4">Employee User Accounts</h3>
        {users.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                    Username
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                    Employee Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                    Employee Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                    Password
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((user, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 border border-gray-300">
                      {user.username}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border border-gray-300">
                      {user.employee_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border border-gray-300">
                      {user.employee_type}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border border-gray-300">
                      {user.password_hidden}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm border border-gray-300">
                      <button
                        onClick={() => handleDeleteUser(user.username, user.employee_name)}
                        disabled={deleting === user.username || user.username === currentUser?.username}
                        className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={user.username === currentUser?.username ? "Cannot delete your own account" : "Delete user account"}
                      >
                        {deleting === user.username ? 'Deleting...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-600">No users found.</p>
        )}
      </div>

      {/* Edit User Form */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-xl font-bold text-gray-900 mb-4">Edit User Account</h3>
        <form onSubmit={handleUpdateUser} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Employee
              </label>
              <select
                value={selectedEmployee}
                onChange={(e) => {
                  setSelectedEmployee(e.target.value);
                  // Find existing user type if user exists
                  const username = getUsername(e.target.value);
                  const existingUser = users.find(u => u.username === username);
                  if (existingUser) {
                    setEmployeeType(existingUser.employee_type);
                  } else {
                    setEmployeeType('Staff');
                  }
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
              >
                <option value="">Select Employee...</option>
                {employees.map(emp => (
                  <option key={emp.employee} value={emp.employee}>
                    {emp.employee}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Username
              </label>
              <input
                type="text"
                value={selectedEmployee ? getUsername(selectedEmployee) : ''}
                disabled
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-500"
              />
              <p className="text-xs text-gray-500 mt-1">Username cannot be changed</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                placeholder="Leave empty to keep current password"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Employee Type
              </label>
              <select
                value={employeeType}
                onChange={(e) => setEmployeeType(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
              >
                <option value="Staff">Staff</option>
                <option value="Manager">Manager</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={updating || !selectedEmployee}
              className="px-6 py-3 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updating ? 'Updating...' : 'Update User Account'}
            </button>
          </div>
        </form>
      </div>
        </>
      )}
    </div>
  );
};

