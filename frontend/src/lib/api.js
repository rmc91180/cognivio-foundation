import axios from "axios";

const API_BASE_URL = process.env.REACT_APP_BACKEND_URL;

if (!API_BASE_URL) {
  // eslint-disable-next-line no-console
  console.error("REACT_APP_BACKEND_URL is not configured; API calls will fail.");
}

const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("cognivio_token");
  if (token) {
    // eslint-disable-next-line no-param-reassign
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authApi = {
  login: (payload) => api.post("/api/auth/login", payload),
  register: (payload) => api.post("/api/auth/register", payload),
  me: () => api.get("/api/auth/me"),
};

export const teacherApi = {
  list: () => api.get("/api/teachers"),
  create: (payload) => api.post("/api/teachers", payload),
  get: (id) => api.get(`/api/teachers/${id}`),
  update: (id, payload) => api.patch(`/api/teachers/${id}`, payload),
  getPeerRecommendations: (id) =>
    api.get(`/api/teachers/${id}/peer-recommendations`),
};

export const schoolApi = {
  list: () => api.get("/api/schools"),
  create: (payload) => api.post("/api/schools", payload),
};

export const videoApi = {
  upload: (formData, config = {}) =>
    api.post("/api/videos/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      ...config,
    }),
  list: (params) => api.get("/api/videos", { params }),
  status: (videoId) => api.get(`/api/videos/${videoId}/status`),
  detail: (videoId) => api.get(`/api/videos/${videoId}`),
  retry: (videoId) => api.post(`/api/videos/${videoId}/retry`),
  retryPrivacy: (videoId) => api.post(`/api/videos/${videoId}/privacy/retry`),
};

