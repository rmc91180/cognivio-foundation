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
  requestAccess: (payload) => api.post("/api/auth/request-access", payload),
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
};

export const masterAdminApi = {
  bootstrap: () => api.get("/api/master-admin/bootstrap"),
  overview: () => api.get("/api/master-admin/overview"),
  users: (params = {}) => api.get("/api/master-admin/users", { params }),
  userDetail: (userId) => api.get(`/api/master-admin/users/${userId}`),
  workspaces: (params = {}) => api.get("/api/master-admin/workspaces", { params }),
  workspaceDetail: (ownerUserId) => api.get(`/api/master-admin/workspaces/${ownerUserId}`),
  authEvents: (params = {}) => api.get("/api/master-admin/auth-events", { params }),
  auditEvents: (params = {}) => api.get("/api/master-admin/audit-events", { params }),
  approveUser: (userId, payload = {}) => api.post(`/api/master-admin/users/${userId}/approve`, payload),
  revokeUser: (userId, payload = {}) => api.post(`/api/master-admin/users/${userId}/revoke`, payload),
  reactivateUser: (userId, payload = {}) => api.post(`/api/master-admin/users/${userId}/reactivate`, payload),
};

export const opsApi = {
  readiness: () => api.get("/api/admin/ops/readiness"),
  launchHealth: () => api.get("/api/admin/ops/launch-health"),
  observability: () => api.get("/api/admin/ops/observability"),
  aiQuality: () => api.get("/api/admin/ops/ai-quality"),
  backlogPriorities: () => api.get("/api/admin/ops/backlog-priorities"),
};

export default api;
