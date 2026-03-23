import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import type {
  ApiResponse,
  AuthResponse,
  LoginCredentials,
  DashboardSummary,
  RubricTemplate,
  Domain,
  RosterRow,
  RosterTotals,
  TeacherDetail,
  TemplateColumn,
  ObservationNote,
  CreateNoteInput,
  NoteCounts,
  NoteType,
  NoteStatus,
  AIFeedback,
  CreateFeedbackInput,
  CreateCorrectionInput,
  FeedbackCorrection,
  FeedbackAnalytics,
  VideoAnalysis,
  GradebookStatus,
  AuditLogEntry,
  AuditAction,
  AuditTargetType,
} from '@/types';

// Production Railway URL hardcoded as fallback (includes /api prefix)
const PRODUCTION_API_URL = 'https://server-production-353d.up.railway.app/api';

// Use VITE_API_URL if set, otherwise use production URL in production mode, or /api for local dev
const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? PRODUCTION_API_URL : '/api');

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiResponse<unknown>>) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ============================================
// AUTH API
// ============================================

export const authApi = {
  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    const response = await api.post<ApiResponse<AuthResponse>>('/auth/login', credentials);
    if (response.data.success && response.data.data) {
      localStorage.setItem('auth_token', response.data.data.token);
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Login failed');
  },

  logout: () => {
    localStorage.removeItem('auth_token');
  },

  getMe: async () => {
    const response = await api.get<ApiResponse<any>>('/auth/me');
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get user');
  },

  selectRole: async (role: string) => {
    const response = await api.post<ApiResponse<any>>('/auth/role/select', { role });
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to select role');
  },
};

// ============================================
// DASHBOARD API
// ============================================

export const dashboardApi = {
  getSummary: async (): Promise<DashboardSummary> => {
    const response = await api.get<ApiResponse<DashboardSummary>>('/dashboard/summary');
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get dashboard');
  },
};

// ============================================
// RUBRICS API
// ============================================

