import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { requestsAPI } from '../services/api';

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
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Form states for leave request
  const [leaveFromDate, setLeaveFromDate] = useState('');
  const [leaveToDate, setLeaveToDate] = useState('');
  const [leaveType, setLeaveType] = useState('DO');
  const [leaveReason, setLeaveReason] = useState('');

  // Form states for shift request
  const [shiftFromDate, setShiftFromDate] = useState('');
  const [shiftToDate, setShiftToDate] = useState('');
  const [shiftType, setShiftType] = useState('M');
  const [requestType, setRequestType] = useState('Force (Must)');
  const [shiftReason, setShiftReason] = useState('');

  useEffect(() => {
    loadRequests();
    // Set default dates to today
    const today = new Date().toISOString().split('T')[0];
    setLeaveFromDate(today);
    setLeaveToDate(today);
    setShiftFromDate(today);
    setShiftToDate(today);
  }, []);

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

  const handleSubmitLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (new Date(leaveFromDate) > new Date(leaveToDate)) {
      alert('From date cannot be after to date');
      return;
    }

    try {
      setSubmitting(true);
      await requestsAPI.createLeaveRequest({
        from_date: leaveFromDate,
        to_date: leaveToDate,
        leave_type: leaveType,
        reason: leaveReason,
      });
      
      // Reset form
      const today = new Date().toISOString().split('T')[0];
      setLeaveFromDate(today);
      setLeaveToDate(today);
      setLeaveType('DO');
      setLeaveReason('');
      
      // Reload requests
      await loadRequests();
      setNotification({ message: '✅ Leave request submitted successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } catch (error: any) {
      setNotification({
        message: error.response?.data?.detail || 'Failed to submit leave request',
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
      await requestsAPI.createShiftRequest({
        from_date: shiftFromDate,
        to_date: shiftToDate,
        shift: shiftType,
        request_type: requestType,
        reason: shiftReason,
      });
      
      // Reset form
      const today = new Date().toISOString().split('T')[0];
      setShiftFromDate(today);
      setShiftToDate(today);
      setShiftType('M');
      setRequestType('Force (Must)');
      setShiftReason('');
      
      // Reload requests
      await loadRequests();
      setNotification({ message: '✅ Shift request submitted successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } catch (error: any) {
      setNotification({
        message: error.response?.data?.detail || 'Failed to submit shift request',
        type: 'error',
      });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setSubmitting(false);
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
      <h2 className="text-3xl font-bold text-gray-900 mb-6">Roster Requests</h2>

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

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            <button
              onClick={() => setActiveTab('leave')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'leave'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              🏖️ Leave Requests
            </button>
            <button
              onClick={() => setActiveTab('shift')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'shift'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              🔒 Shift Requests
            </button>
          </nav>
        </div>

        <div className="p-6">
          {/* Leave Requests Tab */}
          {activeTab === 'leave' && (
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">Request Leave</h3>
              <p className="text-gray-600 mb-6">Submit a request for time off or leave.</p>

              <form onSubmit={handleSubmitLeave} className="bg-gray-50 rounded-lg p-6 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      From Date
                    </label>
                    <input
                      type="date"
                      value={leaveFromDate}
                      onChange={(e) => setLeaveFromDate(e.target.value)}
                      required
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      To Date
                    </label>
                    <input
                      type="date"
                      value={leaveToDate}
                      onChange={(e) => setLeaveToDate(e.target.value)}
                      required
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Leave Type
                    </label>
                    <select
                      value={leaveType}
                      onChange={(e) => setLeaveType(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="DO">DO - Day Off</option>
                      <option value="ML">ML - Maternity Leave</option>
                      <option value="W">W - Workshop</option>
                      <option value="UL">UL - Unpaid Leave</option>
                      <option value="STL">STL - Study Leave</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Reason (Optional)
                    </label>
                    <textarea
                      value={leaveReason}
                      onChange={(e) => setLeaveReason(e.target.value)}
                      rows={3}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="Enter reason for leave..."
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full md:w-auto px-6 py-3 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Submitting...' : 'Submit Leave Request'}
                </button>
              </form>

              {/* Your Leave Requests */}
              {leaveRequests.length > 0 ? (
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Your Leave Requests</h3>
                  <div className="overflow-x-auto">
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

              <form onSubmit={handleSubmitShift} className="bg-gray-50 rounded-lg p-6 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      From Date
                    </label>
                    <input
                      type="date"
                      value={shiftFromDate}
                      onChange={(e) => setShiftFromDate(e.target.value)}
                      required
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      To Date
                    </label>
                    <input
                      type="date"
                      value={shiftToDate}
                      onChange={(e) => setShiftToDate(e.target.value)}
                      required
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Shift Type
                    </label>
                    <select
                      value={shiftType}
                      onChange={(e) => setShiftType(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
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

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Request Type
                    </label>
                    <select
                      value={requestType}
                      onChange={(e) => setRequestType(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="Force (Must)">Force (Must) - I must work this shift</option>
                      <option value="Forbid (Cannot)">Forbid (Cannot) - I cannot work this shift</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Reason (Optional)
                    </label>
                    <textarea
                      value={shiftReason}
                      onChange={(e) => setShiftReason(e.target.value)}
                      rows={3}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="Enter reason for shift request..."
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full md:w-auto px-6 py-3 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Submitting...' : 'Submit Shift Request'}
                </button>
              </form>

              {/* Your Shift Requests */}
              {shiftRequests.length > 0 ? (
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Your Shift Requests</h3>
                  <div className="overflow-x-auto">
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
  );
};

