import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { opsApi, privacyReviewApi, videoApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { useAuth } from "@/hooks/useAuth";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
} from "@/components/ui";
import { toast } from "sonner";

function OpsMetric({ label, value, tone = "neutral" }) {
  const toneClass =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div className={`rounded-lg border px-3 py-3 ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function ReviewCard({ item, onResolve, onRetryPrivacy, resolving, retrying }) {
  const firstTrack = item.candidate_tracks?.[0];

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {item.teacher_name || "Teacher"} • {item.filename}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Uploaded {item.upload_date}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">Privacy review required</Badge>
          <Badge variant="neutral">{item.privacy_review_reason || "manual_review"}</Badge>
          <Link
            to={`/videos/${item.video_id}`}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          >
            Open recording
          </Link>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Candidate tracks
          </div>
          {item.candidate_tracks?.length ? (
            <div className="mt-2 space-y-2">
              {item.candidate_tracks.map((track) => (
                <div
                  key={track.track_id}
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
                >
                  <span>{track.track_id}</span>
                  <span>Match {Math.round((track.teacher_match_score || 0) * 100)}%</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500">
              No candidate tracks were captured. Use blur-all fallback or retry privacy processing.
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Button
            fullWidth
            size="sm"
            onClick={() =>
              onResolve(item.video_id, {
                decision: "approve_teacher_track",
                approved_track_id: firstTrack?.track_id || null,
                reason: "Admin confirmed best teacher track.",
              })
            }
            disabled={resolving}
          >
            {resolving ? "Working..." : "Approve best teacher track"}
          </Button>
          <Button
            fullWidth
            size="sm"
            variant="secondary"
            onClick={() =>
              onResolve(item.video_id, {
                decision: "blur_all_and_continue",
                reason: "Fail closed: blur all faces and continue analysis.",
              })
            }
            disabled={resolving}
          >
            Blur all and continue
          </Button>
          <Button
            fullWidth
            size="sm"
            variant="ghost"
            onClick={() =>
              onResolve(item.video_id, {
                decision: "rerun",
                reason: "Rerun privacy analysis after admin review.",
              })
            }
            disabled={resolving}
          >
            Rerun privacy analysis
          </Button>
          <Button
            fullWidth
            size="sm"
            variant="danger"
            onClick={() => onRetryPrivacy(item.video_id)}
            disabled={retrying}
          >
            {retrying ? "Retrying..." : "Queue privacy retry"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PrivacyReviewQueuePage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = ["admin", "principal", "super_admin"].includes(user?.role);

  const {
    data: queueRes,
    isLoading: queueLoading,
    isError: queueError,
  } = useQuery({
    queryKey: ["privacy-review-queue"],
    enabled: isAdmin,
    queryFn: () => privacyReviewApi.queue().then((res) => res.data),
    refetchInterval: 15000,
  });

  const { data: readinessRes } = useQuery({
    queryKey: ["ops-readiness"],
    enabled: isAdmin,
    queryFn: () => opsApi.readiness().then((res) => res.data),
    refetchInterval: 30000,
  });

  const { data: launchHealthRes } = useQuery({
    queryKey: ["ops-launch-health"],
    enabled: isAdmin,
    queryFn: () => opsApi.launchHealth().then((res) => res.data),
    refetchInterval: 30000,
  });

  const resolveMutation = useMutation({
    mutationFn: ({ videoId, payload }) => privacyReviewApi.resolve(videoId, payload),
    onSuccess: () => {
      toast.success("Privacy review action saved");
      queryClient.invalidateQueries({ queryKey: ["privacy-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["ops-readiness"] });
      queryClient.invalidateQueries({ queryKey: ["ops-launch-health"] });
      queryClient.invalidateQueries({ queryKey: ["videos"] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : detail?.message || "Failed to resolve privacy review");
    },
  });

  const retryPrivacyMutation = useMutation({
    mutationFn: (videoId) => videoApi.retryPrivacy(videoId),
    onSuccess: () => {
      toast.success("Privacy retry queued");
      queryClient.invalidateQueries({ queryKey: ["privacy-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["ops-readiness"] });
      queryClient.invalidateQueries({ queryKey: ["ops-launch-health"] });
      queryClient.invalidateQueries({ queryKey: ["videos"] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : detail?.message || "Failed to queue privacy retry");
    },
  });

  const queueItems = useMemo(() => queueRes?.items || [], [queueRes]);

  if (!isAdmin) {
    return (
      <LayoutShell>
        <div className="mx-auto max-w-5xl px-6 py-6">
          <ErrorState
            title="Admin Access Required"
            message="Privacy review tools are only available to admins."
          />
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title="Privacy Review"
          description="Work ambiguous recordings, monitor privacy queue health, and keep launches moving safely."
        />

        <div className="grid gap-6 lg:grid-cols-[1.2fr_2fr]">
          <Panel>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              Queue Health
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <OpsMetric
                label="Pending Reviews"
                value={launchHealthRes?.metrics?.privacy_reviews_pending ?? queueItems.length}
                tone={(launchHealthRes?.metrics?.privacy_reviews_pending ?? queueItems.length) > 0 ? "warning" : "neutral"}
              />
              <OpsMetric
                label="Privacy Queue"
                value={launchHealthRes?.metrics?.privacy_queue_depth ?? 0}
                tone={(launchHealthRes?.metrics?.privacy_queue_depth ?? 0) > 10 ? "warning" : "neutral"}
              />
              <OpsMetric
                label="Privacy Failures 24h"
                value={launchHealthRes?.metrics?.failed_privacy_jobs_24h ?? 0}
                tone={(launchHealthRes?.metrics?.failed_privacy_jobs_24h ?? 0) > 0 ? "danger" : "neutral"}
              />
              <OpsMetric
                label="Missing Profiles"
                value={readinessRes?.metrics?.teachers_missing_privacy_profiles ?? 0}
                tone={(readinessRes?.metrics?.teachers_missing_privacy_profiles ?? 0) > 0 ? "warning" : "neutral"}
              />
            </div>

            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
              <div className="font-semibold text-slate-800">
                Incident Level: {launchHealthRes?.incident_level || "unknown"}
              </div>
              <div className="mt-2 space-y-1">
                {(launchHealthRes?.recommended_actions || []).map((action) => (
                  <div key={action}>• {action}</div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Review Queue
                </h2>
                <p className="text-xs text-slate-500">
                  Resolve ambiguous matches before customers see the recording.
                </p>
              </div>
              <div className="text-xs text-slate-500">
                {queueItems.length} item{queueItems.length === 1 ? "" : "s"}
              </div>
            </div>

            {queueLoading ? (
              <LoadingState message="Loading privacy review queue..." />
            ) : queueError ? (
              <ErrorState
                title="Unable to load privacy review queue"
                message="Refresh and try again. If this persists, inspect the backend ops metrics."
              />
            ) : queueItems.length === 0 ? (
              <EmptyState
                title="Privacy queue is clear"
                message="No recordings currently require manual privacy review."
              />
            ) : (
              <div className="space-y-4">
                {queueItems.map((item) => (
                  <ReviewCard
                    key={item.video_id}
                    item={item}
                    onResolve={(videoId, payload) => resolveMutation.mutate({ videoId, payload })}
                    onRetryPrivacy={(videoId) => retryPrivacyMutation.mutate(videoId)}
                    resolving={resolveMutation.isPending}
                    retrying={retryPrivacyMutation.isPending}
                  />
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </LayoutShell>
  );
}
