export const AUTH_STALE_EVENT = "cognivio:auth-stale";

const SAFE_REASON_MESSAGES = {
  access_request_already_pending:
    "Your access request is already pending review. You can sign in after it is approved.",
  account_already_exists:
    "An approved account already exists for this email. Sign in with that email or reset the password.",
  account_disabled:
    "This account is not active. Contact your Cognivio administrator for help.",
  account_pending_approval: "Your access request is pending approval.",
  account_rejected:
    "This access request was not approved. You can submit a new request if your institution details have changed.",
  duplicate_email: "A request or account already exists for this email.",
  forbidden_tenant_access: "You do not have access to that Cognivio workspace.",
  invalid_credentials: "Invalid email or password.",
  invalid_authentication_token: "Your session expired. Please sign in again.",
  stale_session: "Your session expired. Please sign in again.",
  token_expired: "Your session expired. Please sign in again.",
  notification_delivery_failed:
    "Access request received. Email notification may be delayed, but your request is waiting for review.",
};

function pickReasonCode(data) {
  const detail = data?.detail;
  if (typeof data?.reason_code === "string") return data.reason_code;
  if (typeof data?.error_code === "string") return data.error_code;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    if (typeof detail.reason_code === "string") return detail.reason_code;
    if (typeof detail.error_code === "string") return detail.error_code;
  }
  return null;
}

function pickDetailMessage(detail) {
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    if (typeof detail.message === "string" && detail.message.trim()) {
      return detail.message;
    }
  }

  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    if (typeof first === "string" && first.trim()) {
      return first;
    }
    if (first && typeof first.msg === "string" && first.msg.trim()) {
      return first.msg;
    }
  }

  return null;
}

function fallbackForStatus(status) {
  if (status === 400) return "Please check the request and try again.";
  if (status === 401) return "Your session expired. Please sign in again.";
  if (status === 403) return "You do not have access to that Cognivio workspace.";
  if (status === 409) return "A request or record already exists.";
  if (status === 422) return "Please check the highlighted fields and try again.";
  if (status === 429) return "Too many attempts. Please wait a moment and try again.";
  if (status >= 500) return "Cognivio hit an unexpected server issue. Please try again or contact support.";
  return "Something went wrong. Please try again.";
}

export function normalizeApiError(error) {
  if (error?.normalized) {
    return error.normalized;
  }

  if (!error?.response) {
    const timedOut = error?.code === "ECONNABORTED";
    return {
      status: 0,
      reason_code: timedOut ? "api_timeout" : "api_unreachable",
      message: timedOut
        ? "Cognivio API timed out. Please check your connection and try again."
        : "Unable to reach Cognivio API from this site. Please open app.cognivio.live and try again.",
      action: "open_app_domain",
      isNetworkError: true,
    };
  }

  const { status, data = {} } = error.response;
  const reasonCode = pickReasonCode(data);
  const structuredMessage = reasonCode ? SAFE_REASON_MESSAGES[reasonCode] : null;
  const detailMessage = pickDetailMessage(data.detail);

  return {
    status,
    reason_code: reasonCode,
    action: data.action || data.detail?.action || null,
    message: structuredMessage || detailMessage || fallbackForStatus(status),
    isAuthStale:
      status === 401 &&
      !["invalid_credentials", "account_pending_approval", "account_rejected"].includes(reasonCode || ""),
  };
}

export function attachNormalizedApiError(error) {
  const normalized = normalizeApiError(error);
  // eslint-disable-next-line no-param-reassign
  error.normalized = normalized;
  return error;
}

export function getNormalizedApiErrorMessage(error, fallback) {
  return normalizeApiError(error).message || fallback;
}

