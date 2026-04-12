import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge, Button, ErrorState, LoadingState, Panel } from "@/components/ui";
import { MasterAdminPageScaffold } from "@/components/master-admin/MasterAdminPageScaffold";
import { masterAdminApi } from "@/lib/api";

function formatTimestamp(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "—";
  }
}

export function MasterAdminVideoDetailPage() {
  const { videoId } = useParams();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-video-detail", videoId],
    queryFn: () => masterAdminApi.videoDetail(videoId).then((res) => res.data),
    enabled: Boolean(videoId),
  });

  const retryMutation = useMutation({
    mutationFn: async (action) => {
      if (action === "analysis") return masterAdminApi.retryVideoAnalysis(videoId);
      if (action === "privacy") return masterAdminApi.retryVideoPrivacy(videoId);
      return masterAdminApi.retryVideoTranscode(videoId);
    },
    onSuccess: () => {
      toast.success("Retry queued");
      queryClient.invalidateQueries({ queryKey: ["master-admin-video-detail", videoId] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-videos"] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-incidents"] });
    },
    onError: (error) => toast.error(error?.response?.data?.detail || "Retry failed"),
  });

  const video = data?.video;

  return (
    <MasterAdminPageScaffold
      title="Video troubleshooting"
      description="Review one video end to end: pipeline state, assets, jobs, and incident trail."
      meta={video ? `${video.filename || video.id}` : null}
      actions={
        <Button type="button" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing..." : "Refresh"}
        </Button>
      }
      railNote="This page is intentionally detailed. Start with current state, latest error, and asset location before you retry anything."
    >
        <div>
          <Link to="/master-admin/videos" className="text-sm font-medium text-primary hover:text-primary/80">
            Back to videos
          </Link>
        </div>
        {isLoading ? <LoadingState message="Loading video detail..." /> : null}
        {isError ? <ErrorState title="Unable to load video detail" message="Refresh and try again." /> : null}
        {!isLoading && !isError && video ? (
          <>
            <Panel className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-2xl font-semibold text-slate-900">{video.filename || video.id}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {video.teacher_name || "Unknown teacher"} • {video.owner_email || "No owner"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={video.incident_state === "active" ? "danger" : video.incident_state === "monitoring" ? "warning" : "success"}>
                    {video.incident_state}
                  </Badge>
                  <Badge variant={video.transcode_status === "failed" ? "danger" : "neutral"}>Transcode {video.transcode_status}</Badge>
                  <Badge variant={video.privacy_status === "failed" || video.privacy_status === "review_required" ? "warning" : "neutral"}>
                    Privacy {video.privacy_status}
                  </Badge>
                  <Badge variant={video.analysis_status === "failed" ? "danger" : "neutral"}>Analysis {video.analysis_status}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={() => retryMutation.mutate("transcode")}>Retry transcode</Button>
                <Button type="button" variant="secondary" onClick={() => retryMutation.mutate("privacy")}>Retry privacy</Button>
                <Button type="button" variant="secondary" onClick={() => retryMutation.mutate("analysis")}>Retry analysis</Button>
                <Link to={`/videos/${video.id}`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-white">
                  Open user-facing video page
                </Link>
              </div>
            </Panel>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Processing timeline</h2>
                  <p className="text-sm text-slate-500">Follow the lifecycle from upload through analysis.</p>
                </div>
                <div className="space-y-3">
                  {(data?.related?.timeline || []).map((step) => (
                    <div key={step.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-slate-900">{step.label}</div>
                        <Badge variant="neutral">{step.status || "—"}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-slate-500">{formatTimestamp(step.at)}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Asset locations</h2>
                  <p className="text-sm text-slate-500">Use this to understand which source the system is currently relying on.</p>
                </div>
                <div className="space-y-3 text-sm text-slate-700">
                  {Object.entries(data?.related?.asset_locations || {}).map(([key, value]) => (
                    <div key={key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{key}</div>
                      <div className="mt-1 break-all">{value || "—"}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Job documents</h2>
                  <p className="text-sm text-slate-500">Processing jobs from the backend queues.</p>
                </div>
                <div className="space-y-3">
                  {Object.entries(data?.related?.jobs || {}).map(([key, value]) => (
                    <div key={key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{key}</div>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-slate-700">{JSON.stringify(value || {}, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Linked incidents</h2>
                  <p className="text-sm text-slate-500">Centralized incident entries tied to this video.</p>
                </div>
                {(data?.related?.incidents || []).length ? (
                  <div className="space-y-3">
                    {data.related.incidents.map((incident) => (
                      <div key={incident.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-slate-900">{incident.incident_type}</div>
                          <Badge variant={incident.severity === "danger" ? "danger" : "warning"}>{incident.state}</Badge>
                        </div>
                        <div className="mt-1 text-sm text-slate-600">{incident.latest_error || "No explicit error message recorded."}</div>
                        <div className="mt-2 text-xs text-slate-500">Last seen {formatTimestamp(incident.last_seen_at)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    No incidents recorded for this video.
                  </div>
                )}
              </Panel>
            </div>
          </>
        ) : null}
    </MasterAdminPageScaffold>
  );
}
