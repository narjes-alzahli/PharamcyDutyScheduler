/**
 * Token utility functions for JWT token management
 */

/**
 * Decode JWT token without verification (to check expiration)
 */
export function decodeToken(token: string): any | null {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    return null;
  }
}

/**
 * Check if a token is expired
 */
export function isTokenExpired(token: string): boolean {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) {
    return true; // If we can't decode it, consider it expired
  }
  
  const expirationTime = decoded.exp * 1000; // Convert to milliseconds
  const currentTime = Date.now();
  const bufferTime = 5 * 60 * 1000; // 5 minutes buffer before expiration
  
  return currentTime >= (expirationTime - bufferTime);
}

/**
 * Get time until token expires (in milliseconds)
 */
export function getTimeUntilExpiration(token: string): number {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) {
    return 0;
  }
  
  const expirationTime = decoded.exp * 1000;
  const currentTime = Date.now();
  return Math.max(0, expirationTime - currentTime);
}

