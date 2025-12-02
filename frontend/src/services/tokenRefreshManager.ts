/**
 * Centralized Token Refresh Manager
 * 
 * This module provides a single source of truth for token refresh operations.
 * It coordinates between AuthContext and API interceptors to prevent race conditions
 * and ensure tokens are refreshed exactly once, even when multiple components
 * request refresh simultaneously.
 */

import { authAPI } from './api';
import { isTokenExpired } from '../utils/tokenUtils';

// Global state for token refresh coordination
let isRefreshing = false;
let refreshPromise: Promise<string> | null = null;
let refreshSubscribers: Array<{
  resolve: (token: string) => void;
  reject: (error: any) => void;
}> = [];

/**
 * Notify all subscribers that token refresh completed
 */
const notifySubscribers = (token: string | null, error: any = null) => {
  refreshSubscribers.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error);
    } else if (token) {
      resolve(token);
    }
  });
  refreshSubscribers = [];
};

/**
 * Refresh the access token using the refresh token
 * This is the ONLY place where token refresh should happen
 */
const performTokenRefresh = async (): Promise<string> => {
  const refreshToken = localStorage.getItem('refresh_token');
  
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  try {
    const response = await authAPI.refreshToken(refreshToken);
    
    // Update tokens in storage
    localStorage.setItem('access_token', response.access_token);
    localStorage.setItem('refresh_token', response.refresh_token);
    localStorage.setItem('user', JSON.stringify(response.user));
    
    return response.access_token;
  } catch (error) {
    // Refresh failed - clear all tokens
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    throw error;
  }
};

/**
 * Get a valid access token, refreshing if necessary
 * 
 * This function ensures that:
 * 1. Only one refresh happens at a time (even if called from multiple places)
 * 2. All concurrent callers wait for the same refresh to complete
 * 3. Expired tokens are refreshed before being returned
 * 
 * @returns Promise<string> - A valid access token
 */
export const getValidAccessToken = async (): Promise<string> => {
  const accessToken = localStorage.getItem('access_token');
  const refreshToken = localStorage.getItem('refresh_token');
  
  // No tokens at all - user needs to login
  if (!accessToken || !refreshToken) {
    throw new Error('No authentication tokens available');
  }
  
  // Token is still valid - return it immediately
  if (!isTokenExpired(accessToken)) {
    return accessToken;
  }
  
  // Token is expired - need to refresh
  // If we're already refreshing, wait for that refresh to complete
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }
  
  // Start a new refresh
  isRefreshing = true;
  refreshPromise = performTokenRefresh()
    .then((newToken) => {
      isRefreshing = false;
      refreshPromise = null;
      notifySubscribers(newToken, null);
      return newToken;
    })
    .catch((error) => {
      isRefreshing = false;
      refreshPromise = null;
      notifySubscribers(null, error);
      throw error;
    });
  
  return refreshPromise;
};

/**
 * Force a token refresh (used by AuthContext for proactive refresh)
 * 
 * @returns Promise<string> - The new access token
 */
export const forceTokenRefresh = async (): Promise<string> => {
  // If already refreshing, wait for that
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }
  
  // Start a new refresh
  isRefreshing = true;
  refreshPromise = performTokenRefresh()
    .then((newToken) => {
      isRefreshing = false;
      refreshPromise = null;
      notifySubscribers(newToken, null);
      return newToken;
    })
    .catch((error) => {
      isRefreshing = false;
      refreshPromise = null;
      notifySubscribers(null, error);
      throw error;
    });
  
  return refreshPromise;
};

/**
 * Check if a token refresh is currently in progress
 */
export const isTokenRefreshInProgress = (): boolean => {
  return isRefreshing;
};

/**
 * Clear refresh state (used for cleanup/logout)
 */
export const clearRefreshState = (): void => {
  isRefreshing = false;
  refreshPromise = null;
  notifySubscribers(null, new Error('Token refresh cancelled'));
};

