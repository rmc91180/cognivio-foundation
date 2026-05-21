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
  logout: () => api.post("/api/auth/logout"),
  register: (payload) => api.post("/api/auth/register", payload),
  requestAccess: (payload) => api.post("/api/auth/request-access", payload),
  institutionLookup: (params) => api.get("/api/institutions/lookup", { params }),
  requestPasswordReset: (payload) => api.post("/api/auth/password-reset/request", payload),
  confirmPasswordReset: (payload) => api.post("/api/auth/password-reset/confirm", payload),
  me: () => api.get("/api/me"),
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

export const notificationApi = {
  list: () => api.get("/api/notifications"),
  unreadCount: () => api.get("/api/notifications/unread-count"),
  markAllRead: () => api.post("/api/notifications/read-all"),
};

export const privacyReviewApi = {
  queue: () => api.get("/api/privacy/review-queue"),
  resolve: (videoId, payload) => api.post(`/api/videos/${videoId}/privacy/review`, payload),
};

export const scheduleApi = {
  list: (params) => api.get("/api/schedules", { params }),
  create: (payload) => api.post("/api/schedules", payload),
  update: (id, payload) => api.patch(`/api/schedules/${id}`, payload),
};

export const reportApi = {
  history: () => api.get("/api/reports/history"),
  coachingSnapshot: () => api.get("/api/reports/coaching-snapshot"),
  cohortSnapshot: () => api.get("/api/reports/cohort-snapshot"),
  exportCoachingSnapshotCsv: () =>
    api.get("/api/reports/export/coaching-snapshot.csv", { responseType: "blob" }),
  exportCohortSnapshotCsv: () =>
    api.get("/api/reports/export/cohort-snapshot.csv", { responseType: "blob" }),
  export: (format, params = {}) =>
    api.post(
      "/api/reports/export",
      new URLSearchParams({ format, ...params }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        responseType: "blob",
      }
    ),
};

export const dashboardApi = {
  intelligence: () => api.get("/api/dashboard/intelligence"),
};

export const adminWorkspaceApi = {
  dashboard: (params) => api.get("/api/admin/workspace/dashboard", { params }),
  search: (params) => api.get("/api/admin/workspace/search", { params }),
};

export const teacherWorkspaceApi = {
  latestLesson: () => api.get("/api/teachers/me/latest-lesson"),
  coachingTasks: () => api.get("/api/coaching/tasks"),
  taskReflection: (taskId, payload) =>
    api.post(`/api/coaching/tasks/${taskId}/reflection`, payload),
  reflections: () => api.get("/api/coaching/reflections/my"),
  recognition: () => api.get("/api/recognition/my-badges"),
};

export const trainingApi = {
  supervisorSummary: () => api.get("/api/training/supervisor-summary"),
};

export const demoApi = {
  reset: (persona) => api.post("/api/demo/reset", null, { params: { persona } }),
  seed: (payload) => api.post("/api/demo/seed", payload),
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
  approveAccessUser: (userId, payload = {}) =>
    api.post(`/api/admin/access-users/${userId}/approve`, payload),
  revokeAccessUser: (userId, payload = {}) =>
    api.post(`/api/admin/access-users/${userId}/revoke`, payload),
};

export const onboardingApi = {
  status: () => api.get("/api/onboarding/status"),
  complete: (payload = {}) => api.post("/api/onboarding/complete", payload),
};

export const consentApi = {
  status: () => api.get("/api/consent/status"),
  grant: (payload) => api.post("/api/consent/grant", payload),
  withdraw: (payload) => api.post("/api/consent/withdraw", payload),
  records: () => api.get("/api/consent/records"),
  dataExport: () => api.get("/api/user/data-export", { responseType: "blob" }),
  erase: () => api.post("/api/user/right-to-erasure"),
};

export const masterAdminApi = {
  bootstrap: () => api.get("/api/master-admin/bootstrap"),
  overview: () => api.get("/api/master-admin/overview"),
  internalReadiness: () => api.get("/api/admin/internal-readiness"),
  signupHealth: () => api.get("/api/admin/signup-health"),
  users: (params = {}) => api.get("/api/master-admin/users", { params }),
  userDetail: (userId) => api.get(`/api/master-admin/users/${userId}`),

  approveUser: (userId, payload = {}) =>
    api.post(`/api/master-admin/users/${userId}/approve`, payload),

  deleteUser: (userId, payload = {}) =>
    api.post(`/api/master-admin/users/${userId}/delete`, payload),

  revokeUser: (userId, payload = {}) =>
    api.post(`/api/master-admin/users/${userId}/revoke`, payload),

  freezeUser: (userId, payload = {}) =>
    api.post(`/api/master-admin/users/${userId}/freeze`, payload),

  unfreezeUser: (userId, payload = {}) =>
    api.post(`/api/master-admin/users/${userId}/unfreeze`, payload),

  reactivateUser: (userId, payload = {}) =>
    api.post(`/api/master-admin/users/${userId}/reactivate`, payload),

  organizations: (params = {}) => api.get("/api/master-admin/organizations", { params }),
  organizationDetail: (organizationId) =>
    api.get(`/api/master-admin/organizations/${organizationId}`),
  updateOrganizationSeatPolicy: (organizationId, payload) =>
    api.post(`/api/master-admin/organizations/${organizationId}/seat-policy`, payload),
  workspaces: (params = {}) => api.get("/api/master-admin/workspaces", { params }),
  workspaceDetail: (ownerUserId) => api.get(`/api/master-admin/workspaces/${ownerUserId}`),
  authEvents: (params = {}) => api.get("/api/master-admin/auth-events", { params }),
  auditEvents: (params = {}) => api.get("/api/master-admin/audit-events", { params }),
  incidents: (params = {}) => api.get("/api/master-admin/incidents", { params }),
  videos: (params = {}) => api.get("/api/master-admin/videos", { params }),
  videoDetail: (videoId) => api.get(`/api/master-admin/videos/${videoId}`),
  retryVideoAnalysis: (videoId) =>
    api.post(`/api/master-admin/videos/${videoId}/retry-analysis`),
  retryVideoPrivacy: (videoId) =>
    api.post(`/api/master-admin/videos/${videoId}/retry-privacy`),
  retryVideoTranscode: (videoId) =>
    api.post(`/api/master-admin/videos/${videoId}/retry-transcode`),
  storage: () => api.get("/api/master-admin/storage"),
  dependencies: () => api.get("/api/master-admin/dependencies"),
  aiQuality: () => api.get("/api/master-admin/ai-quality"),
  aiQualityLatest: () => api.get("/api/admin/ai-quality/latest"),
  aiQualityHistory: () => api.get("/api/admin/ai-quality/history"),
  support: (params = {}) => api.get("/api/master-admin/support", { params }),
  revokeSessions: (userId, payload = {}) =>
    api.post(`/api/master-admin/users/${userId}/sessions/revoke`, payload),
  exportDiagnosticBundle: (payload) =>
    api.post("/api/master-admin/diagnostic-bundles/export", payload),
};

export const opsApi = {
  readiness: () => api.get("/api/admin/ops/readiness"),
  launchHealth: () => api.get("/api/admin/ops/launch-health"),
  observability: () => api.get("/api/admin/ops/observability"),
  aiQuality: () => api.get("/api/admin/ops/ai-quality"),
  backlogPriorities: () => api.get("/api/admin/ops/backlog-priorities"),
};

export default api;
