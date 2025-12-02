import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { User, authAPI } from '../services/api';
import { isTokenExpired, getTimeUntilExpiration } from '../utils/tokenUtils';
import { forceTokenRefresh, clearRefreshState } from '../services/tokenRefreshManager';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Function to refresh token proactively
  // Uses centralized token refresh manager to prevent race conditions
  const refreshTokenIfNeeded = async () => {
    const accessToken = localStorage.getItem('access_token');
    const refreshToken = localStorage.getItem('refresh_token');
    
    if (!accessToken || !refreshToken) {
      return;
    }
    
    // Check if access token is expired or will expire soon
    if (isTokenExpired(accessToken)) {
      try {
        // Use centralized token refresh manager
        // This ensures no race conditions with API interceptor
        const newToken = await forceTokenRefresh();
        
        // Update user from localStorage (token refresh manager already updated it)
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          try {
            setUser(JSON.parse(storedUser));
          } catch (e) {
            // If user parsing fails, fetch from API
            const currentUser = await authAPI.getCurrentUser();
            setUser(currentUser);
          }
        }
        
        // Schedule next refresh
        scheduleTokenRefresh(newToken);
      } catch (error) {
        // Refresh failed - tokens already cleared by token refresh manager
        setUser(null);
      }
    } else {
      // Token is still valid, schedule refresh before expiration
      scheduleTokenRefresh(accessToken);
    }
  };

  // Schedule token refresh before expiration
  // Production standard: Refresh access tokens proactively (5 minutes before expiration)
  const scheduleTokenRefresh = (token: string) => {
    // Clear existing timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    
    const timeUntilExpiration = getTimeUntilExpiration(token);
    // Refresh 5 minutes before expiration (or immediately if less than 5 min)
    // For 30-minute tokens, this means refreshing after 25 minutes
    const refreshTime = Math.max(0, timeUntilExpiration - 5 * 60 * 1000);
    
    if (refreshTime > 0) {
      refreshTimerRef.current = setTimeout(() => {
        refreshTokenIfNeeded();
      }, refreshTime);
    } else {
      // Token expires soon, refresh immediately
      refreshTokenIfNeeded();
    }
  };

  useEffect(() => {
    // Check for stored token and user
    const token = localStorage.getItem('access_token');
    const refreshToken = localStorage.getItem('refresh_token');
    const storedUser = localStorage.getItem('user');

    if (token && storedUser) {
      // CRITICAL: Don't set user from localStorage until token is verified
      // This prevents race conditions where components think they're authenticated
      // but the token is actually invalid
      
      // MIGRATION: If user has token but no refresh token, they logged in before refresh tokens were added
      // They need to login again to get refresh tokens
      if (!refreshToken) {
        console.warn('⚠️ No refresh token found. Please login again to get refresh tokens for automatic token renewal.');
        // Clear old token - user needs to login again
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
        setUser(null);
        setLoading(false);
        return;
      }
      
      // First, try to refresh if token is expired
      // CRITICAL: Also refresh if token is old (7-day tokens need to be refreshed to get 30-min tokens)
      const tokenAge = getTimeUntilExpiration(token);
      const isOldToken = tokenAge > 7 * 24 * 60 * 60 * 1000; // More than 7 days = old token format
      
      if ((isTokenExpired(token) || isOldToken) && refreshToken) {
        // Token expired or is old format, try to refresh
        console.log('🔄 Refreshing token (expired or old format)...');
        forceTokenRefresh()
          .then((newToken) => {
            console.log('✅ Token refreshed successfully');
            // Token refresh manager already updated localStorage
            const storedUser = localStorage.getItem('user');
            if (storedUser) {
              try {
                setUser(JSON.parse(storedUser));
              } catch (e) {
                // If parsing fails, fetch from API
                return authAPI.getCurrentUser()
                  .then((currentUser) => {
                    setUser(currentUser);
                    localStorage.setItem('user', JSON.stringify(currentUser));
                  });
              }
            }
            scheduleTokenRefresh(newToken);
          })
          .catch(() => {
            // Refresh failed, try to verify current token anyway
            return authAPI.getCurrentUser()
              .then((currentUser) => {
                setUser(currentUser);
                localStorage.setItem('user', JSON.stringify(currentUser));
                scheduleTokenRefresh(token);
              })
              .catch(() => {
                // Both failed, clear storage
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
                localStorage.removeItem('user');
                setUser(null);
              });
          })
          .finally(() => setLoading(false));
      } else {
        // Token is valid, but check if it's an old 7-day token
        // If so, refresh it to get a new 30-minute token
        const tokenAge = getTimeUntilExpiration(token);
        const isOldToken = tokenAge > 7 * 24 * 60 * 60 * 1000; // More than 7 days = old token format
        
        if (isOldToken && refreshToken) {
          // Old token format - refresh to get new 30-minute token
          console.log('🔄 Refreshing old 7-day token to get new 30-minute token...');
          forceTokenRefresh()
            .then((newToken) => {
              console.log('✅ Token refreshed from old format');
              // Token refresh manager already updated localStorage
              const storedUser = localStorage.getItem('user');
              if (storedUser) {
                try {
                  setUser(JSON.parse(storedUser));
                } catch (e) {
                  // If parsing fails, fetch from API
                  return authAPI.getCurrentUser()
                    .then((currentUser) => {
                      setUser(currentUser);
                      localStorage.setItem('user', JSON.stringify(currentUser));
                    });
                }
              }
              scheduleTokenRefresh(newToken);
            })
            .catch(() => {
              // Refresh failed, try to verify current token anyway
              return authAPI.getCurrentUser()
                .then((currentUser) => {
                  setUser(currentUser);
                  localStorage.setItem('user', JSON.stringify(currentUser));
                  scheduleTokenRefresh(token);
                })
                .catch(() => {
                  // Both failed, clear storage
                  localStorage.removeItem('access_token');
                  localStorage.removeItem('refresh_token');
                  localStorage.removeItem('user');
                  setUser(null);
                });
            })
            .finally(() => setLoading(false));
          return;
        }
        
        // Token is valid and new format, verify it
        authAPI.getCurrentUser()
          .then((currentUser) => {
            // Only set user after successful verification
            console.log('✅ Token verified, user:', currentUser);
            setUser(currentUser);
            localStorage.setItem('user', JSON.stringify(currentUser));
            scheduleTokenRefresh(token);
          })
          .catch(() => {
            // Token invalid, try refresh if available
            if (refreshToken) {
              return forceTokenRefresh()
                .then((newToken) => {
                  // Token refresh manager already updated localStorage
                  const storedUser = localStorage.getItem('user');
                  if (storedUser) {
                    try {
                      setUser(JSON.parse(storedUser));
                    } catch (e) {
                      // If parsing fails, fetch from API
                      return authAPI.getCurrentUser()
                        .then((currentUser) => {
                          setUser(currentUser);
                          localStorage.setItem('user', JSON.stringify(currentUser));
                        });
                    }
                  }
                  scheduleTokenRefresh(newToken);
                })
                .catch(() => {
                  // Refresh also failed, clear storage
                  localStorage.removeItem('access_token');
                  localStorage.removeItem('refresh_token');
                  localStorage.removeItem('user');
                  setUser(null);
                });
            } else {
              // No refresh token, clear storage
              localStorage.removeItem('access_token');
              localStorage.removeItem('user');
              setUser(null);
            }
          })
          .finally(() => setLoading(false));
      }
    } else {
      // No token, user is definitely not authenticated
      setUser(null);
      setLoading(false);
    }
    
    // Cleanup timer on unmount
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const login = async (username: string, password: string, rememberMe = false) => {
    const response = await authAPI.login({ username, password, remember_me: rememberMe });
    localStorage.setItem('access_token', response.access_token);
    localStorage.setItem('refresh_token', response.refresh_token);
    localStorage.setItem('user', JSON.stringify(response.user));
    setUser(response.user);
    // Schedule automatic token refresh
    scheduleTokenRefresh(response.access_token);
  };

  const logout = async () => {
    // Clear refresh timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    
    // Clear centralized refresh state
    clearRefreshState();
    
    // CRITICAL: Always clear tokens locally first, even if API call fails
    // This ensures logout works even with invalid/expired tokens
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    setUser(null);
    
    // Try to revoke token on server (best effort - don't block logout)
    try {
      await authAPI.logout();
    } catch (error: any) {
      // Continue with logout even if API call fails
      // This handles cases where:
      // - Token is expired/invalid
      // - Network errors
      // - 403/401 errors (old tokens)
      console.warn('Logout API call failed (continuing with local logout):', error?.response?.status || error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

