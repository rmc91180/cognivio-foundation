import api from "@/lib/apiClient";

export const assessmentApi = {
  list: (params) => api.get("/api/assessments", { params }),
  get: (id) => api.get(`/api/assessments/${id}`),
  roster: (params) => api.get("/api/roster", { params }),
  dashboardDomainTrends: (params) =>
    api.get("/api/dashboard/domain-trends", { params }),
  dashboardLeadershipInsights: (params) =>
    api.get("/api/dashboard/leadership-insights", { params }),
  dashboardIntelligence: () => api.get("/api/dashboard/intelligence"),
  cohortAnalytics: (params) =>
    api.get("/api/dashboard/cohort-analytics", { params }),
  supervisorCalibration: () =>
    api.get("/api/dashboard/supervisor-calibration"),
  seedDemoData: () => api.post("/api/seed-demo-data"),
  teacherDashboard: (teacherId, params) =>
    api.get(`/api/teachers/${teacherId}/dashboard`, { params }),
  teacherSummaryInsights: (teacherId) =>
    api.get(`/api/teachers/${teacherId}/summary-insights`),
  teacherSummaryReflection: (teacherId) =>
    api.get(`/api/teachers/${teacherId}/summary-reflection`),
  teacherReflectionHistory: (teacherId) =>
    api.get(`/api/teachers/${teacherId}/reflection-history`),
  saveTeacherSummaryReflection: (teacherId, payload) =>
    api.post(`/api/teachers/${teacherId}/summary-reflection`, payload),
  createAdminOverride: (assessmentId, payload) =>
    api.post(`/api/assessments/${assessmentId}/admin-override`, payload),
  listAdminOverrides: (assessmentId) =>
    api.get(`/api/assessments/${assessmentId}/admin-overrides`),
  submitFeedback: (assessmentId, payload) =>
    api.post(`/api/assessments/${assessmentId}/feedback`, payload),
  listFeedback: (assessmentId) =>
    api.get(`/api/assessments/${assessmentId}/feedback`),
};

export const adherenceApi = {
  get: (assessmentId) =>
    api.get(`/api/assessments/${assessmentId}/curriculum-adherence`),
};
