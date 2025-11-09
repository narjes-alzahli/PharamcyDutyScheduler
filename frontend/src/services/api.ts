import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

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
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      window.location.href = '/login';
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
  date: string;
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

export default api;

