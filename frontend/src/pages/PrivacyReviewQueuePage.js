import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const firstTrack = item.candidate_tracks?.[0];

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {item.teacher_name || t("privacyReview.teacherFallback")} • {item.filename}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {t("privacyReview.uploaded", { date: item.upload_date })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">{t("privacyReview.privacyReviewRequired")}</Badge>
          <Badge variant="neutral">{t("privacyReview.manualDecisionNeeded")}</Badge>
          <Link
            to={`/videos/${item.video_id}`}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          >
            {t("privacyReview.openRecording")}
          </Link>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {t("privacyReview.candidateTracks")}
          </div>
          {item.candidate_tracks?.length ? (
            <div className="mt-2 space-y-2">
              {item.candidate_tracks.map((track) => (
                <div
                  key={track.track_id}
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
                >
                  <span>{track.track_id}</span>
                  <span>{t("privacyReview.matchPercent", { percent: Math.round((track.teacher_match_score || 0) * 100) })}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500">
              {t("privacyReview.noCandidateTracks")}
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
            {resolving ? "..." : t("privacyReview.approveBestTrack")}
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
            {t("privacyReview.blurAll")}
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
            {t("privacyReview.rerun")}
          </Button>
          <Button
            fullWidth
            size="sm"
            variant="danger"
            onClick={() => onRetryPrivacy(item.video_id)}
            disabled={retrying}
          >
            {retrying ? "..." : t("privacyReview.retry")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PrivacyReviewQueuePage() {
  const { t } = useTranslation();
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
      toast.success(t("privacyReview.reviewActionSaved"));
      queryClient.invalidateQueries({ queryKey: ["privacy-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["ops-readiness"] });
      queryClient.invalidateQueries({ queryKey: ["ops-launch-health"] });
      queryClient.invalidateQueries({ queryKey: ["videos"] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : detail?.message || t("privacyReview.reviewActionFailed"));
    },
  });

  const retryPrivacyMutation = useMutation({
    mutationFn: (videoId) => videoApi.retryPrivacy(videoId),
    onSuccess: () => {
      toast.success(t("privacyReview.retryQueued"));
      queryClient.invalidateQueries({ queryKey: ["privacy-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["ops-readiness"] });
      queryClient.invalidateQueries({ queryKey: ["ops-launch-health"] });
      queryClient.invalidateQueries({ queryKey: ["videos"] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : detail?.message || t("privacyReview.retryQueueFailed"));
    },
  });

  const queueItems = useMemo(() => queueRes?.items || [], [queueRes]);

  if (!isAdmin) {
    return (
      <LayoutShell>
        <div className="mx-auto max-w-5xl px-6 py-6">
          <ErrorState
            title={t("privacyReview.adminRequiredTitle")}
            message={t("privacyReview.adminRequiredMessage")}
          />
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title={t("privacyReview.title")}
          description={t("privacyReview.description")}
        />

        <div className="grid gap-6 lg:grid-cols-[1.2fr_2fr]">
          <Panel>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              {t("privacyReview.queueHealth")}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <OpsMetric
                label={t("privacyReview.pendingReviews")}
                value={launchHealthRes?.metrics?.privacy_reviews_pending ?? queueItems.length}
                tone={(launchHealthRes?.metrics?.privacy_reviews_pending ?? queueItems.length) > 0 ? "warning" : "neutral"}
              />
              <OpsMetric
                label={t("privacyReview.privacyQueue")}
                value={launchHealthRes?.metrics?.privacy_queue_depth ?? 0}
                tone={(launchHealthRes?.metrics?.privacy_queue_depth ?? 0) > 10 ? "warning" : "neutral"}
              />
              <OpsMetric
                label={t("dashboard.privacyFailures24h")}
                value={launchHealthRes?.metrics?.failed_privacy_jobs_24h ?? 0}
                tone={(launchHealthRes?.metrics?.failed_privacy_jobs_24h ?? 0) > 0 ? "danger" : "neutral"}
              />
              <OpsMetric
                label={t("dashboard.missingProfiles")}
                value={readinessRes?.metrics?.teachers_missing_privacy_profiles ?? 0}
                tone={(readinessRes?.metrics?.teachers_missing_privacy_profiles ?? 0) > 0 ? "warning" : "neutral"}
              />
            </div>

            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
              <div className="font-semibold text-slate-800">
                {t("privacyReview.incidentLevel")}: {launchHealthRes?.incident_level || t("privacyReview.unknown")}
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
                  {t("privacyReview.reviewQueue")}
                </h2>
                <p className="text-xs text-slate-500">
                  {t("privacyReview.reviewQueueDescription")}
                </p>
              </div>
              <div className="text-xs text-slate-500">
                {queueItems.length === 1
                  ? t("privacyReview.oneItemCount")
                  : t("privacyReview.itemsCount", { count: queueItems.length })}
              </div>
            </div>

            {queueLoading ? (
              <LoadingState message={t("privacyReview.loadingQueue")} />
            ) : queueError ? (
              <ErrorState
                title={t("privacyReview.queueErrorTitle")}
                message={t("privacyReview.queueErrorMessage")}
              />
            ) : queueItems.length === 0 ? (
              <EmptyState
                title={t("privacyReview.emptyTitle")}
                message={t("privacyReview.emptyMessage")}
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
