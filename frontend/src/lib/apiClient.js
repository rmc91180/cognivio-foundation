import axios from "axios";
import { runtimeConfig } from "@/lib/runtimeConfig";
import { getPreviewTargetUserId } from "@/lib/previewMode";

const API_BASE_URL = runtimeConfig.backendUrl;

if (!API_BASE_URL) {
  // eslint-disable-next-line no-console
  console.error("REACT_APP_BACKEND_URL is not configured; API calls will fail.");
}

const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("cognivio_token");
  const language = localStorage.getItem("cognivio_language") || "en";
  if (token) {
    // eslint-disable-next-line no-param-reassign
    config.headers.Authorization = `Bearer ${token}`;
  }
  const previewTargetUserId = getPreviewTargetUserId();
  if (previewTargetUserId) {
    // eslint-disable-next-line no-param-reassign
    config.headers["X-Cognivio-Preview-User"] = previewTargetUserId;
  }
  // eslint-disable-next-line no-param-reassign
  config.headers["Accept-Language"] = language;
  return config;
});

export default api;
