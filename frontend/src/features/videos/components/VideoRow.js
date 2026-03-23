import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Badge, Button } from "@/components/ui";
import { assessmentApi } from "@/features/assessments/api";
import { evidenceApi } from "@/features/videos/api";

export function VideoRow({
  video,
  assessment,
  teacher,
  isAdmin,
  onRetry,
  onRetryPrivacy,
  isRetrying,
  isRetryingPrivacy,
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const observationSummary = assessment?.observation_summary;
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === "he" ? "he-IL" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language]
  );
  const scoreFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language === "he" ? "he-IL" : "en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [i18n.language]
  );
  const formatStatus = (value) => {
    const map = {
      queued: t("labels.queued"),
      processing: t("labels.processing"),
      completed: t("labels.completed"),
      failed: t("labels.failed"),
      error: t("labels.error"),
      review_required: t("labels.reviewRequired"),
      pending_admin_review: t("labels.pendingAdminReview"),
    };
    return map[value] || value || t("videosPage.unknown");
  };
  const [open, setOpen] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState(
    assessment?.element_scores?.[0]?.element_id || ""
  );
  const [adjustedScore, setAdjustedScore] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const formatRecordedAt = (value) => {
    if (!value) return t("videosPage.unknown");
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value;
    return dateTimeFormatter.format(new Date(parsed));
  };
  const formatScore = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
    return scoreFormatter.format(value);
  };
  const formatTimestampRange = (start, end) => {
    const toClock = (value) => {
      const totalSeconds = Math.max(0, Math.round(value));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    };
    return `${toClock(start)}–${toClock(end)}`;
  };

  const { data: evidenceRes } = useQuery({
    queryKey: ["assessment-evidence", assessment?.id],
    enabled: open && Boolean(assessment?.id),
    queryFn: () => evidenceApi.get(assessment.id).then((res) => res.data),
  });

  const evidenceByElement = useMemo(() => {
    const map = {};
    const items = evidenceRes?.evidence || [];
    items.forEach((ev) => {
      if (!ev.element_id) return;
      if (!map[ev.element_id]) map[ev.element_id] = [];
      map[ev.element_id].push(ev);
    });
    return map;
  }, [evidenceRes]);

  const overrideMutation = useMutation({
    mutationFn: (payload) => assessmentApi.createAdminOverride(assessment.id, payload),
    onSuccess: () => {
      toast.success(t("videosPage.adminAdjustmentSaved"));
      queryClient.invalidateQueries({ queryKey: ["assessments"] });
    },
    onError: () => {
      toast.error(t("videosPage.adminAdjustmentFailed"));
    },
  });

  const elementOptions = assessment?.element_scores || [];
  const statusVariant =
    video.status === "completed"
      ? "success"
      : video.status === "failed" || video.status === "error"
        ? "danger"
        : video.status === "processing" || video.status === "queued"
          ? "warning"
          : "neutral";

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-900">
            {teacher?.name || t("teachersPage.teacher")} • {video.subject || t("teachersPage.subject")}
          </div>
          <div className="text-[11px] text-slate-500">
            {formatRecordedAt(video.recorded_at || video.upload_date)}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-600">
          <Badge variant={statusVariant}>{formatStatus(video.status)}</Badge>
          <Badge
            variant={
              video.privacy_status === "completed"
                ? "success"
                : video.privacy_status === "failed"
                  ? "danger"
                  : video.privacy_status === "review_required"
                    ? "warning"
                    : "neutral"
            }
          >
            {t("videosPage.privacy")} {formatStatus(video.privacy_status)}
          </Badge>
          {assessment && (
            <Badge variant="success">
              {t("videosPage.scoreLabel", {
                score: formatScore(assessment.overall_score),
              })}
            </Badge>
          )}
          {video.privacy_status === "review_required" && (
            <Link
              to="/privacy-review"
              className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100"
            >
              {t("videosPage.reviewPrivacy")}
            </Link>
          )}
          {video.privacy_status === "failed" && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => onRetryPrivacy(video.id)}
              disabled={isRetryingPrivacy}
            >
              {isRetryingPrivacy ? t("videosPage.retryingPrivacy") : t("videosPage.retryPrivacy")}
            </Button>
          )}
          {(video.status === "failed" || video.status === "error") && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => onRetry(video.id)}
              disabled={isRetrying}
            >
              {isRetrying ? t("videosPage.retrying") : t("videosPage.retryAnalysis")}
            </Button>
          )}
          <Link
            to={`/teachers/${video.teacher_id}`}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          >
            {t("videosPage.teacherPage")}
          </Link>
          <Link
            to={`/videos/${video.id}`}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          >
            {t("videosPage.viewRecording")}
          </Link>
        </div>
      </div>
      <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {t("videosPage.observationSummary")}
          </div>
          <div className="mt-1 line-clamp-2">
            {observationSummary?.executive_summary || assessment?.summary || t("videosPage.noAssessmentSummary")}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {t("videosPage.coachingMoves")}
          </div>
          {(observationSummary?.coaching_actions?.length || assessment?.recommendations?.length) ? (
            <ul className="mt-1 list-disc space-y-1 ps-4">
              {(observationSummary?.coaching_actions || assessment?.recommendations || []).slice(0, 2).map((rec, idx) => (
                <li key={idx}>{rec}</li>
              ))}
            </ul>
          ) : (
            <div className="mt-1 text-xs text-slate-500">
              {t("videosPage.noRecommendations")}
            </div>
          )}
        </div>
      </div>
      {observationSummary?.priority_alignment?.length ? (
        <div className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-800">
          <div className="font-semibold text-sky-900">{t("videosPage.priorityAlignment")}</div>
          <div className="mt-1 line-clamp-2">
            {observationSummary.priority_alignment.join(" • ")}
          </div>
        </div>
      ) : null}
      {video.error_message && (
        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
          {video.error_message}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="mt-3 inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
      >
        {open ? t("videosPage.hideDetailedAssessment") : t("videosPage.viewDetailedAssessment")}
      </button>
      {open && (
        <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700">
          {elementOptions.length === 0 ? (
            <div className="text-xs text-slate-500">{t("videosPage.noDetailedScores")}</div>
          ) : (
            <div className="space-y-2">
              {elementOptions.map((el) => (
                <div key={el.element_id} className="rounded-md bg-slate-50 px-2 py-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-800">{el.element_name}</span>
                    <span className="text-slate-600">{formatScore(el.score)}/10</span>
                  </div>
                  {(evidenceByElement[el.element_id] || []).length ? (
                    <ul className="mt-1 space-y-1 text-[11px] text-slate-600">
                      {evidenceByElement[el.element_id].slice(0, 2).map((ev) => (
                        <li key={ev.id}>
                          {ev.evidence_text}{" "}
                          {typeof ev.timestamp_start === "number" && (
                            <span className="text-slate-400">
                              ({formatTimestampRange(ev.timestamp_start, ev.timestamp_end)})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-1 text-[11px] text-slate-500">
                      {t("videosPage.noEvidenceYet")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {isAdmin && assessment && (
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px]">
              <div className="mb-2 font-semibold text-slate-700">
                {t("videosPage.adminCommentAdjustment")}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                  value={selectedDomain}
                  onChange={(e) => setSelectedDomain(e.target.value)}
                >
                  <option value="">{t("videosPage.selectDomain")}</option>
                  {elementOptions.map((el) => (
                    <option key={el.element_id} value={el.element_id}>
                      {el.element_name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  max="10"
                  value={adjustedScore}
                  onChange={(e) => setAdjustedScore(e.target.value)}
                  placeholder={t("videosPage.adjustedScore")}
                  className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                />
              </div>
              <textarea
                rows={2}
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder={t("videosPage.adminCommentPlaceholder")}
                className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
              />
              <button
                type="button"
                onClick={() => {
                  if (!selectedDomain || !adjustedScore) {
                    toast.error(t("videosPage.selectDomainAndScore"));
                    return;
                  }
                  const adjusted = parseFloat(adjustedScore);
                  if (Number.isNaN(adjusted)) {
                    toast.error(t("videosPage.enterValidScore"));
                    return;
                  }
                  const original =
                    elementOptions.find((el) => el.element_id === selectedDomain)?.score ??
                    adjusted;
                  overrideMutation.mutate({
                    domain_id: selectedDomain,
                    original_score: original,
                    adjusted_score: adjusted,
                    rationale: adminNote || t("videosPage.adminCommentAdjustment"),
                  });
                }}
                className="mt-2 inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-white hover:bg-primary/90"
              >
                {t("videosPage.saveAdjustment")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
