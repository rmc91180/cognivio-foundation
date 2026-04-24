import { toast } from "sonner";
import logger from "@/lib/logger";

let offline = false;
let browserOnlineListenerAttached = false;
const offlineListeners = new Set();

function notifyOfflineListeners() {
  offlineListeners.forEach((listener) => {
    try {
      listener(offline);
    } catch (error) {
      logger.error("Failed notifying offline listener", error);
    }
  });
}

function ensureBrowserOnlineListener() {
  if (browserOnlineListenerAttached || typeof window === "undefined") {
    return;
  }
  browserOnlineListenerAttached = true;
  window.addEventListener("online", () => {
    setOfflineStatus(false);
  });
}

export function extractErrorMessage(error) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    if (typeof first === "string" && first.trim()) {
      return first.trim();
    }
    if (first && typeof first === "object") {
      if (typeof first.msg === "string" && first.msg.trim()) {
        return first.msg.trim();
      }
      if (typeof first.message === "string" && first.message.trim()) {
        return first.message.trim();
      }
      if (Array.isArray(first.loc) && first.loc.length && typeof first.loc[first.loc.length - 1] === "string") {
        const field = first.loc[first.loc.length - 1];
        if (typeof first.msg === "string" && first.msg.trim()) {
          return `${field}: ${first.msg.trim()}`;
        }
      }
    }
  }
  const message = error?.response?.data?.message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return "Unexpected error";
}

export function isAuthError(error) {
  return error?.response?.status === 401;
}

export function isPermissionError(error) {
  return error?.response?.status === 403;
}

export function isValidationError(error) {
  return error?.response?.status === 422;
}

export function isServerError(error) {
  return error?.response?.status >= 500;
}

export function isNetworkError(error) {
  return Boolean(error) && !error.response;
}

export function getOfflineStatus() {
  return offline;
}

export function subscribeOfflineStatus(listener) {
  ensureBrowserOnlineListener();
  offlineListeners.add(listener);
  return () => offlineListeners.delete(listener);
}

export function setOfflineStatus(nextStatus) {
  ensureBrowserOnlineListener();
  const normalized = Boolean(nextStatus);
  if (offline === normalized) {
    return;
  }
  offline = normalized;
  notifyOfflineListeners();
}

export function handleGlobalServerError(error) {
  const status = error?.response?.status;
  const url = error?.config?.url || "unknown-url";
  toast.error("Something went wrong on our end");
  logger.error(`[API ${status}] ${url}`, error);
}
