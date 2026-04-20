import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { isTokenExpired } from '../utils/tokenUtils';
import { getValidAccessToken, clearRefreshState } from './tokenRefreshManager';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use(
  async (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      // If token is expired, refresh it before making the request
      // This prevents sending expired tokens and getting 401/403 errors
      if (isTokenExpired(token)) {
        try {
          const validToken = await getValidAccessToken();
          config.headers.Authorization = `Bearer ${validToken}`;
        } catch (error) {
          // Refresh failed - let the request proceed and response interceptor will handle it
          config.headers.Authorization = `Bearer ${token}`;
        }
      } else {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle auth errors and automatic token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    
    // Skip auth endpoints - don't try to refresh on these
    const isLoginRequest = originalRequest?.url?.includes('/auth/login');
    const isRefreshRequest = originalRequest?.url?.includes('/auth/refresh');
    const isAuthMeRequest = originalRequest?.url?.includes('/auth/me');
    const isOnLoginPage = window.location.pathname === '/login';
    
    // Handle only 401 Unauthorized as an auth-expiry signal.
    // In this app, 403 is commonly used for role-based access control
    // (e.g. staff calling manager-only endpoints) and should not clear tokens.
    const isAuthError = error.response?.status === 401;
    
    if (isAuthError && originalRequest && !isLoginRequest && !isRefreshRequest && !isAuthMeRequest) {
      // Don't retry if we've already tried once
      if (originalRequest._retry) {
        // Already retried - clear tokens and redirect
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        clearRefreshState();
        
        if (!isOnLoginPage) {
          const shouldRedirect = sessionStorage.getItem('auth_redirect') !== 'blocked';
          if (shouldRedirect) {
            sessionStorage.setItem('auth_redirect', 'blocked');
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
      
      // Mark request as retried
      originalRequest._retry = true;
      
      try {
        // Use centralized token refresh manager
        // This will either:
        // 1. Return immediately if token is valid
        // 2. Wait for an in-progress refresh
        // 3. Start a new refresh if needed
        const newToken = await getValidAccessToken();
        
        // Update the original request with new token
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
        }
        
        // Retry the original request with the new token
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed - clear tokens and redirect to login
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        clearRefreshState();
        
        if (!isOnLoginPage) {
          const shouldRedirect = sessionStorage.getItem('auth_redirect') !== 'blocked';
          if (shouldRedirect) {
            sessionStorage.setItem('auth_redirect', 'blocked');
            window.location.href = '/login';
          }
        }
        
        return Promise.reject(refreshError);
      }
    }
    
    // For auth endpoint failures, handle specially
    if ((isLoginRequest || isRefreshRequest) && error.response?.status === 401) {
      if (!isOnLoginPage) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        clearRefreshState();
        const shouldRedirect = sessionStorage.getItem('auth_redirect') !== 'blocked';
        if (shouldRedirect) {
          sessionStorage.setItem('auth_redirect', 'blocked');
          window.location.href = '/login';
        }
      }
    }
    
    // Reset redirect flag on successful requests
    if (isLoginRequest && error.response?.status !== 401) {
      sessionStorage.removeItem('auth_redirect');
    }
    
    // For 403 errors (e.g. non-manager hitting manager-only endpoint), just reject.
    return Promise.reject(error);
  }
);

export interface User {
  username: string;
  employee_name: string;
  employee_type: 'Manager' | 'Staff';
  staff_no?: string | null;
  start_date?: string | null;
}

export interface LoginRequest {
  username: string;
  password: string;
  remember_me?: boolean;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

export const authAPI = {
  login: async (credentials: LoginRequest): Promise<LoginResponse> => {
    const response = await api.post<LoginResponse>('/api/auth/login', credentials);
    return response.data;
  },
  logout: async (): Promise<void> => {
    await api.post('/api/auth/logout');
  },
  getCurrentUser: async (): Promise<User> => {
    const response = await api.get<User>('/api/auth/me');
    return response.data;
  },
  refreshToken: async (refreshToken: string): Promise<RefreshTokenResponse> => {
    // Use a separate axios instance without interceptors to avoid infinite loops
    const refreshApi = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const response = await refreshApi.post<RefreshTokenResponse>('/api/auth/refresh', {
      refresh_token: refreshToken,
    });
    return response.data;
  },
  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    await api.post('/api/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
  },
};

export interface Employee {
  employee: string;
  skills: string;
  min_days_off: number;
}

export interface Demand {
  date: string;
  need_M: number;
  need_IP: number;
  need_A: number;
  need_N: number;
  need_M3: number;
  need_M4: number;
  need_H: number;
  need_CL: number;
  need_E: number;
  need_MS: number;
  need_IP_P: number;
  need_P: number;
  need_M_P: number;
}

export interface TimeOffEntry {
  employee: string;
  from_date: string;
  to_date: string;
  code: string;
  request_id?: string;  // If provided, update this specific request; if undefined, always create new
}

export interface LockEntry {
  employee: string;
  from_date: string;
  to_date: string;
  shift: string;
  force: boolean;
}

export interface RamadanDateRecord {
  year: number;
  start_date: string | null;
  end_date: string | null;
  source: string | null;
}

export const dataAPI = {
  getEmployees: async (): Promise<Employee[]> => {
    const response = await api.get<Employee[]>('/api/data/employees');
    return response.data;
  },
  updateEmployees: async (employees: any[]): Promise<void> => {
    await api.put('/api/data/employees', employees);
  },
  deleteEmployee: async (employeeName: string): Promise<void> => {
    await api.delete(`/api/data/employees/${encodeURIComponent(employeeName)}`);
  },
  getDemands: async (year?: number, month?: number): Promise<Demand[]> => {
    const params = year && month ? { year, month } : {};
    const response = await api.get<Demand[]>('/api/data/demands', { params });
    return response.data;
  },
  getRosterData: async () => {
    const response = await api.get('/api/data/roster-data');
    return response.data;
  },
  updateTimeOff: async (timeOff: TimeOffEntry[]): Promise<any> => {
    const response = await api.put('/api/data/time-off', timeOff);
    return response.data; // Returns {message, created, created_leave_requests, created_shift_requests}
  },
  updateLocks: async (locks: LockEntry[]): Promise<any> => {
    const response = await api.put('/api/data/locks', locks);
    return response.data; // Returns {message, created, created_requests}
  },
  getRamadanDates: async (year: number): Promise<RamadanDateRecord> => {
    const response = await api.get<RamadanDateRecord>(`/api/data/ramadan-dates/${year}`);
    return response.data;
  },
  listRamadanDates: async (): Promise<RamadanDateRecord[]> => {
    const response = await api.get<RamadanDateRecord[]>('/api/data/ramadan-dates');
    return response.data;
  },
  saveRamadanDates: async (
    year: number,
    payload: { year: number; start_date: string; end_date: string; source?: string }
  ): Promise<RamadanDateRecord> => {
    const response = await api.put<RamadanDateRecord>(`/api/data/ramadan-dates/${year}`, payload);
    return response.data;
  },
  deleteRamadanDates: async (year: number): Promise<void> => {
    await api.delete(`/api/data/ramadan-dates/${year}`);
  },
};

export interface SolveRequest {
  year: number;
  month: number;
  time_limit?: number;
  unfilled_penalty?: number;
  fairness_weight?: number;
  start_date?: string; // Optional: YYYY-MM-DD format for custom date range
  end_date?: string; // Optional: YYYY-MM-DD format for custom date range
}

export interface SolveResponse {
  job_id: string;
  status: string;
  message: string;
}

export interface JobStatus {
  job_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  result?: {
    schedule: any[];
    employees?: any[];
    metrics: any;
  };
  error?: string;
  issues?: string[];  // List of sanity check issues
}

export const solverAPI = {
  solve: async (request: SolveRequest): Promise<SolveResponse> => {
    const response = await api.post<SolveResponse>('/api/solver/solve', request);
    return response.data;
  },
  getJobStatus: async (jobId: string): Promise<JobStatus> => {
    const response = await api.get<JobStatus>(`/api/solver/job/${jobId}`);
    return response.data;
  },
};

export interface Schedule {
  year: number;
  month: number;
  schedule: any[];
  employees?: any[];
  metrics?: any;
  is_published?: boolean;
  has_unpublished?: boolean;
}

export const schedulesAPI = {
  getCommittedSchedules: async (signal?: AbortSignal): Promise<Schedule[]> => {
    const response = await api.get<Schedule[]>('/api/schedules/committed', {
      signal, // FIX: Support request cancellation
    });
    return response.data;
  },
  getSchedule: async (year: number, month: number): Promise<Schedule> => {
    const response = await api.get<Schedule>(`/api/schedules/committed/${year}/${month}`);
    return response.data;
  },
  commitSchedule: async (
    year: number,
    month: number,
    schedule: any[],
    employees?: any[],
    metrics?: any,
    selectedPeriod?: string | null,
  ): Promise<void> => {
    const payload: Record<string, unknown> = {
      year,
      month,
      schedule,
      employees,
      metrics,
    };
    if (selectedPeriod != null && selectedPeriod !== '') {
      payload.selected_period = selectedPeriod;
    }
    await api.post('/api/schedules/commit', payload);
  },
  updateSchedule: async (
    year: number,
    month: number,
    schedule: any[],
    employees?: any[],
    selectedPeriod?: string | null,
  ): Promise<void> => {
    const payload: Record<string, unknown> = { schedule, employees };
    if (selectedPeriod != null && selectedPeriod !== '') {
      payload.selected_period = selectedPeriod;
    }
    await api.put(`/api/schedules/committed/${year}/${month}`, payload);
  },
  publishSchedule: async (
    year: number,
    month: number,
    selectedPeriod?: string | null,
  ): Promise<void> => {
    const payload: Record<string, unknown> = { year, month };
    if (selectedPeriod != null && selectedPeriod !== '') {
      payload.selected_period = selectedPeriod;
    }
    await api.post('/api/schedules/publish', payload);
  },
  unpublishSchedule: async (
    year: number,
    month: number,
    selectedPeriod?: string | null,
  ): Promise<void> => {
    const payload: Record<string, unknown> = { year, month };
    if (selectedPeriod != null && selectedPeriod !== '') {
      payload.selected_period = selectedPeriod;
    }
    await api.post('/api/schedules/unpublish', payload);
  },
  getUnpublishedSummary: async (): Promise<{
    has_unpublished: boolean;
    items: Array<{ year: number; month: number; periods: string[]; has_unpublished: boolean }>;
  }> => {
    const response = await api.get('/api/schedules/unpublished-summary');
    return response.data;
  },
};

export interface LeaveRequest {
  from_date: string;
  to_date: string;
  leave_type: string;
  reason?: string;
  employee?: string; // Optional: for managers updating "Added via Roster Generator" requests
}

export interface ShiftRequest {
  from_date: string;
  to_date: string;
  shift: string;
  request_type: string;
  reason?: string;
  employee?: string; // Optional: for managers updating "Added via Roster Generator" requests
}

export const requestsAPI = {
  getLeaveRequests: async (): Promise<any[]> => {
    const response = await api.get('/api/requests/leave');
    return response.data;
  },
  getAllLeaveRequests: async (): Promise<any[]> => {
    try {
      const response = await api.get('/api/requests/leave/all');
      return response.data;
    } catch (error: any) {
      // Handle 403 Forbidden (non-managers) gracefully - don't log or throw
      if (error.response?.status === 403) {
        // Silently return empty array for non-managers
        return [];
      }
      throw error;
    }
  },
  createLeaveRequest: async (request: LeaveRequest): Promise<any> => {
    const response = await api.post('/api/requests/leave', request);
    return response.data; // Returns {message, request: {request_id, ...}}
  },
  updateLeaveRequest: async (requestId: string, request: LeaveRequest): Promise<void> => {
    console.log(`🔵 [api.ts] updateLeaveRequest called: PUT /api/requests/leave/${requestId}`, request);
    try {
      await api.put(`/api/requests/leave/${requestId}`, request);
      console.log(`🟢 [api.ts] updateLeaveRequest success`);
    } catch (error: any) {
      console.error(`🔴 [api.ts] updateLeaveRequest error:`, error);
      throw error;
    }
  },
  deleteLeaveRequest: async (requestId: string): Promise<void> => {
    await api.delete(`/api/requests/leave/${requestId}`);
  },
  approveLeaveRequest: async (requestId: string): Promise<any> => {
    const response = await api.put(`/api/requests/leave/${requestId}/approve`);
    return response.data;
  },
  rejectLeaveRequest: async (requestId: string): Promise<any> => {
    const response = await api.put(`/api/requests/leave/${requestId}/reject`);
    return response.data;
  },
  getShiftRequests: async (): Promise<any[]> => {
    const response = await api.get('/api/requests/shift');
    return response.data;
  },
  getAllShiftRequests: async (): Promise<any[]> => {
    try {
      const response = await api.get('/api/requests/shift/all');
      return response.data;
    } catch (error: any) {
      // Handle 403 Forbidden (non-managers) gracefully - don't log or throw
      if (error.response?.status === 403) {
        // Silently return empty array for non-managers
        return [];
      }
      throw error;
    }
  },
  createShiftRequest: async (request: ShiftRequest): Promise<any> => {
    const response = await api.post('/api/requests/shift', request);
    return response.data; // Returns {message, request: {request_id, ...}}
  },
  updateShiftRequest: async (requestId: string, request: ShiftRequest): Promise<void> => {
    await api.put(`/api/requests/shift/${requestId}`, request);
  },
  deleteShiftRequest: async (requestId: string): Promise<void> => {
    await api.delete(`/api/requests/shift/${requestId}`);
  },
  approveShiftRequest: async (requestId: string): Promise<any> => {
    const response = await api.put(`/api/requests/shift/${requestId}/approve`);
    return response.data;
  },
  rejectShiftRequest: async (requestId: string): Promise<any> => {
    const response = await api.put(`/api/requests/shift/${requestId}/reject`);
    return response.data;
  },
};

export interface UserUpdate {
  password?: string;
  employee_type?: 'Manager' | 'Staff';
}

export const usersAPI = {
  getUsers: async (): Promise<any[]> => {
    const response = await api.get('/api/users');
    return response.data;
  },
  createUser: async (userData: {
    employee_name: string;
    password: string;
    employee_type: string;
    staff_no?: string | null;
    start_date?: string | null;
  }): Promise<void> => {
    await api.post('/api/users/', userData);
  },
  updateUser: async (username: string, userUpdate: UserUpdate): Promise<void> => {
    await api.put(`/api/users/${username}`, userUpdate);
  },
  deleteUser: async (username: string): Promise<void> => {
    await api.delete(`/api/users/${username}`);
  },
};

export interface LeaveType {
  id: number;
  code: string;
  description: string;
  color_hex: string;
  counts_as_rest: boolean;
  is_active: boolean;
}

export interface LeaveTypeCreate {
  code: string;
  description: string;
  color_hex?: string;
  counts_as_rest?: boolean;
  is_active?: boolean;
}

export interface LeaveTypeUpdate {
  description?: string;
  color_hex?: string;
  counts_as_rest?: boolean;
  is_active?: boolean;
}

export const leaveTypesAPI = {
  getLeaveTypes: async (activeOnly: boolean = false): Promise<LeaveType[]> => {
    const response = await api.get(`/api/leave-types/?active_only=${activeOnly}`);
    return response.data;
  },
  getLeaveType: async (code: string): Promise<LeaveType> => {
    const response = await api.get(`/api/leave-types/${code}`);
    return response.data;
  },
  createLeaveType: async (leaveType: LeaveTypeCreate): Promise<LeaveType> => {
    const response = await api.post('/api/leave-types/', leaveType);
    return response.data;
  },
  updateLeaveType: async (code: string, update: LeaveTypeUpdate): Promise<LeaveType> => {
    const response = await api.put(`/api/leave-types/${code}`, update);
    return response.data;
  },
  deleteLeaveType: async (code: string): Promise<void> => {
    await api.delete(`/api/leave-types/${code}`);
  },
};

export interface ShiftType {
  id: number;
  code: string;
  description: string;
  color_hex: string;
  is_working_shift: boolean;
  is_active: boolean;
}

export interface ShiftTypeCreate {
  code: string;
  description: string;
  color_hex: string;
  is_working_shift: boolean;
  is_active: boolean;
}

export interface ShiftTypeUpdate {
  description?: string;
  color_hex?: string;
  is_working_shift?: boolean;
  is_active?: boolean;
}

export const shiftTypesAPI = {
  getShiftTypes: async (activeOnly: boolean = false, workingOnly: boolean = false): Promise<ShiftType[]> => {
    const params = new URLSearchParams();
    if (activeOnly) params.append('active_only', 'true');
    if (workingOnly) params.append('working_only', 'true');
    const response = await api.get<ShiftType[]>(`/api/shift-types/?${params.toString()}`);
    return response.data;
  },
  getShiftType: async (code: string): Promise<ShiftType> => {
    const response = await api.get<ShiftType>(`/api/shift-types/${code}`);
    return response.data;
  },
  createShiftType: async (shiftType: ShiftTypeCreate): Promise<ShiftType> => {
    const response = await api.post<ShiftType>('/api/shift-types/', shiftType);
    return response.data;
  },
  updateShiftType: async (code: string, update: ShiftTypeUpdate): Promise<ShiftType> => {
    const response = await api.put<ShiftType>(`/api/shift-types/${code}`, update);
    return response.data;
  },
  deleteShiftType: async (code: string): Promise<void> => {
    await api.delete(`/api/shift-types/${code}`);
  },
};

export default api;

