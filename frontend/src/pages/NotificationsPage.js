import React, { useEffect, useState } from "react";
import api from "@/lib/api";

const normalizeNotifications = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.notifications)) return payload.notifications;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const formatDate = (value) => {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadNotifications = async () => {
      setStatus("loading");
      setError("");

      try {
        const response = await api.get("/notifications");
        if (!active) return;

        setNotifications(normalizeNotifications(response?.data));
        setStatus("ready");
      } catch (err) {
        if (!active) return;

        setError(
          err?.response?.data?.detail ||
            err?.message ||
            "Notifications are not available right now."
        );
        setNotifications([]);
        setStatus("error");
      }
    };

    loadNotifications();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Cognivio
          </p>
          <h1 className="text-3xl font-bold text-slate-900">Notifications</h1>
          <p className="mt-2 text-slate-600">
            Review account, access, feedback, and system updates.
          </p>
        </div>

        {status === "loading" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-slate-600">Loading notifications…</p>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h2 className="font-semibold text-amber-900">
              Notifications could not be loaded
            </h2>
            <p className="mt-2 text-sm text-amber-800">{error}</p>
          </div>
        )}

        {status === "ready" && notifications.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-slate-900">No notifications yet</h2>
            <p className="mt-2 text-sm text-slate-600">
              New updates will appear here when they are available.
            </p>
          </div>
        )}

        {status === "ready" && notifications.length > 0 && (
          <div className="space-y-3">
            {notifications.map((notification, index) => {
              const id = notification.id || notification._id || index;
              const title =
                notification.title ||
                notification.subject ||
                notification.type ||
                "Notification";
              const message =
                notification.message ||
                notification.body ||
                notification.detail ||
                "";
              const createdAt =
                notification.created_at ||
                notification.createdAt ||
                notification.updated_at ||
                notification.updatedAt;

              return (
                <article
                  key={id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="font-semibold text-slate-900">{title}</h2>
                      {message && (
                        <p className="mt-1 text-sm leading-6 text-slate-600">
                          {message}
                        </p>
                      )}
                    </div>
                    {createdAt && (
                      <time className="shrink-0 text-xs text-slate-500">
                        {formatDate(createdAt)}
                      </time>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}