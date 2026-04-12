import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Panel,
} from "@/components/ui";
import { MasterAdminMetricCard, MasterAdminMetricGrid, MasterAdminPageScaffold } from "@/components/master-admin/MasterAdminPageScaffold";
import { masterAdminApi } from "@/lib/api";

function formatTimestamp(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "—";
  }
}

function statusVariant(value) {
  if (value === "failed" || value === "active") return "danger";
  if (value === "processing" || value === "queued" || value === "review_required" || value === "monitoring") return "warning";
  if (value === "completed" || value === "clear" || value === "ready") return "success";
  return "neutral";
}

export function MasterAdminVideosPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const filters = useMemo(
    () => ({
      q: searchParams.get("q") || undefined,
      stage: searchParams.get("stage") || undefined,
      incident_state: searchParams.get("incident_state") || undefined,
    }),
    [searchParams]
  );

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-videos", filters],
    queryFn: () => masterAdminApi.videos(filters).then((res) => res.data),
  });

  const retryMutation = useMutation({
    mutationFn: async ({ videoId, action }) => {
      if (action === "analysis") return masterAdminApi.retryVideoAnalysis(videoId);
      if (action === "privacy") return masterAdminApi.retryVideoPrivacy(videoId);
      return masterAdminApi.retryVideoTranscode(videoId);
    },
    onSuccess: () => {
      toast.success("Video retry queued");
      queryClient.invalidateQueries({ queryKey: ["master-admin-videos"] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-video-detail"] });
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || "Retry failed");
    },
  });

  const setFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  const onSearchSubmit = (event) => {
    event.preventDefault();
    setFilter("q", query.trim() || "");
  };

  return (
    <MasterAdminPageScaffold
      title="Master Admin videos"
      description="Platform-wide processing registry for uploads, transcode, privacy, analysis, and playback."
      meta="One place to find any video and understand its current pipeline state."
      actions={
        <Button type="button" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing..." : "Refresh"}
        </Button>
      }
      railNote="Start with incident state and latest error, then branch into retry actions only when the underlying asset and queue state make sense."
    >

        <Panel className="space-y-4">
          <form className="grid gap-4 lg:grid-cols-[1.4fr,0.8fr,0.8fr,auto]" onSubmit={onSearchSubmit}>
            <Field label="Search">
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filename, teacher, uploader, or error" />
            </Field>
            <Field label="Stage">
              <select
                value={filters.stage || ""}
                onChange={(event) => setFilter("stage", event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">All stages</option>
                <option value="upload">Upload</option>
                <option value="transcode">Transcode</option>
                <option value="privacy">Privacy</option>
                <option value="analysis">Analysis</option>
                <option value="playback">Playback</option>
              </select>
            </Field>
            <Field label="Incident state">
              <select
                value={filters.incident_state || ""}
                onChange={(event) => setFilter("incident_state", event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">All</option>
                <option value="active">Active incidents</option>
                <option value="monitoring">Monitoring</option>
                <option value="clear">Clear</option>
              </select>
            </Field>
            <div className="flex items-end">
              <Button type="submit">Apply</Button>
            </div>
          </form>

          <MasterAdminMetricGrid className="xl:grid-cols-5">
            <MasterAdminMetricCard label="Total" value={data?.summary?.total ?? 0} />
            <MasterAdminMetricCard label="Active incidents" value={data?.summary?.active_incidents ?? 0} tone="danger" />
            <MasterAdminMetricCard label="Transcode failed" value={data?.summary?.transcode_failed ?? 0} tone="danger" />
            <MasterAdminMetricCard label="Privacy failed" value={data?.summary?.privacy_failed ?? 0} tone="warning" />
            <MasterAdminMetricCard label="Analysis failed" value={data?.summary?.analysis_failed ?? 0} tone="warning" />
          </MasterAdminMetricGrid>
        </Panel>

        {isLoading ? <LoadingState message="Loading video registry..." /> : null}
        {isError ? <ErrorState title="Unable to load videos" message="Refresh and try again." /> : null}

        {!isLoading && !isError ? (
          <Panel className="space-y-4">
            {(data?.items || []).length ? (
              <div className="space-y-3">
                {data.items.map((video) => (
                  <div key={video.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-slate-900">{video.filename || video.id}</div>
                        <div className="mt-1 text-sm text-slate-600">
                          {video.teacher_name || "Unknown teacher"} • {video.owner_email || "No owner"}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={statusVariant(video.incident_state)}>{video.incident_state}</Badge>
                        <Badge variant={statusVariant(video.transcode_status)}>Transcode {video.transcode_status}</Badge>
                        <Badge variant={statusVariant(video.privacy_status)}>Privacy {video.privacy_status}</Badge>
                        <Badge variant={statusVariant(video.analysis_status)}>Analysis {video.analysis_status}</Badge>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Uploaded</div>
                        <div className="mt-1 text-sm text-slate-700">{formatTimestamp(video.upload_date)}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Updated</div>
                        <div className="mt-1 text-sm text-slate-700">{formatTimestamp(video.status_updated_at)}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Raw asset</div>
                        <div className="mt-1 text-sm text-slate-700">{video.raw_asset_state}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Processed asset</div>
                        <div className="mt-1 text-sm text-slate-700">{video.processed_asset_state}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Playback</div>
                        <div className="mt-1 text-sm text-slate-700">{video.playback_state}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Uploader</div>
                        <div className="mt-1 text-sm text-slate-700">{video.uploader_email || "—"}</div>
                      </div>
                    </div>

                    {video.latest_error ? (
                      <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                        {video.latest_error}
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-3">
                      <Link to={`/master-admin/videos/${video.id}`} className="text-sm font-medium text-primary hover:text-primary/80">
                        Open detail
                      </Link>
                      <button
                        type="button"
                        className="text-sm font-medium text-primary hover:text-primary/80"
                        onClick={() => retryMutation.mutate({ videoId: video.id, action: "transcode" })}
                      >
                        Retry transcode
                      </button>
                      <button
                        type="button"
                        className="text-sm font-medium text-primary hover:text-primary/80"
                        onClick={() => retryMutation.mutate({ videoId: video.id, action: "privacy" })}
                      >
                        Retry privacy
                      </button>
                      <button
                        type="button"
                        className="text-sm font-medium text-primary hover:text-primary/80"
                        onClick={() => retryMutation.mutate({ videoId: video.id, action: "analysis" })}
                      >
                        Retry analysis
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No videos match these filters" message="Try broadening the filters or search term." />
            )}
          </Panel>
        ) : null}
    </MasterAdminPageScaffold>
  );
}
