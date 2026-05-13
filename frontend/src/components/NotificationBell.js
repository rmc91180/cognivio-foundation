import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";

const normalizeNotifications = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.notifications)) return payload.notifications;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const getUnreadCount = (notifications) =>
  notifications.filter((item) => {
    if (item?.read === false) return true;
    if (item?.is_read === false) return true;
    if (item?.read_at === null) return true;
    if (item?.readAt === null) return true;
    return false;
  }).length;

export default function NotificationBell({
  count,
  unreadCount,
  notifications: providedNotifications,
  to = "/notifications",
  className = "",
}) {
  const [notifications, setNotifications] = useState(
    Array.isArray(providedNotifications) ? providedNotifications : []
  );
  const [loaded, setLoaded] = useState(Boolean(providedNotifications));

  useEffect(() => {
    let active = true;

    if (Array.isArray(providedNotifications)) {
      setNotifications(providedNotifications);
      setLoaded(true);
      return () => {
        active = false;
      };
    }

    const loadNotifications = async () => {
      try {
        const response = await api.get("/api/notifications");
        if (!active) return;
        setNotifications(normalizeNotifications(response?.data));
      } catch (error) {
        if (!active) return;

        if (error?.response?.status !== 404 && process.env.NODE_ENV === "development") {
          console.warn("NotificationBell could not load notifications", error);
        }

        setNotifications([]);
      } finally {
        if (active) {
          setLoaded(true);
        }
      }
    };

    loadNotifications();

    return () => {
      active = false;
    };
  }, [providedNotifications]);

  const resolvedCount = useMemo(() => {
    if (typeof count === "number") return count;
    if (typeof unreadCount === "number") return unreadCount;
    return getUnreadCount(notifications);
  }, [count, unreadCount, notifications]);

  const label =
    resolvedCount > 0
      ? `${resolvedCount} unread notification${resolvedCount === 1 ? "" : "s"}`
      : loaded
        ? "No unread notifications"
        : "Loading notifications";

  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className={`relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 ${className}`}
    >
      <span aria-hidden="true" className="text-lg leading-none">
        🔔
      </span>

      {resolvedCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white">
          {resolvedCount > 99 ? "99+" : resolvedCount}
        </span>
      )}
    </Link>
  );
}

export { NotificationBell };