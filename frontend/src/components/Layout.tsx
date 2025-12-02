import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAuthGuard } from '../hooks/useAuthGuard';
import { authAPI, requestsAPI } from '../services/api';
import { isTokenExpired } from '../utils/tokenUtils';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user, logout, loading: authLoading } = useAuth();
  // MAJOR RESTRUCTURE: Use auth guard to prevent API calls until auth is confirmed
  // This ensures we never make manager-only API calls unless user is confirmed Manager
  const { isReady: managerAuthReady, isManager } = useAuthGuard(true);
  const location = useLocation();
  const navigate = useNavigate();
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
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
    // MAJOR RESTRUCTURE: Only make API calls if auth guard confirms we're ready
    // This eliminates race conditions - we KNOW user is Manager if managerAuthReady is true
    if (!managerAuthReady || !isManager) {
      // Auth not ready or user not confirmed Manager - don't make any calls
      setPendingRequestCount(0);
      return;
    }

    // At this point, we're 100% certain:
    // 1. Auth is fully loaded
    // 2. User is authenticated
    // 3. User is confirmed to be a Manager
    // Safe to make manager-only API calls

    // Add debounce to prevent rapid-fire requests during navigation
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      const fetchPendingRequests = async () => {
        if (cancelled) return;
        
        // CRITICAL: Double-check token is still valid right before making the call
        const token = localStorage.getItem('access_token');
        if (!token || isTokenExpired(token)) {
          // Token expired between guard check and API call - skip
          if (!cancelled) setPendingRequestCount(0);
          return;
        }
        
        // DEBUG: Log guard state to help diagnose 403 errors
        const currentUser = user;
        if (currentUser) {
          console.log('[Layout] Making manager API calls with:', {
            authReady: managerAuthReady,
            isManager,
            userType: currentUser.employee_type,
            tokenValid: !isTokenExpired(token)
          });
        }
        
        try {
          const [leaveRes, shiftRes] = await Promise.all([
            requestsAPI.getAllLeaveRequests(),
            requestsAPI.getAllShiftRequests(),
          ]);

          if (cancelled) return;

          const leavePending = leaveRes.filter((req: any) => req.status === 'Pending').length;
          const shiftPending = shiftRes.filter((req: any) => req.status === 'Pending').length;
          setPendingRequestCount(leavePending + shiftPending);
        } catch (error: any) {
          if (cancelled) return;
          
          // If we get 403/401 here, something is seriously wrong (auth guard should prevent this)
          // Log it for debugging but don't spam console
          if (error.response?.status === 403 || error.response?.status === 401) {
            console.warn('⚠️ Unexpected auth error in Layout - auth guard should have prevented this');
            setPendingRequestCount(0);
            return;
          }
          
          // Log other errors
          console.error('Failed to fetch pending requests:', error);
          setPendingRequestCount(0);
        }
      };

      fetchPendingRequests();
    }, 300); // 300ms debounce to batch rapid navigations

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [managerAuthReady, isManager, location.pathname]);

  useEffect(() => {
    // Close mobile nav on route change
    setIsMobileNavOpen(false);
  }, [location.pathname]);

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
        { name: 'Rules Management', path: '/rules' },
      ]
    : [
        { name: 'Roster Requests', path: '/requests' },
        { name: 'Monthly Roster', path: '/schedule' },
        { name: 'Reports & Visualization', path: '/reports' },
      ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <button
                className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white p-2 text-gray-600 shadow-sm transition hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:hidden flex-shrink-0"
                onClick={() => setIsMobileNavOpen(true)}
                aria-label="Open navigation menu"
              >
                <span className="text-lg">☰</span>
              </button>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 whitespace-nowrap">📅 Staff Rostering System</h1>
            </div>
            <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0">
              <span className="hidden text-sm text-gray-600 sm:inline">
                Welcome, {user?.employee_name}
              </span>
              <button
                onClick={handleLogout}
                className="rounded-lg px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-col md:flex-row">
        {/* Sidebar */}
        <aside className="hidden min-h-screen w-64 bg-white shadow-sm md:block">
          <nav className="space-y-2 p-4">
            {navigation.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setShowPasswordForm(false)}
                className={`flex items-center justify-between rounded-lg px-4 py-2 transition-colors ${
                  location.pathname === item.path
                    ? 'bg-primary-100 font-medium text-primary-700'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span>{item.name}</span>
                {item.path === '/users' && pendingRequestCount > 0 && (
                  <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-red-600 px-2 text-xs font-semibold text-white">
                    {pendingRequestCount}
                  </span>
                )}
              </Link>
            ))}
            {user && (
              <div className="mt-4 border-t border-gray-200 pt-4">
                <button
                  onClick={() => setShowPasswordForm(!showPasswordForm)}
                  className="w-full rounded-lg px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  Change Password
                </button>
              </div>
            )}
          </nav>

          {user && showPasswordForm && (
            <div className="border-t border-gray-200 p-4">
              <form onSubmit={handlePasswordChange} className="space-y-3">
                <input
                  type="password"
                  placeholder="Current Password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <input
                  type="password"
                  placeholder="New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <input
                  type="password"
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <div className="flex space-x-2">
                  <button
                    type="submit"
                    className="flex-1 rounded-lg bg-primary-600 px-3 py-2 text-sm text-white hover:bg-primary-700"
                  >
                    Update
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPasswordForm(false)}
                    className="flex-1 rounded-lg bg-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}
        </aside>

        {/* Mobile navigation drawer */}
        {isMobileNavOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="h-full w-72 max-w-full overflow-y-auto bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
                <span className="text-base font-semibold text-gray-900">Menu</span>
                <button
                  onClick={() => setIsMobileNavOpen(false)}
                  className="rounded-full p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Close navigation menu"
                >
                  ✕
                </button>
              </div>
              <nav className="space-y-2 p-4">
                {navigation.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => {
                      setShowPasswordForm(false);
                      setIsMobileNavOpen(false);
                    }}
                    className={`flex items-center justify-between rounded-lg px-4 py-2 text-sm transition-colors ${
                      location.pathname === item.path
                        ? 'bg-primary-100 font-medium text-primary-700'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span>{item.name}</span>
                    {item.path === '/users' && pendingRequestCount > 0 && (
                      <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-red-600 px-2 text-xs font-semibold text-white">
                        {pendingRequestCount}
                      </span>
                    )}
                  </Link>
                ))}
              </nav>
              {user && (
                <div className="border-t border-gray-200 p-4">
                  <button
                    onClick={() => setShowPasswordForm((prev) => !prev)}
                    className="w-full rounded-lg px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Change Password
                  </button>
                  {showPasswordForm && (
                    <form onSubmit={handlePasswordChange} className="mt-4 space-y-3">
                      <input
                        type="password"
                        placeholder="Current Password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                      <input
                        type="password"
                        placeholder="New Password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                      <input
                        type="password"
                        placeholder="Confirm Password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                      <div className="flex space-x-2">
                        <button
                          type="submit"
                          className="flex-1 rounded-lg bg-primary-600 px-3 py-2 text-sm text-white hover:bg-primary-700"
                        >
                          Update
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowPasswordForm(false);
                            setIsMobileNavOpen(false);
                          }}
                          className="flex-1 rounded-lg bg-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
            <div
              className="flex-1 bg-black/30"
              onClick={() => {
                setIsMobileNavOpen(false);
                setShowPasswordForm(false);
              }}
            />
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 p-4 sm:p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
};

