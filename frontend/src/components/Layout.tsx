import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authAPI, requestsAPI } from '../services/api';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pendingRequestCount, setPendingRequestCount] = useState(0);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      alert('New passwords do not match');
      return;
    }
    try {
      await authAPI.changePassword(currentPassword, newPassword);
      alert('Password updated successfully!');
      setShowPasswordForm(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      alert(error.response?.data?.detail || 'Failed to change password');
    }
  };

  useEffect(() => {
    const fetchPendingRequests = async () => {
      if (user?.employee_type !== 'Manager') {
        setPendingRequestCount(0);
        return;
      }

      try {
        const [leaveRes, shiftRes] = await Promise.all([
          requestsAPI.getAllLeaveRequests(),
          requestsAPI.getAllShiftRequests(),
        ]);

        const leavePending = leaveRes.filter((req: any) => req.status === 'Pending').length;
        const shiftPending = shiftRes.filter((req: any) => req.status === 'Pending').length;
        setPendingRequestCount(leavePending + shiftPending);
      } catch (error) {
        console.error('Failed to fetch pending requests:', error);
      }
    };

    fetchPendingRequests();
  }, [user, location.pathname]);

  useEffect(() => {
    const handlePendingRequestsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ count: number }>;
      if (typeof customEvent.detail?.count === 'number') {
        setPendingRequestCount(customEvent.detail.count);
      }
    };

    window.addEventListener('pendingRequestsUpdated', handlePendingRequestsUpdated as EventListener);
    return () => {
      window.removeEventListener('pendingRequestsUpdated', handlePendingRequestsUpdated as EventListener);
    };
  }, []);

  const navigation = user?.employee_type === 'Manager'
    ? [
        { name: 'Roster Generator', path: '/generator' },
        { name: 'Monthly Roster', path: '/schedule' },
        { name: 'Reports & Visualization', path: '/reports' },
        { name: 'User Management', path: '/users' },
      ]
    : [
        { name: 'Roster Requests', path: '/requests' },
        { name: 'Monthly Roster', path: '/schedule' },
        { name: 'Reports & Visualization', path: '/reports' },
      ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">📅 Staff Rostering System</h1>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">
                Welcome, {user?.employee_name}
              </span>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 bg-white shadow-sm min-h-screen">
          <nav className="p-4 space-y-2">
            {navigation.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center justify-between px-4 py-2 rounded-lg transition-colors ${
                  location.pathname === item.path
                    ? 'bg-primary-100 text-primary-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span>{item.name}</span>
                {item.path === '/users' && pendingRequestCount > 0 && (
                  <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-2 text-xs font-semibold text-white bg-red-600 rounded-full">
                    {pendingRequestCount}
                  </span>
                )}
              </Link>
            ))}
            {user?.employee_type === 'Manager' && (
              <div className="pt-4 border-t border-gray-200 mt-4">
                <button
                  onClick={() => setShowPasswordForm(!showPasswordForm)}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Change Password
                </button>
              </div>
            )}
          </nav>

          {user?.employee_type === 'Manager' && showPasswordForm && (
            <div className="p-4 border-t border-gray-200">
              <form onSubmit={handlePasswordChange} className="space-y-3">
                <input
                  type="password"
                  placeholder="Current Password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
                <input
                  type="password"
                  placeholder="New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
                <input
                  type="password"
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
                <div className="flex space-x-2">
                  <button
                    type="submit"
                    className="flex-1 px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                  >
                    Update
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPasswordForm(false)}
                    className="flex-1 px-3 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-8">
          {children}
        </main>
      </div>
    </div>
  );
};

