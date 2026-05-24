import { getNormalizedApiErrorMessage } from "@/lib/apiErrors";

const REASON_MESSAGES = {
  notification_delivery_failed:
    "Access request received. Email notification may be delayed, but your request is waiting for review.",
};

export function getAuthErrorMessage(error, fallback) {
  return getNormalizedApiErrorMessage(error, fallback);
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
