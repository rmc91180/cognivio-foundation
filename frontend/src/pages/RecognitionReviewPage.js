import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router-dom";
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
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {item.teacher_name || "Teacher"} • {item.badge_type === "five_star_lesson" ? "5-Star Lesson" : (item.badge_type || "recognition").replace(/_/g, " ")}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Scope: {item.sharing_scope || "private"} • Submitted {item.submitted_at ? String(item.submitted_at).slice(0, 10) : "recently"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">{item.recognition_status || "pending_admin_review"}</Badge>
          <Badge variant="neutral">{item.publication_status || "not_submitted"}</Badge>
          <Link
            to={`/videos/${item.video_id}`}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          >
            Open recording
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
          {approving ? "Saving..." : "Approve badge"}
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
          Reject
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
          Revoke
        </Button>
      </div>
    </div>
  );
}

function ExemplarReviewCard({ item, onReview, approving }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {item.teacher_name || "Teacher"} • {item.title}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Scope: {item.sharing_scope || "private"} • Submitted {item.submitted_at ? String(item.submitted_at).slice(0, 10) : "recently"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">{item.submission_status || "pending_admin_review"}</Badge>
          <Link
            to={`/videos/${item.video_id}`}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          >
            Open recording
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
          {approving ? "Saving..." : "Publish to library"}
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
          Reject submission
        </Button>
      </div>
    </div>
  );
}

export function RecognitionReviewPage() {
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
      toast.success("Recognition review saved");
      queryClient.invalidateQueries({ queryKey: ["recognition-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["video"] });
      queryClient.invalidateQueries({ queryKey: ["video-recognition"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-recognition-summary"] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : detail?.message || "Failed to save recognition review");
    },
  });
  const exemplarReviewMutation = useMutation({
    mutationFn: ({ submissionId, payload }) => exemplarApi.review(submissionId, payload),
    onSuccess: () => {
      toast.success("Exemplar review saved");
      queryClient.invalidateQueries({ queryKey: ["exemplar-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["exemplar-library"] });
      queryClient.invalidateQueries({ queryKey: ["video-recognition"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-recognition-summary"] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : detail?.message || "Failed to save exemplar review");
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
            title="Admin Access Required"
            message="Recognition review tools are only available to admins."
          />
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title="Recognition Review"
          description="Confirm 5-star lessons, protect publication quality, and keep exemplar approvals deliberate."
        />

        <div className="grid gap-6 lg:grid-cols-[1.1fr_2fr]">
          <Panel>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              Queue Snapshot
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <QueueMetric
                label="Pending Reviews"
                value={queueItems.length}
                tone={queueItems.length > 0 ? "warning" : "neutral"}
              />
              <QueueMetric
                label="Badge Queue"
                value={queueItems.length}
                tone={queueItems.length > 0 ? "warning" : "neutral"}
              />
              <QueueMetric
                label="Exemplar Queue"
                value={exemplarItems.length}
                tone={exemplarItems.length > 0 ? "warning" : "neutral"}
              />
              <QueueMetric
                label="Library Scope"
                value={libraryReadyCount + exemplarItems.filter((item) => item.sharing_scope === "cognivio_library").length}
                tone={libraryReadyCount + exemplarItems.filter((item) => item.sharing_scope === "cognivio_library").length > 0 ? "warning" : "neutral"}
              />
            </div>
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
              <div className="font-semibold text-slate-800">
                Review rule
              </div>
              <div className="mt-2 space-y-1">
                <div>Only privacy-safe completed lessons should be approved.</div>
                <div>Recognition does not publish anything by itself.</div>
                <div>Teacher opt-in and later exemplar review still apply.</div>
              </div>
            </div>
          </Panel>

          <div className="space-y-6">
          <Panel>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Pending Recognition Reviews
                </h2>
                <p className="text-xs text-slate-500">
                  Review the lesson, confirm the quality bar, and award or reject recognition.
                </p>
              </div>
              <div className="text-xs text-slate-500">
                {queueItems.length} item{queueItems.length === 1 ? "" : "s"}
              </div>
            </div>

            {isLoading ? (
              <LoadingState message="Loading recognition review queue..." />
            ) : isError ? (
              <ErrorState
                title="Unable to load recognition queue"
                message="Refresh and try again. If this persists, verify the backend recognition endpoints."
              />
            ) : queueItems.length === 0 ? (
              <EmptyState
                title="Recognition queue is clear"
                message="No lessons are currently waiting for admin recognition review."
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
                  Pending Exemplar Publication Reviews
                </h2>
                <p className="text-xs text-slate-500">
                  Approve recognized lessons for the All-Star Library only after checking quality and publication fit.
                </p>
              </div>
              <div className="text-xs text-slate-500">
                {exemplarItems.length} item{exemplarItems.length === 1 ? "" : "s"}
              </div>
            </div>

            {exemplarLoading ? (
              <LoadingState message="Loading exemplar review queue..." />
            ) : exemplarError ? (
              <ErrorState
                title="Unable to load exemplar queue"
                message="Refresh and try again. If this persists, verify the exemplar review endpoints."
              />
            ) : exemplarItems.length === 0 ? (
              <EmptyState
                title="Exemplar queue is clear"
                message="No submissions are currently waiting for library approval."
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
