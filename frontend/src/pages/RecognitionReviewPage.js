import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { exemplarApi, recognitionApi } from "@/lib/api";
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

function QueueMetric({ label, value, tone = "neutral" }) {
  const toneClass =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : tone === "danger"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div className={`rounded-lg border px-3 py-3 ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function RecognitionReviewCard({ item, onReview, approving }) {
  const { t } = useTranslation();
  const formatStatus = (value) => {
    const map = {
      pending_admin_review: t("labels.pendingAdminReview"),
      not_submitted: t("labels.notSubmitted"),
      awarded: t("labels.awarded"),
      private: t("labels.private"),
      school_only: t("labels.schoolOnly"),
      cognivio_library: t("labels.cognivioLibrary"),
    };
    return map[value] || value || t("recognitionReview.privateScope");
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {item.teacher_name || t("recognitionReview.teacherFallback")} • {item.badge_type === "five_star_lesson" ? t("recognitionReview.fiveStarLesson") : (item.badge_type || "recognition").replace(/_/g, " ")}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {t("recognitionReview.scopeLine", {
              scope: formatStatus(item.sharing_scope),
              date: item.submitted_at ? String(item.submitted_at).slice(0, 10) : t("recognitionReview.recentlySubmitted"),
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">{formatStatus(item.recognition_status)}</Badge>
          <Badge variant="neutral">{formatStatus(item.publication_status)}</Badge>
          <Link
            to={`/videos/${item.video_id}`}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          >
            {t("recognitionReview.openRecording")}
          </Link>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            onReview(item.video_id, {
              decision: "approve",
              badge_type: item.badge_type || "five_star_lesson",
              reason: "Approved for Cognivio recognition after admin review.",
            })
          }
          disabled={approving}
        >
          {approving ? "..." : t("recognitionReview.approveBadge")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onReview(item.video_id, {
              decision: "reject",
              reason: "Recognition threshold not met after admin review.",
            })
          }
          disabled={approving}
        >
          {t("recognitionReview.reject")}
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() =>
            onReview(item.video_id, {
              decision: "revoke",
              reason: "Recognition revoked after admin review.",
            })
          }
          disabled={approving}
        >
          {t("recognitionReview.revoke")}
        </Button>
      </div>
    </div>
  );
}

function ExemplarReviewCard({ item, onReview, approving }) {
  const { t } = useTranslation();
  const formatStatus = (value) => {
    const map = {
      pending_admin_review: t("labels.pendingAdminReview"),
      not_submitted: t("labels.notSubmitted"),
      private: t("labels.private"),
      school_only: t("labels.schoolOnly"),
      cognivio_library: t("labels.cognivioLibrary"),
    };
    return map[value] || value || t("recognitionReview.privateScope");
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {item.teacher_name || t("recognitionReview.teacherFallback")} • {item.title}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {t("recognitionReview.scopeLine", {
              scope: formatStatus(item.sharing_scope),
              date: item.submitted_at ? String(item.submitted_at).slice(0, 10) : t("recognitionReview.recentlySubmitted"),
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">{formatStatus(item.submission_status)}</Badge>
          <Link
            to={`/videos/${item.video_id}`}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          >
            {t("recognitionReview.openRecording")}
          </Link>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-600">{item.summary}</p>
      {item.tags?.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.tags.map((tag) => (
            <span
              key={`${item.submission_id}-${tag}`}
              className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            onReview(item.submission_id, {
              decision: "approve",
              reason: "Approved for publication in the All-Star Library.",
            })
          }
          disabled={approving}
        >
          {approving ? "..." : t("recognitionReview.publishToLibrary")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onReview(item.submission_id, {
              decision: "reject",
              reason: "Not approved for exemplar publication.",
            })
          }
          disabled={approving}
        >
          {t("recognitionReview.rejectSubmission")}
        </Button>
      </div>
    </div>
  );
}

export function RecognitionReviewPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = ["admin", "principal", "super_admin"].includes(user?.role);

  const {
    data: queueRes,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["recognition-review-queue"],
    enabled: isAdmin,
    queryFn: () => recognitionApi.reviewQueue().then((res) => res.data),
    refetchInterval: 15000,
  });
  const {
    data: exemplarQueueRes,
    isLoading: exemplarLoading,
    isError: exemplarError,
  } = useQuery({
    queryKey: ["exemplar-review-queue"],
    enabled: isAdmin,
    queryFn: () => exemplarApi.reviewQueue().then((res) => res.data),
    refetchInterval: 15000,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ videoId, payload }) => recognitionApi.review(videoId, payload),
    onSuccess: () => {
      toast.success(t("recognitionReview.reviewSaved"));
      queryClient.invalidateQueries({ queryKey: ["recognition-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["video"] });
      queryClient.invalidateQueries({ queryKey: ["video-recognition"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-recognition-summary"] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : detail?.message || t("recognitionReview.reviewSaveFailed"));
    },
  });
  const exemplarReviewMutation = useMutation({
    mutationFn: ({ submissionId, payload }) => exemplarApi.review(submissionId, payload),
    onSuccess: () => {
      toast.success(t("recognitionReview.exemplarReviewSaved"));
      queryClient.invalidateQueries({ queryKey: ["exemplar-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["exemplar-library"] });
      queryClient.invalidateQueries({ queryKey: ["video-recognition"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-recognition-summary"] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : detail?.message || t("recognitionReview.exemplarReviewFailed"));
    },
  });

  const queueItems = useMemo(() => queueRes?.items || [], [queueRes]);
  const exemplarItems = useMemo(() => exemplarQueueRes?.items || [], [exemplarQueueRes]);
  const libraryReadyCount = useMemo(
    () => queueItems.filter((item) => item.sharing_scope === "cognivio_library").length,
    [queueItems]
  );

  if (!isAdmin) {
    return (
      <LayoutShell>
        <div className="mx-auto max-w-5xl px-6 py-6">
          <ErrorState
            title={t("recognitionReview.adminRequiredTitle")}
            message={t("recognitionReview.adminRequiredMessage")}
          />
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title={t("recognitionReview.title")}
          description={t("recognitionReview.description")}
        />

        <div className="grid gap-6 lg:grid-cols-[1.1fr_2fr]">
          <Panel>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              {t("recognitionReview.queueSnapshot")}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <QueueMetric
                label={t("dashboard.pendingReviews")}
                value={queueItems.length}
                tone={queueItems.length > 0 ? "warning" : "neutral"}
              />
              <QueueMetric
                label={t("dashboard.badgeQueue")}
                value={queueItems.length}
                tone={queueItems.length > 0 ? "warning" : "neutral"}
              />
              <QueueMetric
                label={t("dashboard.exemplarQueue")}
                value={exemplarItems.length}
                tone={exemplarItems.length > 0 ? "warning" : "neutral"}
              />
              <QueueMetric
                label={t("dashboard.libraryScope")}
                value={libraryReadyCount + exemplarItems.filter((item) => item.sharing_scope === "cognivio_library").length}
                tone={libraryReadyCount + exemplarItems.filter((item) => item.sharing_scope === "cognivio_library").length > 0 ? "warning" : "neutral"}
              />
            </div>
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
              <div className="font-semibold text-slate-800">
                {t("recognitionReview.reviewRule")}
              </div>
              <div className="mt-2 space-y-1">
                <div>{t("recognitionReview.reviewRuleLine1")}</div>
                <div>{t("recognitionReview.reviewRuleLine2")}</div>
                <div>{t("recognitionReview.reviewRuleLine3")}</div>
              </div>
            </div>
          </Panel>

          <div className="space-y-6">
          <Panel>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {t("recognitionReview.pendingRecognitionTitle")}
                </h2>
                <p className="text-xs text-slate-500">
                  {t("recognitionReview.pendingRecognitionDescription")}
                </p>
              </div>
              <div className="text-xs text-slate-500">
                {queueItems.length === 1
                  ? t("recognitionReview.oneItemCount")
                  : t("recognitionReview.itemsCount", { count: queueItems.length })}
              </div>
            </div>

            {isLoading ? (
              <LoadingState message={t("recognitionReview.loadingRecognitionQueue")} />
            ) : isError ? (
              <ErrorState
                title={t("recognitionReview.recognitionQueueErrorTitle")}
                message={t("recognitionReview.recognitionQueueErrorMessage")}
              />
            ) : queueItems.length === 0 ? (
              <EmptyState
                title={t("recognitionReview.emptyRecognitionTitle")}
                message={t("recognitionReview.emptyRecognitionMessage")}
              />
            ) : (
              <div className="space-y-4">
                {queueItems.map((item) => (
                  <RecognitionReviewCard
                    key={item.video_id}
                    item={item}
                    onReview={(videoId, payload) => reviewMutation.mutate({ videoId, payload })}
                    approving={reviewMutation.isPending}
                  />
                ))}
              </div>
            )}
          </Panel>
          <Panel>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {t("recognitionReview.pendingExemplarTitle")}
                </h2>
                <p className="text-xs text-slate-500">
                  {t("recognitionReview.pendingExemplarDescription")}
                </p>
              </div>
              <div className="text-xs text-slate-500">
                {exemplarItems.length === 1
                  ? t("recognitionReview.oneItemCount")
                  : t("recognitionReview.itemsCount", { count: exemplarItems.length })}
              </div>
            </div>

            {exemplarLoading ? (
              <LoadingState message={t("recognitionReview.loadingExemplarQueue")} />
            ) : exemplarError ? (
              <ErrorState
                title={t("recognitionReview.exemplarQueueErrorTitle")}
                message={t("recognitionReview.exemplarQueueErrorMessage")}
              />
            ) : exemplarItems.length === 0 ? (
              <EmptyState
                title={t("recognitionReview.emptyExemplarTitle")}
                message={t("recognitionReview.emptyExemplarMessage")}
              />
            ) : (
              <div className="space-y-4">
                {exemplarItems.map((item) => (
                  <ExemplarReviewCard
                    key={item.submission_id}
                    item={item}
                    onReview={(submissionId, payload) => exemplarReviewMutation.mutate({ submissionId, payload })}
                    approving={exemplarReviewMutation.isPending}
                  />
                ))}
              </div>
            )}
          </Panel>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}