export const privacyProfileApi = {
  get: (teacherId) => api.get(`/api/teachers/${teacherId}/privacy-profile`),
  upload: (teacherId, formData) =>
    api.post(`/api/teachers/${teacherId}/privacy-profile`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  remove: (teacherId) => api.delete(`/api/teachers/${teacherId}/privacy-profile`),
};

export const privacyReviewApi = {
  queue: () => api.get("/api/privacy/review-queue"),
  resolve: (videoId, payload) => api.post(`/api/videos/${videoId}/privacy/review`, payload),
};

export const recognitionApi = {
  teacherSummary: (teacherId) => api.get(`/api/teachers/${teacherId}/recognition`),
  video: (videoId) => api.get(`/api/videos/${videoId}/recognition`),
  updateOptIn: (videoId, payload) => api.post(`/api/videos/${videoId}/recognition/opt-in`, payload),
  reviewQueue: () => api.get("/api/recognition/review-queue"),
  review: (videoId, payload) => api.post(`/api/videos/${videoId}/recognition/review`, payload),
};

export const exemplarApi = {
  submit: (videoId, payload) => api.post(`/api/videos/${videoId}/exemplar/submit`, payload),
  reviewQueue: () => api.get("/api/exemplar-library/review-queue"),
  review: (submissionId, payload) => api.post(`/api/exemplar-library/${submissionId}/review`, payload),
  list: (params) => api.get("/api/exemplar-library", { params }),
};

export const shareAssetApi = {
  createSocialCard: (videoId, payload) => api.post(`/api/videos/${videoId}/share/social-card`, payload),
  createEmailSignature: (videoId, payload) => api.post(`/api/videos/${videoId}/share/email-signature`, payload),
};

export const recordingPolicyApi = {
  list: () => api.get("/api/recording-policies"),
  create: (payload) => api.post("/api/recording-policies", payload),
  update: (id, payload) => api.patch(`/api/recording-policies/${id}`, payload),
};

export const recordingComplianceApi = {
  get: (teacherId) => api.get("/api/recording-compliance", { params: { teacher_id: teacherId } }),
  summary: () => api.get("/api/recording-compliance/summary"),
  remind: (teacherId) =>
    api.post(
      "/api/recording-compliance/remind",
      new URLSearchParams({ teacher_id: teacherId })
    ),
};

export const assessmentApi = {
  list: (params) => api.get("/api/assessments", { params }),
  get: (id) => api.get(`/api/assessments/${id}`),
  roster: (params) => api.get("/api/roster", { params }),
  dashboardDomainTrends: (params) =>
    api.get("/api/dashboard/domain-trends", { params }),
  dashboardLeadershipInsights: (params) =>
    api.get("/api/dashboard/leadership-insights", { params }),
  seedDemoData: () => api.post("/api/seed-demo-data"),
  teacherDashboard: (teacherId, params) =>
    api.get(`/api/teachers/${teacherId}/dashboard`, { params }),
  teacherSummaryInsights: (teacherId) =>
    api.get(`/api/teachers/${teacherId}/summary-insights`),
  teacherSummaryReflection: (teacherId) =>
    api.get(`/api/teachers/${teacherId}/summary-reflection`),
  saveTeacherSummaryReflection: (teacherId, payload) =>
    api.post(`/api/teachers/${teacherId}/summary-reflection`, payload),
  createAdminOverride: (assessmentId, payload) =>
    api.post(`/api/assessments/${assessmentId}/admin-override`, payload),
  listAdminOverrides: (assessmentId) =>
    api.get(`/api/assessments/${assessmentId}/admin-overrides`),
};

export const scheduleApi = {
  list: (params) => api.get("/api/schedules", { params }),
  create: (payload) => api.post("/api/schedules", payload),
  update: (id, payload) => api.patch(`/api/schedules/${id}`, payload),
};

export const observationApi = {
  create: (payload) => api.post("/api/observations", payload),
  listForTeacher: (teacherId) =>
    api.get(`/api/teachers/${teacherId}/observations`),
  listForVideo: (videoId) =>
    api.get(`/api/videos/${videoId}/observations`),
  update: (id, payload) => api.patch(`/api/observations/${id}`, payload),
};

export const frameworkApi = {
  list: () => api.get("/api/frameworks"),
  get: (frameworkType) => api.get(`/api/frameworks/${frameworkType}`),
  currentSelection: () => api.get("/api/frameworks/selection/current"),
  saveSelection: (payload) => api.post("/api/frameworks/selection", payload),
  listCustomDomains: () => api.get("/api/frameworks/custom-domains"),
  createCustomDomain: (payload) => api.post("/api/frameworks/custom-domains", payload),
  addCustomElement: (domainId, payload) =>
    api.post(`/api/frameworks/custom-domains/${domainId}/elements`, payload),
  deleteCustomDomain: (domainId) =>
    api.delete(`/api/frameworks/custom-domains/${domainId}`),
};

export const curriculumApi = {
  upload: (formData) =>
    api.post("/api/curricula", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  list: (teacherId) => api.get("/api/curricula", { params: { teacher_id: teacherId } }),
};

export const lessonPlanApi = {
  upload: (formData) =>
    api.post("/api/lesson-plans", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  list: (teacherId, date) =>
    api.get("/api/lesson-plans", { params: { teacher_id: teacherId, date } }),
};

export const syllabusApi = {
  upload: (formData) =>
    api.post("/api/syllabi", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  list: (teacherId) => api.get("/api/syllabi", { params: { teacher_id: teacherId } }),
};

export const adherenceApi = {
  get: (assessmentId) => api.get(`/api/assessments/${assessmentId}/curriculum-adherence`),
};

export const evidenceApi = {
  get: (assessmentId) => api.get(`/api/assessments/${assessmentId}/evidence`),
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

export const actionPlanApi = {
  get: (teacherId) => api.get(`/api/teachers/${teacherId}/action-plan`),
  save: (teacherId, payload) =>
    api.post(`/api/teachers/${teacherId}/action-plan`, payload),
};

export const gradebookApi = {
  list: () => api.get("/api/integrations/gradebook"),
  connect: (payload) => api.post("/api/integrations/gradebook", payload),
};

export const adminApi = {
  setScoringMode: (scoring_mode) =>
    api.post("/api/admin/preferences/scoring-mode", { scoring_mode }),
};

export const opsApi = {
  readiness: () => api.get("/api/admin/ops/readiness"),
  launchHealth: () => api.get("/api/admin/ops/launch-health"),
  backlogPriorities: () => api.get("/api/admin/ops/backlog-priorities"),
};

export default api;

