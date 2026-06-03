import api from "@/lib/apiClient";

export const videoApi = {
  upload: (formData, config = {}) =>
    api.post("/api/videos/upload", formData, {
      // Large lesson videos must not be aborted by the shared 30s client
      // default while bytes are still streaming. Disable the timeout for the
      // upload request ONLY (per-request; the shared apiClient default is
      // unchanged for every other call). Callers pass onUploadProgress, so the
      // UI keeps showing progress — no silent infinite hang.
      timeout: 0,
      ...config,
    }),
  list: (params) => api.get("/api/videos", { params }),
  status: (videoId) => api.get(`/api/videos/${videoId}/status`),
  detail: (videoId) => api.get(`/api/videos/${videoId}`),
  retry: (videoId) => api.post(`/api/videos/${videoId}/retry`),
  retryPrivacy: (videoId) => api.post(`/api/videos/${videoId}/privacy/retry`),
  analysisMoments: (videoId) => api.get(`/api/admin/videos/${videoId}/analysis-moments`),
  comments: (videoId) => api.get(`/api/videos/${videoId}/comments`),
  createComment: (videoId, payload) => api.post(`/api/videos/${videoId}/comments`, payload),
  updateComment: (videoId, commentId, payload) =>
    api.patch(`/api/videos/${videoId}/comments/${commentId}`, payload),
  deleteComment: (videoId, commentId) => api.delete(`/api/videos/${videoId}/comments/${commentId}`),
  audioAnalysis: (videoId) => api.get(`/api/videos/${videoId}/audio-analysis`),
  // PR C9.5 PART 4 / PART 6 — corrective-action endpoints behind the eligibility map.
  runAudioAnalysis: (videoId) => api.post(`/api/videos/${videoId}/audio/run`),
  reprojectFeedback: (videoId) => api.post(`/api/videos/${videoId}/feedback/reproject`),
};

export const evidenceApi = {
  get: (assessmentId) => api.get(`/api/assessments/${assessmentId}/evidence`),
};
