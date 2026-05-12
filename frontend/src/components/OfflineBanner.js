import React, { useEffect, useState } from "react";

export default function OfflineBanner({
  message = "You appear to be offline. Some Cognivio features may be unavailable until your connection is restored.",
  onlineMessage = "Connection restored.",
  showOnlineConfirmation = true,
}) {
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [showRestored, setShowRestored] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);

      if (showOnlineConfirmation) {
        setShowRestored(true);
        window.setTimeout(() => setShowRestored(false), 3000);
      }
    };

    const handleOffline = () => {
      setShowRestored(false);
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [showOnlineConfirmation]);

  if (!isOnline) {
    return (
      <div
        role="status"
        className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
      >
        <div className="mx-auto flex max-w-7xl items-center gap-2">
          <span aria-hidden="true">⚠️</span>
          <span>{message}</span>
        </div>
      </div>
    );
  }

  if (showRestored) {
    return (
      <div
        role="status"
        className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900"
      >
        <div className="mx-auto flex max-w-7xl items-center gap-2">
          <span aria-hidden="true">✓</span>
          <span>{onlineMessage}</span>
        </div>
      </div>
    );
  }

  return null;
}

export { OfflineBanner };