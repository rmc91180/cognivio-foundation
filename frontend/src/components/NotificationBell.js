import React, { useEffect, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Bell, CheckCheck, ClipboardList, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { notificationApi } from "@/lib/api";

function getItems(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.items || payload?.notifications || [];
}

function getUnreadCount(payload, items) {
  if (Number.isFinite(Number(payload?.unread_count))) return Number(payload.unread_count);
  return items.filter((item) => !item.read && !item.read_at).length;
}

function getNotificationType(item) {
  return item.type || item.notification_type || "notification";
}

function getNotificationTitle(item) {
  if (item.title) return item.title;
  const type = getNotificationType(item);
  if (type === "recognition_earned") return "Recognition earned";
  if (type === "recognition_exemplar_eligible") return "Recognition ready for review";
  return "Notification";
}

function getNotificationLink(item) {
  if (item.cta_url) return item.cta_url;
  const type = getNotificationType(item);
  if (type === "recognition_earned") return "/my-badges";
  if (type === "recognition_exemplar_eligible") return "/recognition-review";
  if (item.payload?.video_id) return `/videos/${item.payload.video_id}`;
  return null;
}

function timeAgo(value) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function NotificationIcon({ type }) {
  const Icon =
    type === "recognition_earned"
      ? Award
      : type === "recognition_exemplar_eligible"
        ? ClipboardList
        : Bell;
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-primary">
      <Icon className="h-4 w-4" />
    </span>
  );
}

export function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const previousUnreadRef = useRef(null);
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationApi.list({ limit: 10 }).then((res) => res.data),
    refetchInterval: 60_000,
  });

  const { data: unreadData } = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: () => notificationApi.unreadCount().then((res) => res.data),
    refetchInterval: 60_000,
  });

  const items = useMemo(() => getItems(data), [data]);
  const unreadCount = Number.isFinite(Number(unreadData?.count))
    ? Number(unreadData.count)
    : getUnreadCount(data, items);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default" &&
      !localStorage.getItem("cognivio-notification-permission-prompted")
    ) {
      setShowPermissionPrompt(true);
    }
  }, []);

  useEffect(() => {
    if (previousUnreadRef.current !== null && unreadCount > previousUnreadRef.current) {
      toast("You have a new notification");
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        const newest = items.find((item) => !item.read && !item.read_at);
        if (newest) new Notification(getNotificationTitle(newest), { body: newest.body || newest.message || "" });
      }
    }
    previousUnreadRef.current = unreadCount;
  }, [unreadCount, items]);

  const markReadMutation = useMutation({
    mutationFn: (id) => notificationApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });

  const openNotification = (item) => {
    if (!item.read && !item.read_at) {
      markReadMutation.mutate(item.id);
    }
    const link = getNotificationLink(item);
    if (link) navigate(link);
  };

  return (
    <>
    {showPermissionPrompt ? (
      <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-teal-200 bg-white p-4 shadow-xl">
        <div className="text-sm font-semibold text-slate-900">Allow Cognivio to notify you when new feedback arrives?</div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={async () => {
              localStorage.setItem("cognivio-notification-permission-prompted", "true");
              setShowPermissionPrompt(false);
              if ("Notification" in window) await Notification.requestPermission();
            }}
            className="rounded-md bg-teal-600 px-3 py-2 text-xs font-semibold text-white"
          >
            Allow
          </button>
          <button
            type="button"
            onClick={() => {
              localStorage.setItem("cognivio-notification-permission-prompted", "true");
              setShowPermissionPrompt(false);
            }}
            className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
          >
            Not now
          </button>
        </div>
      </div>
    ) : null}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Notifications</div>
              <div className="text-xs text-slate-500">{unreadCount} unread</div>
            </div>
            <button
              type="button"
              onClick={() => markAllReadMutation.mutate()}
              disabled={!unreadCount || markAllReadMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto py-1">
            {items.length ? (
              items.map((item) => {
                const type = getNotificationType(item);
                const link = getNotificationLink(item);
                const unread = !item.read && !item.read_at;
                return (
                  <DropdownMenu.Item key={item.id} asChild>
                    <button
                      type="button"
                      onClick={() => openNotification(item)}
                      className="flex w-full gap-3 px-4 py-3 text-left outline-none hover:bg-slate-50 focus:bg-slate-50"
                    >
                      <NotificationIcon type={type} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900">{getNotificationTitle(item)}</span>
                          {unread ? <span className="mt-1 h-2 w-2 rounded-full bg-rose-600" /> : null}
                        </span>
                        {item.message ? (
                          <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-600">{item.message}</span>
                        ) : null}
                        <span className="mt-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                          {timeAgo(item.created_at)}
                          {link ? <ExternalLink className="h-3 w-3" /> : null}
                        </span>
                      </span>
                    </button>
                  </DropdownMenu.Item>
                );
              })
            ) : (
              <div className="px-4 py-8 text-center text-sm text-slate-500">No notifications yet</div>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    </>
  );
}
