import axios from "axios";
import { runtimeConfig } from "@/lib/runtimeConfig";
import { getPreviewTargetUserId } from "@/lib/previewMode";

const API_BASE_URL = runtimeConfig.backendUrl;
const CSRF_COOKIE_NAME = "cognivio_csrf";

if (!API_BASE_URL) {
  // eslint-disable-next-line no-console
  console.error("REACT_APP_BACKEND_URL is not configured; API calls will fail.");
}

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

let unauthorizedHandler = null;

function readCookie(name) {
  if (typeof document === "undefined") {
    return "";
  }
  const target = `${name}=`;
  const cookies = document.cookie ? document.cookie.split(";") : [];
  for (const raw of cookies) {
    const entry = raw.trim();
    if (entry.startsWith(target)) {
      return decodeURIComponent(entry.slice(target.length));
    }
  }
  return "";
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = typeof handler === "function" ? handler : null;
}

api.interceptors.request.use((config) => {
  const language = localStorage.getItem("cognivio_language") || "en";
  const previewTargetUserId = getPreviewTargetUserId();
  if (previewTargetUserId) {
    // eslint-disable-next-line no-param-reassign
    config.headers["X-Cognivio-Preview-User"] = previewTargetUserId;
  }
  const method = String(config.method || "get").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrf = readCookie(CSRF_COOKIE_NAME);
    if (csrf) {
      // eslint-disable-next-line no-param-reassign
      config.headers["X-CSRF-Token"] = csrf;
    }
  }
  // eslint-disable-next-line no-param-reassign
  config.headers["Accept-Language"] = language;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && unauthorizedHandler) {
      unauthorizedHandler(error);
    }
    return Promise.reject(error);
  }
);

export default api;
