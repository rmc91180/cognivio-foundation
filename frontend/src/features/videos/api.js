import api from "@/lib/apiClient";

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
  analysisMoments: (videoId) => api.get(`/api/admin/videos/${videoId}/analysis-moments`),
  audioAnalysis: (videoId) => api.get(`/api/videos/${videoId}/audio-analysis`),
  listComments: (videoId) => api.get(`/api/videos/${videoId}/comments`),
  createComment: (videoId, payload) => api.post(`/api/videos/${videoId}/comments`, payload),
  updateComment: (videoId, commentId, payload) =>
    api.patch(`/api/videos/${videoId}/comments/${commentId}`, payload),
  deleteComment: (videoId, commentId) =>
    api.delete(`/api/videos/${videoId}/comments/${commentId}`),
};

export const evidenceApi = {
  get: (assessmentId) => api.get(`/api/assessments/${assessmentId}/evidence`),
};
