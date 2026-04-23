import axios from "axios";
import { toast } from "sonner";
import { runtimeConfig } from "@/lib/runtimeConfig";
import {
  extractErrorMessage,
  handleGlobalServerError,
  isAuthError,
  isNetworkError,
  isPermissionError,
  isServerError,
  isValidationError,
  setOfflineStatus,
} from "@/lib/apiErrorHandler";
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
let authRedirectTimer = null;
let authRedirectScheduled = false;

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

function isAuthBootstrapRequest(error) {
  const url = String(error?.config?.url || "");
  return (
    url.includes("/api/auth/login")
    || url.includes("/api/auth/register")
    || url.includes("/api/auth/request-access")
    || url.includes("/api/auth/password-reset/request")
    || url.includes("/api/auth/password-reset/confirm")
  );
}

function scheduleAuthRedirectToLogin() {
  if (typeof window === "undefined" || authRedirectScheduled) {
    return;
  }
  authRedirectScheduled = true;
  if (authRedirectTimer) {
    window.clearTimeout(authRedirectTimer);
  }
  authRedirectTimer = window.setTimeout(() => {
    authRedirectScheduled = false;
    authRedirectTimer = null;
    if (window.location.pathname !== "/login") {
      window.location.assign("/login");
    }
  }, 1500);
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
  (response) => {
    setOfflineStatus(false);
    return response;
  },
  (error) => {
    if (isNetworkError(error)) {
      setOfflineStatus(true);
      return Promise.reject(error);
    }

    setOfflineStatus(false);

    if (isAuthError(error)) {
      if (!isAuthBootstrapRequest(error) && typeof window !== "undefined" && window.location.pathname !== "/login") {
        if (unauthorizedHandler) {
          unauthorizedHandler(error);
        }
        toast.error("Your session has expired — please log in again");
        scheduleAuthRedirectToLogin();
      }
      return Promise.reject(error);
    }

    if (isPermissionError(error)) {
      toast.error("You don't have permission to do that");
      return Promise.reject(error);
    }

    if (isValidationError(error)) {
      toast.error(extractErrorMessage(error));
      return Promise.reject(error);
    }

    if (isServerError(error)) {
      handleGlobalServerError(error);
    }

    return Promise.reject(error);
  }
);

export default api;
