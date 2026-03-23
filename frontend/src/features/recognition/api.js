import api from "@/lib/apiClient";

export const recognitionApi = {
  teacherSummary: (teacherId) => api.get(`/api/teachers/${teacherId}/recognition`),
  video: (videoId) => api.get(`/api/videos/${videoId}/recognition`),
  updateOptIn: (videoId, payload) =>
    api.post(`/api/videos/${videoId}/recognition/opt-in`, payload),
  reviewQueue: () => api.get("/api/recognition/review-queue"),
  review: (videoId, payload) =>
    api.post(`/api/videos/${videoId}/recognition/review`, payload),
};

export const exemplarApi = {
  submit: (videoId, payload) =>
    api.post(`/api/videos/${videoId}/exemplar/submit`, payload),
  reviewQueue: () => api.get("/api/exemplar-library/review-queue"),
  review: (submissionId, payload) =>
    api.post(`/api/exemplar-library/${submissionId}/review`, payload),
  list: (params) => api.get("/api/exemplar-library", { params }),
};

export const shareAssetApi = {
  createSocialCard: (videoId, payload) =>
    api.post(`/api/videos/${videoId}/share/social-card`, payload),
  createEmailSignature: (videoId, payload) =>
    api.post(`/api/videos/${videoId}/share/email-signature`, payload),
};
