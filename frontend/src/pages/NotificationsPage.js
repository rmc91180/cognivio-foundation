import React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, EmptyState, LoadingState, PageHeader, Panel } from "@/components/ui";
import { notificationApi } from "@/lib/api";

const normalizeNotifications = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.notifications)) return payload.notifications;
  return [];
};

const formatDate = (value) => {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(parsed));
};

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationApi.list().then((res) => res.data),
    retry: 1,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notification-unread-count"] });
    },
  });

  const notifications = normalizeNotifications(notificationsQuery.data);
  const unreadCount = notificationsQuery.data?.unread_count ?? notifications.filter((item) => !item.read && !item.read_at).length;

  return (
    <LayoutShell>
      <div className="mx-auto max-w-5xl px-6 py-6">
        <PageHeader
          title="Notifications"
          description="Lesson updates, reflection notes, and recognition moments will appear here."
          actions={
            unreadCount > 0 ? (
              <Button type="button" variant="secondary" onClick={() => markAllReadMutation.mutate()} disabled={markAllReadMutation.isPending}>
                Mark all as read
              </Button>
            ) : null
          }
        />

        {notificationsQuery.isLoading ? <LoadingState message="Loading notifications..." /> : null}

        {notificationsQuery.isError ? (
          <Panel className="border-amber-200 bg-amber-50 text-sm text-amber-900">
            Notifications are quiet right now. Check again in a moment.
          </Panel>
        ) : null}

        {!notificationsQuery.isLoading && !notificationsQuery.isError && notifications.length === 0 ? (
          <EmptyState
            title="No notifications yet"
            message="When a lesson is ready, a reflection is shared, or recognition is earned, you’ll see it here."
          />
        ) : null}

        {!notificationsQuery.isLoading && !notificationsQuery.isError && notifications.length > 0 ? (
          <div className="space-y-3">
            {notifications.map((notification, index) => {
              const id = notification.id || notification._id || index;
              const title = notification.title || notification.subject || "New update";
              const body = notification.body || notification.message || "There is something ready for you to review.";
              const href = notification.cta_url || notification.action_url || notification.link;
              const unread = !notification.read && !notification.read_at;

              return (
                <article key={id} className={`rounded-md border p-4 ${unread ? "border-primary/20 bg-primary/5" : "border-slate-200 bg-white"}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold text-slate-900">{title}</h2>
                        {unread ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Unread</span> : null}
                      </div>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{body}</p>
                      {href ? (
                        <Link className="mt-3 inline-flex text-sm font-medium text-primary hover:text-primary/80" to={href}>
                          Open
                        </Link>
                      ) : null}
                    </div>
                    <time className="shrink-0 text-xs text-slate-500">{formatDate(notification.created_at || notification.updated_at)}</time>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </div>
    </LayoutShell>
  );
}
