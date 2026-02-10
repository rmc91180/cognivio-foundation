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
};

export const recordingPolicyApi = {
  list: () => api.get("/api/recording-policies"),
  create: (payload) => api.post("/api/recording-policies", payload),
  update: (id, payload) => api.patch(`/api/recording-policies/${id}`, payload),
};

export const recordingComplianceApi = {
  get: (teacherId) => api.get("/api/recording-compliance", { params: { teacher_id: teacherId } }),
  summary: () => api.get("/api/recording-compliance/summary"),
};

export const assessmentApi = {
  list: (params) => api.get("/api/assessments", { params }),
  get: (id) => api.get(`/api/assessments/${id}`),
  roster: (params) => api.get("/api/roster", { params }),
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

export default api;

