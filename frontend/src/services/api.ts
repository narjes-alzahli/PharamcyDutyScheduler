import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Only clear storage and redirect if not already on login page
      // and not during a login request (to avoid interfering with login flow)
      const isLoginRequest = error.config?.url?.includes('/auth/login');
      const isOnLoginPage = window.location.pathname === '/login';
      
      if (!isLoginRequest && !isOnLoginPage) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
        // Use a flag to prevent redirect loops
        const shouldRedirect = sessionStorage.getItem('auth_redirect') !== 'blocked';
        if (shouldRedirect) {
          sessionStorage.setItem('auth_redirect', 'blocked');
      window.location.href = '/login';
        }
      }
    }
    // Reset redirect flag on successful requests
    if (error.config?.url?.includes('/auth/login') && error.response?.status !== 401) {
      sessionStorage.removeItem('auth_redirect');
    }
    return Promise.reject(error);
  }
);

export interface User {
  username: string;
  employee_name: string;
  employee_type: 'Manager' | 'Staff';
}

export interface LoginRequest {
  username: string;
  password: string;
  remember_me?: boolean;
}

export interface LoginResponse {
  access_token: string;
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
  maxN: number;
  maxA: number;
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
}

export interface TimeOffEntry {
  employee: string;
  from_date: string;
  to_date: string;
  code: string;
}

export interface LockEntry {
  employee: string;
  from_date: string;
  to_date: string;
  shift: string;
  force: boolean;
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
  updateTimeOff: async (timeOff: TimeOffEntry[]): Promise<void> => {
    await api.put('/api/data/time-off', timeOff);
  },
  updateLocks: async (locks: LockEntry[]): Promise<void> => {
    await api.put('/api/data/locks', locks);
  },
};

export interface SolveRequest {
  year: number;
  month: number;
  time_limit?: number;
  unfilled_penalty?: number;
  fairness_weight?: number;
  switching_penalty?: number;
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
}

export const schedulesAPI = {
  getCommittedSchedules: async (): Promise<Schedule[]> => {
    const response = await api.get<Schedule[]>('/api/schedules/committed');
    return response.data;
  },
  getSchedule: async (year: number, month: number): Promise<Schedule> => {
    const response = await api.get<Schedule>(`/api/schedules/committed/${year}/${month}`);
    return response.data;
  },
  commitSchedule: async (year: number, month: number, schedule: any[], employees?: any[], metrics?: any): Promise<void> => {
    await api.post('/api/schedules/commit', {
      year,
      month,
      schedule,
      employees,
      metrics,
    });
  },
};

export interface LeaveRequest {
  from_date: string;
  to_date: string;
  leave_type: string;
  reason?: string;
}

export interface ShiftRequest {
  from_date: string;
  to_date: string;
  shift: string;
  request_type: string;
  reason?: string;
}

export const requestsAPI = {
  getLeaveRequests: async (): Promise<any[]> => {
    const response = await api.get('/api/requests/leave');
    return response.data;
  },
  getAllLeaveRequests: async (): Promise<any[]> => {
    const response = await api.get('/api/requests/leave/all');
    return response.data;
  },
  createLeaveRequest: async (request: LeaveRequest): Promise<void> => {
    await api.post('/api/requests/leave', request);
  },
  updateLeaveRequest: async (requestId: string, request: LeaveRequest): Promise<void> => {
    await api.put(`/api/requests/leave/${requestId}`, request);
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
    const response = await api.get('/api/requests/shift/all');
    return response.data;
  },
  createShiftRequest: async (request: ShiftRequest): Promise<void> => {
    await api.post('/api/requests/shift', request);
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
  display_name: string;
  description?: string;
  color_hex: string;
  counts_as_rest: boolean;
  is_active: boolean;
}

export interface LeaveTypeCreate {
  code: string;
  display_name: string;
  description?: string;
  color_hex?: string;
  counts_as_rest?: boolean;
  is_active?: boolean;
}

export interface LeaveTypeUpdate {
  display_name?: string;
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

export default api;

