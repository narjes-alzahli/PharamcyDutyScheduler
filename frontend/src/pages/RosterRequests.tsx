import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { requestsAPI, leaveTypesAPI, LeaveType } from '../services/api';

interface LeaveRequest {
  from_date: string;
  to_date: string;
  leave_type: string;
  reason?: string;
  status: string;
  submitted_at: string;
  request_id: string;
}

interface ShiftRequest {
  from_date: string;
  to_date: string;
  shift: string;
  force: boolean;
  reason?: string;
  status: string;
  submitted_at: string;
  request_id: string;
}

export const RosterRequests: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('leave');
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [shiftRequests, setShiftRequests] = useState<ShiftRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);

  // Form states for leave request
  const [leaveFromDate, setLeaveFromDate] = useState('');
  const [leaveToDate, setLeaveToDate] = useState('');
  const [leaveType, setLeaveType] = useState('DO');
  const [leaveReason, setLeaveReason] = useState('');
  const [editingLeaveId, setEditingLeaveId] = useState<string | null>(null);

  // Form states for shift request
  const [shiftFromDate, setShiftFromDate] = useState('');
  const [shiftToDate, setShiftToDate] = useState('');
  const [shiftType, setShiftType] = useState('M');
  const [requestType, setRequestType] = useState('Force (Must)');
  const [shiftReason, setShiftReason] = useState('');
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);

  useEffect(() => {
    loadRequests();
    loadLeaveTypes();
    // Set default dates to today
    const today = new Date().toISOString().split('T')[0];
    setLeaveFromDate(today);
    setLeaveToDate(today);
    setShiftFromDate(today);
    setShiftToDate(today);
  }, []);

  const loadLeaveTypes = async () => {
    try {
      const types = await leaveTypesAPI.getLeaveTypes(true); // Only active types
      setLeaveTypes(types);
      // Set default to first active leave type if available
      if (types.length > 0 && !leaveType) {
        setLeaveType(types[0].code);
      }
    } catch (error) {
      console.error('Failed to load leave types:', error);
    }
  };

  const loadRequests = async () => {
    try {
      setLoading(true);
      const [leaveReqs, shiftReqs] = await Promise.all([
        requestsAPI.getLeaveRequests(),
        requestsAPI.getShiftRequests(),
      ]);
      setLeaveRequests(leaveReqs);
      setShiftRequests(shiftReqs);
    } catch (error) {
      console.error('Failed to load requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const resetLeaveForm = () => {
    const today = new Date().toISOString().split('T')[0];
    setLeaveFromDate(today);
    setLeaveToDate(today);
    setLeaveType('DO');
    setLeaveReason('');
    setEditingLeaveId(null);
  };

  const resetShiftForm = () => {
    const today = new Date().toISOString().split('T')[0];
    setShiftFromDate(today);
    setShiftToDate(today);
    setShiftType('M');
    setRequestType('Force (Must)');
    setShiftReason('');
    setEditingShiftId(null);
  };

  const handleSubmitLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (new Date(leaveFromDate) > new Date(leaveToDate)) {
      alert('From date cannot be after to date');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        from_date: leaveFromDate,
        to_date: leaveToDate,
        leave_type: leaveType,
        reason: leaveReason,
      };

      if (editingLeaveId) {
        await requestsAPI.updateLeaveRequest(editingLeaveId, payload);
      } else {
        await requestsAPI.createLeaveRequest(payload);
      }
      
      // Reset form
      resetLeaveForm();
      
      // Reload requests
      await loadRequests();
      setNotification({
        message: editingLeaveId
          ? '✅ Leave request updated successfully!'
          : '✅ Leave request submitted successfully!',
        type: 'success',
      });
      setTimeout(() => setNotification(null), 3000);
    } catch (error: any) {
      setNotification({
        message: error.response?.data?.detail || (editingLeaveId ? 'Failed to update leave request' : 'Failed to submit leave request'),
        type: 'error',
      });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitShift = async (e: React.FormEvent) => {
    e.preventDefault();

    if (new Date(shiftFromDate) > new Date(shiftToDate)) {
      alert('From date cannot be after to date');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        from_date: shiftFromDate,
        to_date: shiftToDate,
        shift: shiftType,
        request_type: requestType,
        reason: shiftReason,
      };

      if (editingShiftId) {
        await requestsAPI.updateShiftRequest(editingShiftId, payload);
      } else {
        await requestsAPI.createShiftRequest(payload);
      }
      
      // Reset form
      resetShiftForm();
      
      // Reload requests
      await loadRequests();
      setNotification({
        message: editingShiftId
          ? '✅ Shift request updated successfully!'
          : '✅ Shift request submitted successfully!',
        type: 'success',
      });
      setTimeout(() => setNotification(null), 3000);
    } catch (error: any) {
      setNotification({
        message: error.response?.data?.detail || (editingShiftId ? 'Failed to update shift request' : 'Failed to submit shift request'),
        type: 'error',
      });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditLeave = (req: LeaveRequest) => {
    setActiveTab('leave');
    setEditingLeaveId(req.request_id);
    setLeaveFromDate(req.from_date);
    setLeaveToDate(req.to_date);
    setLeaveType(req.leave_type);
    setLeaveReason(req.reason || '');
  };

  const handleCancelLeaveEdit = () => {
    resetLeaveForm();
  };

  const handleDeleteLeave = async (requestId: string) => {
    if (!window.confirm('Are you sure you want to delete this leave request?')) {
      return;
    }
    try {
      setProcessingRequestId(requestId);
      await requestsAPI.deleteLeaveRequest(requestId);
      await loadRequests();
      resetLeaveForm();
      setNotification({ message: 'Leave request deleted.', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to delete leave request', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handleEditShiftRequest = (req: ShiftRequest) => {
    setActiveTab('shift');
    setEditingShiftId(req.request_id);
    setShiftFromDate(req.from_date);
    setShiftToDate(req.to_date || req.from_date);
    setShiftType(req.shift);
    setRequestType(req.force ? 'Force (Must)' : 'Forbid (Cannot)');
    setShiftReason(req.reason || '');
  };

  const handleCancelShiftEdit = () => {
    resetShiftForm();
  };

  const handleDeleteShift = async (requestId: string) => {
    if (!window.confirm('Are you sure you want to delete this shift request?')) {
      return;
    }
    try {
      setProcessingRequestId(requestId);
      await requestsAPI.deleteShiftRequest(requestId);
      await loadRequests();
      resetShiftForm();
      setNotification({ message: 'Shift request deleted.', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
    } catch (error: any) {
      setNotification({ message: error.response?.data?.detail || 'Failed to delete shift request', type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setProcessingRequestId(null);
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
    <div className="pb-16">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl">Roster Requests</h2>
          <p className="text-sm text-gray-600 sm:text-base">
            Submit new leave or shift preferences and track existing requests in one place.
          </p>
        </header>

      {/* Auto-dismissing notification toast */}
      {notification && (
        <div
          className={`fixed left-4 right-4 top-20 z-50 px-4 py-3 rounded-lg shadow-lg sm:left-auto sm:right-6 ${
            notification.type === 'success'
              ? 'bg-green-500 text-white'
              : 'bg-red-500 text-white'
          }`}
          style={{ animation: 'slideIn 0.3s ease-out' }}
        >
          {notification.message}
        </div>
      )}

        {/* Tabs */}
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-200 bg-gray-50/60">
            <nav className="flex items-center gap-2 px-4 py-4 sm:items-end sm:gap-0 sm:px-6 sm:pt-0">
            <button
              onClick={() => setActiveTab('leave')}
                className={`flex-1 rounded-lg px-4 py-3 text-sm font-semibold transition-colors sm:flex-none sm:rounded-none sm:border-b-2 sm:px-6 sm:py-4 sm:font-medium ${
                activeTab === 'leave'
                    ? 'bg-white text-primary-600 shadow-sm sm:border-primary-500 sm:bg-transparent sm:text-primary-600 sm:shadow-none'
                    : 'text-gray-500 hover:text-gray-700 sm:border-transparent sm:hover:border-gray-300'
              }`}
            >
              🏖️ Leave Requests
            </button>
            <button
              onClick={() => setActiveTab('shift')}
                className={`flex-1 rounded-lg px-4 py-3 text-sm font-semibold transition-colors sm:flex-none sm:rounded-none sm:border-b-2 sm:px-6 sm:py-4 sm:font-medium ${
                activeTab === 'shift'
                    ? 'bg-white text-primary-600 shadow-sm sm:border-primary-500 sm:bg-transparent sm:text-primary-600 sm:shadow-none'
                    : 'text-gray-500 hover:text-gray-700 sm:border-transparent sm:hover:border-gray-300'
              }`}
            >
              🔒 Shift Requests
            </button>
          </nav>
        </div>

          <div className="px-4 py-6 sm:px-6 sm:py-8">
          {/* Leave Requests Tab */}
          {activeTab === 'leave' && (
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">Request Leave</h3>
              <p className="text-gray-600 mb-6">Submit a request for time off or leave.</p>

              <form onSubmit={handleSubmitLeave} className="mb-8 space-y-6 rounded-xl border border-gray-200 bg-gray-50 px-4 py-6 sm:px-6">
                {editingLeaveId && (
                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                    Editing existing leave request.
                  </div>
                )}
                <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      From Date
                    </label>
                    <input
                      type="date"
                      value={leaveFromDate}
                      onChange={(e) => setLeaveFromDate(e.target.value)}
                      required
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      To Date
                    </label>
                    <input
                      type="date"
                      value={leaveToDate}
                      onChange={(e) => setLeaveToDate(e.target.value)}
                      required
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Leave Type
                    </label>
                    <select
                      value={leaveType}
                      onChange={(e) => setLeaveType(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500"
                    >
                      {leaveTypes.length > 0 ? (
                        leaveTypes.map((type) => (
                          <option key={type.id} value={type.code}>
                            {type.code} - {type.display_name}
                          </option>
                        ))
                      ) : (
                        <option value="DO">DO - Day Off</option>
                      )}
                    </select>
                  </div>

                  <div className="flex flex-col gap-2 md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Reason (Optional)
                    </label>
                    <textarea
                      value={leaveReason}
                      onChange={(e) => setLeaveReason(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500"
                      placeholder="Enter reason for leave..."
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-lg bg-primary-600 px-6 py-3 text-center text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {submitting ? 'Submitting...' : editingLeaveId ? 'Update Leave Request' : 'Submit Leave Request'}
                  </button>
                  {editingLeaveId && (
                    <button
                      type="button"
                      onClick={handleCancelLeaveEdit}
                      className="w-full rounded-lg border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-100 sm:w-auto"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>

              {/* Your Leave Requests */}
              {leaveRequests.length > 0 ? (
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Your Leave Requests</h3>
                  <div className="space-y-4 md:hidden">
                    {leaveRequests.map((req, index) => (
                      <div
                        key={index}
                        className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-gray-900">
                            {formatDate(req.from_date)} → {formatDate(req.to_date)}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              req.status === 'Pending'
                                ? 'bg-yellow-100 text-yellow-800'
                                : req.status === 'Approved'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {req.status}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1 text-sm text-gray-600">
                          <span className="font-medium text-gray-900">Type: <span className="font-normal text-gray-600">{req.leave_type}</span></span>
                          <span className="font-medium text-gray-900">
                            Reason:{' '}
                            <span className="font-normal text-gray-600">
                              {req.reason || '—'}
                            </span>
                          </span>
                          <span className="font-medium text-gray-900">
                            Submitted:{' '}
                            <span className="font-normal text-gray-600">{formatDateTime(req.submitted_at)}</span>
                          </span>
                        </div>
                        {req.status === 'Pending' && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEditLeave(req)}
                              className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteLeave(req.request_id)}
                              disabled={processingRequestId === req.request_id}
                              className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              {processingRequestId === req.request_id ? 'Removing...' : 'Delete'}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="hidden overflow-x-auto rounded-lg border border-gray-200 md:block">
                    <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                            From Date
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                            To Date
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                            Type
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                            Reason
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                            Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                            Submitted
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {leaveRequests.map((req, index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 border border-gray-300">
                              {formatDate(req.from_date)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 border border-gray-300">
                              {formatDate(req.to_date)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border border-gray-300">
                              {req.leave_type}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-500 border border-gray-300">
                              {req.reason || '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm border border-gray-300">
                              <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                req.status === 'Pending' ? 'bg-yellow-100 text-yellow-800' :
                                req.status === 'Approved' ? 'bg-green-100 text-green-800' :
                                'bg-red-100 text-red-800'
                              }`}>
                                {req.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border border-gray-300">
                              {formatDateTime(req.submitted_at)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border border-gray-300">
                              {req.status === 'Pending' ? (
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleEditLeave(req)}
                                    className="rounded-lg bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleDeleteLeave(req.request_id)}
                                    disabled={processingRequestId === req.request_id}
                                    className="rounded-lg bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                                  >
                                    {processingRequestId === req.request_id ? 'Removing...' : 'Delete'}
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-500">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
                  <p className="text-gray-600">No leave requests submitted yet.</p>
                </div>
              )}
            </div>
          )}

          {/* Shift Requests Tab */}
          {activeTab === 'shift' && (
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">Request Special Shift</h3>
              <p className="text-gray-600 mb-6">Submit a request for a specific shift assignment.</p>

              <form onSubmit={handleSubmitShift} className="mb-8 space-y-6 rounded-xl border border-gray-200 bg-gray-50 px-4 py-6 sm:px-6">
                {editingShiftId && (
                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                    Editing existing shift request.
                  </div>
                )}
                <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      From Date
                    </label>
                    <input
                      type="date"
                      value={shiftFromDate}
                      onChange={(e) => setShiftFromDate(e.target.value)}
                      required
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      To Date
                    </label>
                    <input
                      type="date"
                      value={shiftToDate}
                      onChange={(e) => setShiftToDate(e.target.value)}
                      required
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Shift Type
                    </label>
                    <select
                      value={shiftType}
                      onChange={(e) => setShiftType(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="M">M - Main</option>
                      <option value="IP">IP - Inpatient</option>
                      <option value="A">A - Afternoon</option>
                      <option value="N">N - Night</option>
                      <option value="M3">M3 - M3</option>
                      <option value="M4">M4 - M4</option>
                      <option value="H">H - Harat</option>
                      <option value="CL">CL - Clinic</option>
                      <option value="MS">MS - Medical Store</option>
                      <option value="C">C - Course</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Request Type
                    </label>
                    <select
                      value={requestType}
                      onChange={(e) => setRequestType(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="Force (Must)">Force (Must) - I must work this shift</option>
                      <option value="Forbid (Cannot)">Forbid (Cannot) - I cannot work this shift</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-2 md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Reason (Optional)
                    </label>
                    <textarea
                      value={shiftReason}
                      onChange={(e) => setShiftReason(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500"
                      placeholder="Enter reason for shift request..."
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-lg bg-primary-600 px-6 py-3 text-center text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {submitting ? 'Submitting...' : editingShiftId ? 'Update Shift Request' : 'Submit Shift Request'}
                  </button>
                  {editingShiftId && (
                    <button
                      type="button"
                      onClick={handleCancelShiftEdit}
                      className="w-full rounded-lg border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-100 sm:w-auto"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>

              {/* Your Shift Requests */}
              {shiftRequests.length > 0 ? (
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Your Shift Requests</h3>
                  <div className="space-y-4 md:hidden">
                    {shiftRequests.map((req, index) => (
                      <div
                        key={index}
                        className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-gray-900">
                            {formatDate(req.from_date)} → {formatDate(req.to_date || req.from_date)}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              req.status === 'Pending'
                                ? 'bg-yellow-100 text-yellow-800'
                                : req.status === 'Approved'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {req.status}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1 text-sm text-gray-600">
                          <span className="font-medium text-gray-900">
                            Shift:{' '}
                            <span className="font-normal text-gray-600">{req.shift}</span>
                          </span>
                          <span className="font-medium text-gray-900">
                            Type:{' '}
                            <span className="font-normal text-gray-600">{req.force ? 'Force' : 'Forbid'}</span>
                          </span>
                          <span className="font-medium text-gray-900">
                            Reason:{' '}
                            <span className="font-normal text-gray-600">
                              {req.reason || '—'}
                            </span>
                          </span>
                          <span className="font-medium text-gray-900">
                            Submitted:{' '}
                            <span className="font-normal text-gray-600">{formatDateTime(req.submitted_at)}</span>
                          </span>
                        </div>
                        {req.status === 'Pending' && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEditShiftRequest(req)}
                              className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteShift(req.request_id)}
                              disabled={processingRequestId === req.request_id}
                              className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              {processingRequestId === req.request_id ? 'Removing...' : 'Delete'}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="hidden overflow-x-auto rounded-lg border border-gray-200 md:block">
                    <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                            From Date
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                            To Date
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                            Shift
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                            Type
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                            Reason
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                            Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                            Submitted
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border border-gray-300">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {shiftRequests.map((req, index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 border border-gray-300">
                              {formatDate(req.from_date)}
                            </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 border border-gray-300">
                                  {formatDate(req.to_date || req.from_date)}
                                </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border border-gray-300">
                              {req.shift}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border border-gray-300">
                              {req.force ? 'Force' : 'Forbid'}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-500 border border-gray-300">
                              {req.reason || '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm border border-gray-300">
                              <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                req.status === 'Pending' ? 'bg-yellow-100 text-yellow-800' :
                                req.status === 'Approved' ? 'bg-green-100 text-green-800' :
                                'bg-red-100 text-red-800'
                              }`}>
                                {req.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border border-gray-300">
                              {formatDateTime(req.submitted_at)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border border-gray-300">
                              {req.status === 'Pending' ? (
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleEditShiftRequest(req)}
                                    className="rounded-lg bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleDeleteShift(req.request_id)}
                                    disabled={processingRequestId === req.request_id}
                                    className="rounded-lg bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                                  >
                                    {processingRequestId === req.request_id ? 'Removing...' : 'Delete'}
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-500">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
                  <p className="text-gray-600">No shift requests submitted yet.</p>
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

