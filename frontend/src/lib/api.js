import api from "@/lib/apiClient";

import { assessmentApi, adherenceApi } from "@/features/assessments/api";
import {
  exemplarApi,
  recognitionApi,
  shareAssetApi,
} from "@/features/recognition/api";
import {
  curriculumApi,
  frameworkApi,
  lessonPlanApi,
  recordingComplianceApi,
  recordingPolicyApi,
  schoolApi,
  syllabusApi,
} from "@/features/school-setup/api";
import {
  actionPlanApi,
  observationApi,
  privacyProfileApi,
  teacherApi,
} from "@/features/teachers/api";
import { evidenceApi, videoApi } from "@/features/videos/api";

export const authApi = {
  login: (payload) => api.post("/api/auth/login", payload),
  register: (payload) => api.post("/api/auth/register", payload),
  logout: () => api.post("/api/auth/logout"),
  requestAccess: (payload) => api.post("/api/auth/request-access", payload),
  institutionLookup: (params) => api.get("/api/institutions/lookup", { params }),
  requestPasswordReset: (payload) => api.post("/api/auth/password-reset/request", payload),
  confirmPasswordReset: (payload) => api.post("/api/auth/password-reset/confirm", payload),
  me: () => api.get("/api/auth/me"),
  getWorkspaceMode: () => api.get("/api/user/workspace-mode"),
  setWorkspaceMode: (payload) => api.post("/api/user/workspace-mode", payload),
};

export { assessmentApi, adherenceApi };
export { exemplarApi, recognitionApi, shareAssetApi };
export {
  curriculumApi,
  frameworkApi,
  lessonPlanApi,
  recordingComplianceApi,
  recordingPolicyApi,
  schoolApi,
  syllabusApi,
};
export {
  actionPlanApi,
  observationApi,
  privacyProfileApi,
  teacherApi,
};
export { evidenceApi, videoApi };

export const privacyReviewApi = {
  queue: () => api.get("/api/privacy/review-queue"),
  resolve: (videoId, payload) => api.post(`/api/videos/${videoId}/privacy/review`, payload),
};

export const scheduleApi = {
  list: (params) => api.get("/api/schedules", { params }),
  create: (payload) => api.post("/api/schedules", payload),
  update: (id, payload) => api.patch(`/api/schedules/${id}`, payload),
  compliance: () => api.get("/api/schedules/compliance"),
  bulk: (payload) => api.post("/api/schedules/bulk", payload),
  calendar: (params = {}) => api.get("/api/schedules/calendar", { params }),
  conflicts: (params = {}) => api.get("/api/schedules/conflicts", { params }),
};

export const observationSessionApi = {
  create: (payload) => api.post("/api/observation-sessions", payload),
  list: (params = {}) => api.get("/api/observation-sessions", { params }),
  upcoming: () => api.get("/api/observation-sessions/upcoming"),
  get: (id) => api.get(`/api/observation-sessions/${id}`),
  update: (id, payload) => api.patch(`/api/observation-sessions/${id}`, payload),
};

export const observerApi = {
  goals: () => api.get("/api/observer/goals"),
  createGoal: (payload) => api.post("/api/observer/goals", payload),
  addGoalProgress: (id, payload) => api.post(`/api/observer/goals/${id}/progress`, payload),
  insights: () => api.get("/api/observer/insights"),
};

export const cohortApi = {
  list: () => api.get("/api/cohorts"),
  create: (payload) => api.post("/api/cohorts", payload),
  trainees: (id) => api.get(`/api/cohorts/${id}/trainees`),
  summary: (id) => api.get(`/api/cohorts/${id}/summary`),
};

export const traineeApi = {
  placements: (id) => api.get(`/api/trainees/${id}/placements`),
  createPlacement: (id, payload) => api.post(`/api/trainees/${id}/placements`, payload),
};

export const reportApi = {
  export: (format, params = {}) =>
    api.post(
      "/api/reports/export",
      new URLSearchParams({ format, ...params }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        responseType: "blob",
      }
    ),
  teacherReport: (teacherId, params = {}) =>
    api.post(`/api/reports/teacher/${teacherId}`, null, { params, responseType: "blob" }),
  schoolSummary: (params = {}) =>
    api.post("/api/reports/school/summary", null, { params, responseType: "blob" }),
  csv: (type) =>
    api.post("/api/reports/export/csv", null, { params: { type }, responseType: "blob" }),
  bulkTeacherReports: (params = {}) =>
    api.post("/api/reports/teachers/bulk", null, { params, responseType: "blob" }),
  history: () => api.get("/api/reports/history"),
};

