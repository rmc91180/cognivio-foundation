import api from "@/lib/apiClient";

export const teacherApi = {
  list: () => api.get("/api/teachers"),
  create: (payload) => api.post("/api/teachers", payload),
  get: (id) => api.get(`/api/teachers/${id}`),
  update: (id, payload) => api.patch(`/api/teachers/${id}`, payload),
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
  save: (teacherId, payload) =>
    api.post(`/api/teachers/${teacherId}/action-plan`, payload),
};
