import axios from "axios";
import { runtimeConfig } from "@/lib/runtimeConfig";
import { clearPreviewSession, getPreviewTargetUserId } from "@/lib/previewMode";
import { attachNormalizedApiError, AUTH_STALE_EVENT } from "@/lib/apiErrors";

const API_BASE_URL = runtimeConfig.backendUrl;

if (!API_BASE_URL) {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.error("REACT_APP_BACKEND_URL is not configured; API calls will fail.");
  }
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/request-access",
  "/api/auth/password-reset/request",
  "/api/auth/password-reset/confirm",
  "/api/institutions/lookup",
  "/api/health/version",
]);

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("cognivio_token");
  const language = localStorage.getItem("cognivio_language") || "en";
  const requestPath = String(config.url || "").split("?")[0];
  // eslint-disable-next-line no-param-reassign
  config.headers = config.headers || {};
  if (token && !PUBLIC_API_PATHS.has(requestPath)) {
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

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const normalizedError = attachNormalizedApiError(error);
    const requestPath = String(error?.config?.url || "").split("?")[0];
    const protectedRequest = !PUBLIC_API_PATHS.has(requestPath);

    if (protectedRequest && normalizedError.normalized?.isAuthStale) {
      localStorage.removeItem("cognivio_token");
      clearPreviewSession();
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(AUTH_STALE_EVENT, {
            detail: normalizedError.normalized,
          })
        );
      }
    }

    return Promise.reject(normalizedError);
  }
);

export default api;
