import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Badge, Button, Dialog, EmptyState, ErrorState, Field, Input, LoadingState, PageHeader, Panel, Textarea } from "@/components/ui";
import { MasterAdminSectionNav } from "@/components/master-admin/MasterAdminSectionNav";
import { masterAdminApi } from "@/lib/api";

function formatTimestamp(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "—";
  }
}

export function MasterAdminSupportPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [sessionDialog, setSessionDialog] = useState(null);
  const [reason, setReason] = useState("");
  const [confirmationText, setConfirmationText] = useState("");
  const filters = useMemo(() => ({ q: searchParams.get("q") || undefined }), [searchParams]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-support", filters],
    queryFn: () => masterAdminApi.support(filters).then((res) => res.data),
  });

  const revokeSessionsMutation = useMutation({
    mutationFn: ({ userId, payload }) => masterAdminApi.revokeSessions(userId, payload),
    onSuccess: () => {
      toast.success("Sessions revoked");
      queryClient.invalidateQueries({ queryKey: ["master-admin-support"] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-user-detail"] });
      setSessionDialog(null);
      setReason("");
      setConfirmationText("");
    },
    onError: (error) => toast.error(error?.response?.data?.detail || "Unable to revoke sessions"),
  });

  const exportMutation = useMutation({
    mutationFn: (payload) => masterAdminApi.exportDiagnosticBundle(payload).then((res) => res.data),
    onSuccess: (payload) => {
      const blob = new Blob([JSON.stringify(payload.bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${payload.target_type}-${payload.target_id}-diagnostic.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Diagnostic bundle exported");
    },
    onError: (error) => toast.error(error?.response?.data?.detail || "Unable to export diagnostic bundle"),
  });

  const submitSearch = (event) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (query.trim()) next.set("q", query.trim());
    else next.delete("q");
    setSearchParams(next);
  };

  return (
    <LayoutShell>
      <div className="space-y-6 p-6">
        <PageHeader
          title="Master Admin support"
          description="Guided user-level troubleshooting, session control, and safe diagnostic export."
          meta="This is the support console for common platform issues."
          actions={
            <Button type="button" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? "Refreshing..." : "Refresh"}
            </Button>
          }
        />
        <MasterAdminSectionNav />
        <Panel className="space-y-4">
          <form className="grid gap-4 lg:grid-cols-[1.4fr,auto]" onSubmit={submitSearch}>
            <Field label="Find user">
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Email, name, or user ID" />
            </Field>
            <div className="flex items-end">
              <Button type="submit">Search</Button>
            </div>
          </form>
        </Panel>
        {isLoading ? <LoadingState message="Loading support console..." /> : null}
        {isError ? <ErrorState title="Unable to load support console" message="Refresh and try again." /> : null}
        {!isLoading && !isError ? (
          <>
            <Panel className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Matched users</h2>
                <p className="text-sm text-slate-500">Start from the user record, then branch into auth, sessions, and diagnostic export.</p>
              </div>
              {(data?.users || []).length ? (
                <div className="space-y-3">
                  {data.users.map((user) => (
                    <div key={user.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-slate-900">{user.name || "—"}</div>
                          <div className="mt-1 text-sm text-slate-600">{user.email}</div>
                        </div>
                        <div className="flex gap-2">
                          <Badge variant={user.approval_status === "approved" ? "success" : user.approval_status === "pending" ? "warning" : "danger"}>
                            {user.approval_status}
                          </Badge>
                          <Badge variant="neutral">{user.role}</Badge>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <Link to={`/master-admin/users/${user.id}`} className="text-sm font-medium text-primary hover:text-primary/80">
                          Open user detail
                        </Link>
                        <button type="button" className="text-sm font-medium text-primary hover:text-primary/80" onClick={() => setSessionDialog(user)}>
                          Force logout
                        </button>
                        <button type="button" className="text-sm font-medium text-primary hover:text-primary/80" onClick={() => exportMutation.mutate({ target_type: "user", target_id: user.id })}>
                          Export diagnostic bundle
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No users matched" message="Search by email, display name, or user ID." />
              )}
            </Panel>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Recent sessions</h2>
                  <p className="text-sm text-slate-500">Review active and revoked sessions for the current support search.</p>
                </div>
                {(data?.sessions || []).length ? (
                  <div className="space-y-3">
                    {data.sessions.map((session) => (
                      <div key={session.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-slate-900">{session.email || session.user_id}</div>
                          <Badge variant={session.revoked_at ? "danger" : "success"}>{session.revoked_at ? "revoked" : "active"}</Badge>
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          Created {formatTimestamp(session.created_at)} • Last seen {formatTimestamp(session.last_seen_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No sessions found" message="Session history will appear here after login activity." />
                )}
              </Panel>

              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Auth and audit trail</h2>
                  <p className="text-sm text-slate-500">Quick support context before opening the full auth or audit pages.</p>
                </div>
                <div className="space-y-3">
                  {[...(data?.auth_events || []), ...(data?.audit_events || [])]
                    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
                    .slice(0, 10)
                    .map((event) => (
                      <div key={event.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="font-medium text-slate-900">{event.event_type || event.action}</div>
                        <div className="mt-1 text-sm text-slate-600">{event.email || event.actor_email || event.target_id || "—"}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatTimestamp(event.created_at)}</div>
                      </div>
                    ))}
                </div>
              </Panel>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Related videos</h2>
                  <p className="text-sm text-slate-500">Video records associated with the current support search.</p>
                </div>
                {(data?.related?.videos || []).length ? (
                  <div className="space-y-3">
                    {data.related.videos.map((video) => (
                      <div key={video.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="font-medium text-slate-900">{video.filename || video.id}</div>
                        <div className="mt-1 text-sm text-slate-600">
                          {video.status} • {video.privacy_status} • {video.analysis_status}
                        </div>
                        <div className="mt-2">
                          <Link to={`/master-admin/videos/${video.id}`} className="text-sm font-medium text-primary hover:text-primary/80">
                            Open video detail
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No related videos" message="No uploaded videos matched the current support query." />
                )}
              </Panel>

              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Related incidents</h2>
                  <p className="text-sm text-slate-500">Pipeline incidents tied to the current support query.</p>
                </div>
                {(data?.related?.incidents || []).length ? (
                  <div className="space-y-3">
                    {data.related.incidents.map((incident) => (
                      <div key={incident.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="font-medium text-slate-900">{incident.incident_type}</div>
                        <div className="mt-1 text-sm text-slate-600">{incident.filename || incident.video_id}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No related incidents" message="No incidents are currently linked to the current support query." />
                )}
              </Panel>
            </div>
          </>
        ) : null}
      </div>

      <Dialog
        open={Boolean(sessionDialog)}
        onClose={() => (revokeSessionsMutation.isPending ? null : setSessionDialog(null))}
        title={sessionDialog ? `Force logout ${sessionDialog.email}` : ""}
        description="This revokes all currently active sessions for the selected user."
        closeLabel="Close"
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => setSessionDialog(null)} disabled={revokeSessionsMutation.isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() =>
                revokeSessionsMutation.mutate({
                  userId: sessionDialog.id,
                  payload: { reason, confirmation_text: confirmationText },
                })
              }
              disabled={revokeSessionsMutation.isPending}
            >
              {revokeSessionsMutation.isPending ? "Revoking..." : "Force logout"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Reason">
            <Textarea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why these sessions need to be revoked." />
          </Field>
          <Field label={`Type ${sessionDialog?.email || ""} to confirm`}>
            <Input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} placeholder={sessionDialog?.email || ""} />
          </Field>
        </div>
      </Dialog>
    </LayoutShell>
  );
}
