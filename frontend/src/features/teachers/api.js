import api from "@/lib/apiClient";

export const teacherApi = {
  list: () => api.get("/api/teachers"),
  create: (payload) => api.post("/api/teachers", payload),
  createSelfProfile: (payload) => api.post("/api/teachers/self-profile", payload),
  currentProfile: () => api.get("/api/teachers/me/profile"),
  updateCurrentProfile: (payload) => api.patch("/api/teachers/me/profile", payload),
  myReferenceImages: () => api.get("/api/teachers/me/reference-images"),
  uploadReferenceImage: (formData) =>
    api.post("/api/teachers/me/reference-images", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  deleteReferenceImage: (imageId) => api.delete(`/api/teachers/me/reference-images/${imageId}`),
  myDashboard: (params) => api.get("/api/teachers/me/dashboard", { params }),
  mySearch: (params) => api.get("/api/teachers/me/search", { params }),
  myLessons: (params) => api.get("/api/teachers/me/lessons", { params }),
  myCoaching: () => api.get("/api/teachers/me/coaching"),
  createReflection: (payload) => api.post("/api/teachers/me/reflections", payload),
  myRecognition: () => api.get("/api/teachers/me/recognition"),
  get: (id) => api.get(`/api/teachers/${id}`),
  update: (id, payload) => api.patch(`/api/teachers/${id}`, payload),
  conferencePrep: (id) => api.get(`/api/teachers/${id}/conference-prep`),
  conferenceAgenda: (id) => api.get(`/api/teachers/${id}/conference-agenda`),
  evidenceCatalog: (id) => api.get(`/api/teachers/${id}/evidence-catalog`),
  adaptiveSupport: (id) => api.get(`/api/teachers/${id}/adaptive-support`),
  publishConferenceAgenda: (id, payload) =>
    api.post(`/api/teachers/${id}/conference-agenda`, payload),
  coachingTimeline: (id) => api.get(`/api/teachers/${id}/coaching-timeline`),
  coachingTasks: (params) => api.get("/api/coaching/tasks", { params }),
  getPeerRecommendations: (id) =>
    api.get(`/api/teachers/${id}/peer-recommendations`),
};

export const privacyProfileApi = {
  get: (teacherId) => api.get(`/api/teachers/${teacherId}/privacy-profile`),
  upload: (teacherId, formData) =>
    api.post(`/api/teachers/${teacherId}/privacy-profile`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  remove: (teacherId) =>
    api.delete(`/api/teachers/${teacherId}/privacy-profile`),
};

export const observationApi = {
  create: (payload) => api.post("/api/observations", payload),
  listForTeacher: (teacherId) =>
    api.get(`/api/teachers/${teacherId}/observations`),
  listForVideo: (videoId) =>
    api.get(`/api/videos/${videoId}/observations`),
  update: (id, payload) => api.patch(`/api/observations/${id}`, payload),
};

export const actionPlanApi = {
  get: (teacherId) => api.get(`/api/teachers/${teacherId}/action-plan`),
  history: (teacherId) => api.get(`/api/teachers/${teacherId}/action-plan/history`),
  save: (teacherId, payload) =>
    api.post(`/api/teachers/${teacherId}/action-plan`, payload),
};