export const rubricsApi = {
  getTemplates: async (): Promise<RubricTemplate[]> => {
    const response = await api.get<ApiResponse<RubricTemplate[]>>('/rubrics/templates');
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get templates');
  },

  getElements: async (templateId: string): Promise<{ templateId: string; domains: Domain[] }> => {
    const response = await api.get<ApiResponse<{ templateId: string; domains: Domain[] }>>(
      `/rubrics/elements?templateId=${templateId}`
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get elements');
  },

  selectTemplate: async (templateId: string, setAsDefault: boolean = false) => {
    const response = await api.post<ApiResponse<any>>('/rubrics/select', {
      templateId,
      setAsDefault,
    });
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to select template');
  },

  createTemplate: async (data: {
    name: string;
    description?: string;
    aggregationMode: string;
    columns: { name: string; weight: number; enabled: boolean; elementIds: string[] }[];
  }) => {
    const response = await api.post<ApiResponse<{ id: string; version: string }>>('/rubrics/templates', data);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to create template');
  },

  getColumns: async (templateId: string): Promise<TemplateColumn[]> => {
    const response = await api.get<ApiResponse<TemplateColumn[]>>(
      `/rubrics/templates/${templateId}/columns`
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get columns');
  },
};

// ============================================
// ROSTER API
// ============================================

export const rosterApi = {
  getRoster: async (params: {
    templateId: string;
    page?: number;
    pageSize?: number;
    sort?: string;
    order?: string;
    search?: string;
    subjects?: string[];
    grades?: string[];
    status?: string[];
    gradebookIssues?: boolean;
  }): Promise<{ rows: RosterRow[]; totals: RosterTotals; meta: any }> => {
    const queryParams = new URLSearchParams({
      templateId: params.templateId,
      page: String(params.page || 1),
      pageSize: String(params.pageSize || 25),
      sort: params.sort || 'name',
      order: params.order || 'asc',
    });

    if (params.search) queryParams.append('search', params.search);
    if (params.subjects?.length) queryParams.append('subjects', params.subjects.join(','));
    if (params.grades?.length) queryParams.append('grades', params.grades.join(','));
    if (params.status?.length) queryParams.append('status', params.status.join(','));
    if (params.gradebookIssues) queryParams.append('gradebookIssues', 'true');

    const response = await api.get<ApiResponse<{ rows: RosterRow[]; totals: RosterTotals }>>(
      `/roster?${queryParams}`
    );
    if (response.data.success && response.data.data) {
      return { ...response.data.data, meta: response.data.meta };
    }
    throw new Error(response.data.error?.message || 'Failed to get roster');
  },
};

// ============================================
// TEACHERS API
// ============================================

export const teachersApi = {
  getDetail: async (
    teacherId: string,
    templateId: string,
    start: string,
    end: string
  ): Promise<TeacherDetail> => {
    const response = await api.get<ApiResponse<TeacherDetail>>(
      `/teachers/${teacherId}/detail?templateId=${templateId}&start=${start}&end=${end}`
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get teacher detail');
  },

  getSummary: async (teacherId: string, columnId?: string) => {
    const url = columnId
      ? `/teachers/${teacherId}/summary?columnId=${columnId}`
      : `/teachers/${teacherId}/summary`;
    const response = await api.get<ApiResponse<any>>(url);
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get summary');
  },
};

// ============================================
// AI API
// ============================================

export const aiApi = {
  reviewObservation: async (
    observationId: string,
    action: 'accept' | 'reject' | 'edit',
    edits?: { score?: number; notes?: string }
  ) => {
    const response = await api.post<ApiResponse<any>>('/ai/review', {
      observationId,
      action,
      edits,
    });
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to review observation');
  },
};

// ============================================
// VIDEO API
// ============================================

export const videoApi = {
  upload: async (teacherId: string, classId?: string, filename?: string, anonymize?: boolean) => {
    const response = await api.post<ApiResponse<any>>('/video/upload', {
      teacherId,
      classId,
      filename,
      anonymize,
    });
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to upload video');
  },

  getStatus: async (videoId: string) => {
    const response = await api.get<ApiResponse<any>>(`/video/${videoId}/status`);
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get video status');
  },

  getVideo: async (videoId: string) => {
    const response = await api.get<ApiResponse<any>>(`/video/${videoId}`);
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get video');
  },

  getAnalysis: async (videoId: string): Promise<VideoAnalysis> => {
    const response = await api.get<ApiResponse<VideoAnalysis>>(`/video/${videoId}/analysis`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get video analysis');
  },

  getReport: async (videoId: string, format: 'json' | 'text' = 'json') => {
    const response = await api.get<ApiResponse<any>>(`/video/${videoId}/report?format=${format}`);
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get video report');
  },
};

// ============================================
// NOTES API
// ============================================

export const notesApi = {
  create: async (input: CreateNoteInput): Promise<ObservationNote> => {
    const response = await api.post<ApiResponse<ObservationNote>>('/notes', input);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to create note');
  },

  getAll: async (params: {
    observationId?: string;
    videoId?: string;
    elementId?: string;
    noteType?: NoteType;
    status?: NoteStatus;
    searchTerm?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ notes: ObservationNote[]; total: number; page: number; pageSize: number; totalPages: number }> => {
    const queryParams = new URLSearchParams();
    if (params.observationId) queryParams.append('observationId', params.observationId);
    if (params.videoId) queryParams.append('videoId', params.videoId);
    if (params.elementId) queryParams.append('elementId', params.elementId);
    if (params.noteType) queryParams.append('noteType', params.noteType);
    if (params.status) queryParams.append('status', params.status);
    if (params.searchTerm) queryParams.append('searchTerm', params.searchTerm);
    if (params.page) queryParams.append('page', String(params.page));
    if (params.pageSize) queryParams.append('pageSize', String(params.pageSize));

    const response = await api.get<ApiResponse<ObservationNote[]>>(`/notes?${queryParams}`);
    if (response.data.success && response.data.data) {
      return {
        notes: response.data.data,
        total: response.data.meta?.totalItems || 0,
        page: response.data.meta?.page || 1,
        pageSize: response.data.meta?.pageSize || 20,
        totalPages: response.data.meta?.totalPages || 1,
      };
    }
    throw new Error(response.data.error?.message || 'Failed to get notes');
  },

  getForObservation: async (observationId: string): Promise<ObservationNote[]> => {
    const response = await api.get<ApiResponse<ObservationNote[]>>(`/notes/observation/${observationId}`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get notes');
  },

  getCounts: async (observationId: string): Promise<NoteCounts> => {
    const response = await api.get<ApiResponse<NoteCounts>>(`/notes/observation/${observationId}/counts`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get note counts');
  },

  getById: async (noteId: string): Promise<ObservationNote> => {
    const response = await api.get<ApiResponse<ObservationNote>>(`/notes/${noteId}`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get note');
  },

  update: async (noteId: string, updates: Partial<CreateNoteInput & { isPinned?: boolean; status?: NoteStatus }>): Promise<ObservationNote> => {
    const response = await api.patch<ApiResponse<ObservationNote>>(`/notes/${noteId}`, updates);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to update note');
  },

  resolve: async (noteId: string): Promise<ObservationNote> => {
    const response = await api.post<ApiResponse<ObservationNote>>(`/notes/${noteId}/resolve`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to resolve note');
  },

  togglePin: async (noteId: string): Promise<ObservationNote> => {
    const response = await api.post<ApiResponse<ObservationNote>>(`/notes/${noteId}/pin`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to toggle pin');
  },

  archive: async (noteId: string): Promise<void> => {
    const response = await api.post<ApiResponse<any>>(`/notes/${noteId}/archive`);
    if (!response.data.success) {
      throw new Error(response.data.error?.message || 'Failed to archive note');
    }
  },

  delete: async (noteId: string): Promise<void> => {
    const response = await api.delete<ApiResponse<any>>(`/notes/${noteId}`);
    if (!response.data.success) {
      throw new Error(response.data.error?.message || 'Failed to delete note');
    }
  },
};

// ============================================
// FEEDBACK API
// ============================================

export const feedbackApi = {
  submit: async (input: CreateFeedbackInput): Promise<AIFeedback> => {
    const response = await api.post<ApiResponse<AIFeedback>>('/feedback', input);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to submit feedback');
  },

  getById: async (feedbackId: string): Promise<AIFeedback> => {
    const response = await api.get<ApiResponse<AIFeedback>>(`/feedback/${feedbackId}`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get feedback');
  },

  update: async (feedbackId: string, updates: Partial<CreateFeedbackInput>): Promise<AIFeedback> => {
    const response = await api.patch<ApiResponse<AIFeedback>>(`/feedback/${feedbackId}`, updates);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to update feedback');
  },

  getForObservation: async (observationId: string): Promise<AIFeedback[]> => {
    const response = await api.get<ApiResponse<AIFeedback[]>>(`/feedback/observation/${observationId}`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get feedback');
  },

  addCorrection: async (feedbackId: string, correction: CreateCorrectionInput): Promise<FeedbackCorrection> => {
    const response = await api.post<ApiResponse<FeedbackCorrection>>(`/feedback/${feedbackId}/corrections`, correction);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to add correction');
  },

  approve: async (feedbackId: string): Promise<AIFeedback> => {
    const response = await api.post<ApiResponse<AIFeedback>>(`/feedback/${feedbackId}/approve`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to approve feedback');
  },

  validateCorrection: async (correctionId: string): Promise<FeedbackCorrection> => {
    const response = await api.post<ApiResponse<FeedbackCorrection>>(`/feedback/corrections/${correctionId}/validate`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to validate correction');
  },

  getAnalytics: async (params?: {
    startDate?: string;
    endDate?: string;
    minCorrections?: number;
  }): Promise<FeedbackAnalytics> => {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);
    if (params?.minCorrections) queryParams.append('minCorrections', String(params.minCorrections));

    const response = await api.get<ApiResponse<FeedbackAnalytics>>(`/feedback/analytics?${queryParams}`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get analytics');
  },

  exportTrainingData: async (params: {
    exportName: string;
    description?: string;
    exportFormat?: string;
    dataFrom?: string;
    dataTo?: string;
    minAccuracyRating?: number;
    validatedOnly?: boolean;
  }) => {
    const response = await api.post<ApiResponse<any>>('/feedback/training/export', params);
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to create export');
  },
};

// ============================================
// SETTINGS API
// ============================================

export const settingsApi = {
  getThresholds: async () => {
    const response = await api.get<ApiResponse<{ greenMin: number; yellowMin: number }>>(
      '/settings/thresholds'
    );
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get thresholds');
  },

  updateThresholds: async (greenMin: number, yellowMin: number) => {
    const response = await api.put<ApiResponse<any>>('/settings/thresholds', {
      greenMin,
      yellowMin,
    });
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to update thresholds');
  },

  updatePinnedElements: async (elementId: string, action: 'add' | 'remove') => {
    const response = await api.post<ApiResponse<any>>('/settings/pinned-elements', {
      elementId,
      action,
    });
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to update pinned elements');
  },
};

// ============================================
// GRADEBOOK API
// ============================================

export const gradebookApi = {
  getStatus: async (teacherIds: string[]): Promise<GradebookStatus[]> => {
    const response = await api.get<ApiResponse<GradebookStatus[]>>(
      `/gradebook/status?teacherIds=${teacherIds.join(',')}`
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to get gradebook status');
  },

  sync: async (): Promise<{ message: string; syncedAt: string }> => {
    const response = await api.post<ApiResponse<{ message: string; syncedAt: string }>>('/gradebook/sync');
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || 'Failed to sync gradebook');
  },
};

// ============================================
// AUDIT API
// ============================================

export const auditApi = {
  getLogs: async (params?: {
    targetType?: AuditTargetType;
    targetId?: string;
    action?: AuditAction;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    entries: AuditLogEntry[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> => {
    const queryParams = new URLSearchParams();
    if (params?.targetType) queryParams.append('targetType', params.targetType);
    if (params?.targetId) queryParams.append('targetId', params.targetId);
    if (params?.action) queryParams.append('action', params.action);
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);
    if (params?.page) queryParams.append('page', String(params.page));
    if (params?.pageSize) queryParams.append('pageSize', String(params.pageSize));

    const response = await api.get<ApiResponse<AuditLogEntry[]>>(`/audit?${queryParams}`);
    if (response.data.success && response.data.data) {
      return {
        entries: response.data.data,
        total: response.data.meta?.totalItems || 0,
        page: response.data.meta?.page || 1,
        pageSize: response.data.meta?.pageSize || 50,
        totalPages: response.data.meta?.totalPages || 1,
      };
    }
    throw new Error(response.data.error?.message || 'Failed to get audit logs');
  },
};

export default api;