export const gradebookApi = {
  list: () => api.get("/api/integrations/gradebook"),
  connect: (payload) => api.post("/api/integrations/gradebook", payload),
};

export const adminApi = {
  setScoringMode: (scoring_mode) =>
    api.post("/api/admin/preferences/scoring-mode", { scoring_mode }),
  feedbackDigest: () => api.get("/api/admin/feedback-digest"),
  organizationMemory: (params) => api.get("/api/admin/organization-memory", { params }),
  accessUsers: () => api.get("/api/admin/access-users"),
  approveAccessUser: (userId, payload = {}) => api.post(`/api/admin/access-users/${userId}/approve`, payload),
  revokeAccessUser: (userId, payload = {}) => api.post(`/api/admin/access-users/${userId}/revoke`, payload),
  linkTeacher: (teacherId, payload = {}) => api.post(`/api/admin/teachers/${teacherId}/link`, payload),
  unlinkTeacher: (teacherId) => api.post(`/api/admin/teachers/${teacherId}/unlink`),
};

export const notificationApi = {
  list: (params = {}) => api.get("/api/notifications", { params }),
  unreadCount: () => api.get("/api/notifications/unread-count"),
  markRead: (id) => api.post(`/api/notifications/${id}/read`),
  markAllRead: () => api.post("/api/notifications/mark-all-read"),
  dismiss: (id) => api.delete(`/api/notifications/${id}`),
  preferences: () => api.get("/api/user/notification-preferences"),
  updatePreferences: (payload) => api.patch("/api/user/notification-preferences", payload),
};

export const masterAdminApi = {
  bootstrap: () => api.get("/api/master-admin/bootstrap"),
  overview: () => api.get("/api/master-admin/overview"),
  users: (params = {}) => api.get("/api/master-admin/users", { params }),
  userDetail: (userId) => api.get(`/api/master-admin/users/${userId}`),
  organizations: (params = {}) => api.get("/api/master-admin/organizations", { params }),
  organizationDetail: (organizationId) => api.get(`/api/master-admin/organizations/${organizationId}`),
  updateOrganizationSeatPolicy: (organizationId, payload) =>
    api.post(`/api/master-admin/organizations/${organizationId}/seat-policy`, payload),
  workspaces: (params = {}) => api.get("/api/master-admin/workspaces", { params }),
  workspaceDetail: (ownerUserId) => api.get(`/api/master-admin/workspaces/${ownerUserId}`),
  authEvents: (params = {}) => api.get("/api/master-admin/auth-events", { params }),
  auditEvents: (params = {}) => api.get("/api/master-admin/audit-events", { params }),
  approveUser: (userId, payload = {}) => api.post(`/api/master-admin/users/${userId}/approve`, payload),
  deleteUser: (userId, payload = {}) => api.post(`/api/master-admin/users/${userId}/revoke`, payload),
  reactivateUser: (userId, payload = {}) => api.post(`/api/master-admin/users/${userId}/reactivate`, payload),
  incidents: (params = {}) => api.get("/api/master-admin/incidents", { params }),
  videos: (params = {}) => api.get("/api/master-admin/videos", { params }),
  videoDetail: (videoId) => api.get(`/api/master-admin/videos/${videoId}`),
  retryVideoAnalysis: (videoId) => api.post(`/api/master-admin/videos/${videoId}/retry-analysis`),
  retryVideoPrivacy: (videoId) => api.post(`/api/master-admin/videos/${videoId}/retry-privacy`),
  retryVideoTranscode: (videoId) => api.post(`/api/master-admin/videos/${videoId}/retry-transcode`),
  storage: () => api.get("/api/master-admin/storage"),
  dependencies: () => api.get("/api/master-admin/dependencies"),
  aiQuality: () => api.get("/api/master-admin/ai-quality"),
  support: (params = {}) => api.get("/api/master-admin/support", { params }),
  revokeSessions: (userId, payload = {}) => api.post(`/api/master-admin/users/${userId}/sessions/revoke`, payload),
  exportDiagnosticBundle: (payload) => api.post("/api/master-admin/diagnostic-bundles/export", payload),
};

export const opsApi = {
  readiness: () => api.get("/api/admin/ops/readiness"),
  launchHealth: () => api.get("/api/admin/ops/launch-health"),
  observability: () => api.get("/api/admin/ops/observability"),
  aiQuality: () => api.get("/api/admin/ops/ai-quality"),
  backlogPriorities: () => api.get("/api/admin/ops/backlog-priorities"),
};

export default api;
