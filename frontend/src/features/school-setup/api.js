import api from "@/lib/apiClient";

export const schoolApi = {
  list: () => api.get("/api/schools"),
  create: (payload) => api.post("/api/schools", payload),
};

export const frameworkApi = {
  list: () => api.get("/api/frameworks"),
  get: (frameworkType) => api.get(`/api/frameworks/${frameworkType}`),
  currentSelection: () => api.get("/api/frameworks/selection/current"),
  saveSelection: (payload) => api.post("/api/frameworks/selection", payload),
  uploadRubric: (formData) =>
    api.post("/api/frameworks/upload-rubric", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  listCustomDomains: () => api.get("/api/frameworks/custom-domains"),
  createCustomDomain: (payload) => api.post("/api/frameworks/custom-domains", payload),
  addCustomElement: (domainId, payload) =>
    api.post(`/api/frameworks/custom-domains/${domainId}/elements`, payload),
  deleteCustomDomain: (domainId) =>
    api.delete(`/api/frameworks/custom-domains/${domainId}`),
};

export const recordingPolicyApi = {
  list: () => api.get("/api/recording-policies"),
  create: (payload) => api.post("/api/recording-policies", payload),
  update: (id, payload) => api.patch(`/api/recording-policies/${id}`, payload),
};

export const recordingComplianceApi = {
  get: (teacherId) =>
    api.get("/api/recording-compliance", { params: { teacher_id: teacherId } }),
  summary: () => api.get("/api/recording-compliance/summary"),
  remind: (teacherId) =>
    api.post(
      "/api/recording-compliance/remind",
      new URLSearchParams({ teacher_id: teacherId })
    ),
};

export const curriculumApi = {
  upload: (formData) =>
    api.post("/api/curricula", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  list: (teacherId) =>
    api.get("/api/curricula", { params: { teacher_id: teacherId } }),
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
  list: (teacherId) =>
    api.get("/api/syllabi", { params: { teacher_id: teacherId } }),
};
