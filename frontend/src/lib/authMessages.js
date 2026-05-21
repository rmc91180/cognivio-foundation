const REASON_MESSAGES = {
  access_request_already_pending:
    "Your access request is already pending review. You can sign in after it is approved.",
  account_already_exists:
    "An approved account already exists for this email. Sign in with that email or reset the password.",
  account_disabled:
    "This account is not active. Contact your Cognivio administrator for help.",
  account_pending_approval:
    "Your access request is pending approval.",
  account_rejected:
    "This access request was not approved. You can submit a new request if your institution details have changed.",
  duplicate_email: "A request or account already exists for this email.",
  invalid_credentials: "Invalid email or password.",
  notification_delivery_failed:
    "Access request received. Email notification may be delayed, but your request is waiting for review.",
};

function messageFromDetail(detail) {
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    if (typeof detail.message === "string" && detail.message.trim()) {
      return detail.message;
    }

    if (typeof detail.reason_code === "string" && REASON_MESSAGES[detail.reason_code]) {
      return REASON_MESSAGES[detail.reason_code];
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

export function getAuthErrorMessage(error, fallback) {
  const data = error?.response?.data || {};
  const directReason = data.reason_code || data.error_code;
  if (directReason && REASON_MESSAGES[directReason]) {
    return REASON_MESSAGES[directReason];
  }

  return messageFromDetail(data.detail) || fallback;
}

export function getAccessRequestSuccessMessage(data, fallback) {
  const warning =
    data?.notification?.warning ||
    (data?.email_warning ? "notification_delivery_failed" : null);

  if (warning && REASON_MESSAGES[warning]) {
    return REASON_MESSAGES[warning];
  }

  return data?.message || fallback;
}
