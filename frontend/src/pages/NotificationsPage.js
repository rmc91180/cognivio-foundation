import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Bell, CheckCheck, ClipboardList, MessageSquare, X } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, EmptyState, PageContextHeader, Panel } from "@/components/ui";
import { notificationApi } from "@/lib/api";

function typeIcon(type) {
  if (type === "recognition_earned" || type === "recognition_nominated") return Award;
  if (type === "goal_added" || type === "goal_tried") return ClipboardList;
  if (type === "observation_complete") return MessageSquare;
  return Bell;
}

function timeAgo(value) {
  const timestamp = Date.parse(value || "");
  if (Number.isNaN(timestamp)) return "";
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function groupLabel(dateValue) {
  const date = new Date(dateValue);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.floor((startToday - startDate) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This week";
  return "Earlier";
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["notifications-page", page],
    queryFn: () => notificationApi.list({ limit: 25, page }).then((res) => res.data),
  });
  const notifications = data?.items || [];
  const grouped = useMemo(() => {
    return notifications.reduce((acc, item) => {
      const label = groupLabel(item.created_at);
      acc[label] = acc[label] || [];
      acc[label].push(item);
      return acc;
    }, {});
  }, [notifications]);

  const markAllMutation = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-page"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      toast.success("Notifications marked read");
    },
  });
  const dismissMutation = useMutation({
    mutationFn: (id) => notificationApi.dismiss(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-page"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });

  return (
    <LayoutShell>
      <div className="mx-auto max-w-5xl px-6 py-6">
        <PageContextHeader
          breadcrumbs={[{ label: "Dashboard", to: "/dashboard" }, { label: "Notifications" }]}
          title="Notifications"
          description="A full history of Cognivio updates, reminders, and coaching follow-up."
          actions={
            <Button variant="secondary" onClick={() => markAllMutation.mutate()} disabled={markAllMutation.isPending}>
              <CheckCheck className="mr-2 h-4 w-4" />
              Mark all as read
            </Button>
          }
        />

        <Panel>
          {isLoading ? <div className="text-sm text-slate-500">Loading notifications...</div> : null}
          {!isLoading && !notifications.length ? (
            <EmptyState title="You're all caught up." description="New feedback, goals, recognition, and reminders will appear here." />
          ) : null}
          <div className="space-y-6">
            {["Today", "Yesterday", "This week", "Earlier"].map((label) =>
              grouped[label]?.length ? (
                <section key={label}>
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</h2>
                  <div className="space-y-2">
                    {grouped[label].map((item) => {
                      const Icon = typeIcon(item.type || item.notification_type);
                      const actionUrl = item.action_url || item.cta_url;
                      return (
                        <article key={item.id} className={`flex gap-3 rounded-lg border p-4 ${item.read ? "border-slate-200 bg-white" : "border-teal-200 bg-teal-50/50"}`}>
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h3 className="text-sm font-semibold text-slate-950">{item.title}</h3>
                                <p className="mt-1 text-sm leading-6 text-slate-600">{item.body || item.message}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => dismissMutation.mutate(item.id)}
                                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                aria-label="Dismiss"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-3">
                              <span className="text-xs font-medium text-slate-400">{timeAgo(item.created_at)}</span>
                              {actionUrl ? (
                                <Link to={actionUrl} className="text-xs font-semibold text-primary hover:text-primary/80">
                                  Open
                                </Link>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null
            )}
          </div>
          <div className="mt-6 flex justify-between">
            <Button variant="secondary" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              Previous
            </Button>
            <Button variant="secondary" disabled={notifications.length < 25} onClick={() => setPage((value) => value + 1)}>
              Next
            </Button>
          </div>
        </Panel>
      </div>
    </LayoutShell>
  );
}
