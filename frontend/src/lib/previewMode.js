const PREVIEW_STORAGE_KEY = "cognivio_preview_user";

export function getPreviewSession() {
  try {
    const raw = localStorage.getItem(PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setPreviewSession(session) {
  if (!session?.userId) return;
  localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(session));
}

export function clearPreviewSession() {
  localStorage.removeItem(PREVIEW_STORAGE_KEY);
}

export function getPreviewTargetUserId() {
  return getPreviewSession()?.userId || "";
}
