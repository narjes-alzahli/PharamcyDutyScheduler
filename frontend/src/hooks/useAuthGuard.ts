/**
 * Auth Guard Hook - Prevents API calls until authentication is fully confirmed
 * This is a MAJOR restructure to prevent race conditions and unnecessary API calls
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { isTokenExpired } from '../utils/tokenUtils';

interface AuthGuardResult {
  isReady: boolean;
  isAuthenticated: boolean;
  isManager: boolean;
  user: any;
}

/**
 * Hook that ensures auth is fully loaded and user is confirmed before allowing API calls
 * This prevents race conditions where components make calls before auth is ready
 * 
 * CRITICAL: Also verifies token is still valid before allowing API calls
 */
export function useAuthGuard(requireManager: boolean = false): AuthGuardResult {
  const { user, loading, isAuthenticated } = useAuth();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Wait for auth to finish loading
    if (loading) {
      setIsReady(false);
      return;
    }

    // Auth is loaded, now check requirements
    if (!isAuthenticated || !user) {
      setIsReady(false);
      return;
    }

    // CRITICAL: Verify token is still valid before allowing API calls
    // Even if user is set, token might have expired
    const token = localStorage.getItem('access_token');
    if (!token || isTokenExpired(token)) {
      // Token missing or expired - not ready
      setIsReady(false);
      return;
    }

    // If manager is required, verify user is actually a Manager
    if (requireManager) {
      // CRITICAL: Use strict equality and verify from verified auth state
      // Don't trust localStorage - trust the verified user object from AuthContext
      const isManager = user.employee_type === 'Manager';
      setIsReady(isManager);
      return;
    }

    // Auth is ready and requirements met
    setIsReady(true);
  }, [loading, isAuthenticated, user, requireManager]);

  return {
    isReady,
    isAuthenticated: isAuthenticated && !!user,
    isManager: user?.employee_type === 'Manager' || false,
    user: isReady ? user : null,
  };
}

