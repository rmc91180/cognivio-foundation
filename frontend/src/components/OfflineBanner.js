import React from "react";
import { useTranslation } from "react-i18next";
import { getOfflineStatus, subscribeOfflineStatus } from "@/lib/apiErrorHandler";

export function OfflineBanner() {
  const { t } = useTranslation();
  const [offline, setOffline] = React.useState(getOfflineStatus());

  React.useEffect(() => subscribeOfflineStatus(setOffline), []);

  if (!offline) {
    return null;
  }

  return (
    <div className="sticky top-0 z-40 border-b border-amber-300 bg-amber-100 px-6 py-2 text-sm text-amber-900 shadow-sm">
      <div className="mx-auto max-w-6xl">
        {t("dashboard.liveUpdatesOffline", "You're offline. We’ll reconnect automatically when your connection returns.")}
      </div>
    </div>
  );
}
