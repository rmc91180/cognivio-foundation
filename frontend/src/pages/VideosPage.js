import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { assessmentApi, teacherApi, videoApi, evidenceApi, privacyProfileApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { toast } from "sonner";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Panel,
  Select,
} from "@/components/ui";

function VideoRow({
  video,
  assessment,
  teacher,
  isAdmin,
  onRetry,
  onRetryPrivacy,
  isRetrying,
  isRetryingPrivacy,
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const observationSummary = assessment?.observation_summary;
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
            {video.recorded_at || video.upload_date}
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
                score: assessment.overall_score?.toFixed(1) ?? "N/A",
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
                    <span className="text-slate-600">{el.score?.toFixed(1)}/10</span>
                  </div>
                  {(evidenceByElement[el.element_id] || []).length ? (
                    <ul className="mt-1 space-y-1 text-[11px] text-slate-600">
                      {evidenceByElement[el.element_id].slice(0, 2).map((ev) => (
                        <li key={ev.id}>
                          {ev.evidence_text}{" "}
                          {typeof ev.timestamp_start === "number" && (
                            <span className="text-slate-400">
                              ({Math.round(ev.timestamp_start)}s-
                              {Math.round(ev.timestamp_end)}s)
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
                    rationale: adminNote || "Admin comment",
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

export function VideosPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = ["admin", "principal", "super_admin"].includes(user?.role);
  const [selectedTeacher, setSelectedTeacher] = useState("");
  const [file, setFile] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [timeRange, setTimeRange] = useState("90");
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const teacherId = params.get("teacher_id");
    if (teacherId) {
      setSelectedTeacher(teacherId);
    }
  }, [location.search]);

  const {
    data: teachers = [],
    isError: teachersError,
  } = useQuery({
    queryKey: ["teachers"],
    queryFn: () => teacherApi.list().then((res) => res.data),
  });

  const {
    data: videos = [],
    isLoading: loadingVideos,
    isError: videosError,
  } = useQuery({
    queryKey: ["videos", { teacherId: selectedTeacher || undefined }],
    queryFn: () =>
      videoApi
        .list({ teacher_id: selectedTeacher || undefined })
        .then((res) => res.data),
  });

  const {
    data: assessments = [],
    isLoading: loadingAssessments,
    isError: assessmentsError,
  } = useQuery({
    queryKey: ["assessments", { teacherId: selectedTeacher || undefined }],
    queryFn: () =>
      assessmentApi
        .list({ teacher_id: selectedTeacher || undefined })
        .then((res) => res.data),
  });

  const assessmentByVideoId = useMemo(() => {
    const map = new Map();
    assessments.forEach((a) => {
      if (a.video_id && !map.has(a.video_id)) {
        map.set(a.video_id, a);
      }
    });
    return map;
  }, [assessments]);

  const subjectOptions = useMemo(() => {
    const set = new Set();
    videos.forEach((v) => {
      if (v.subject) set.add(v.subject);
    });
    return Array.from(set);
  }, [videos]);

  const filteredVideos = useMemo(() => {
    const now = Date.now();
    const rangeDays = Number(timeRange);
    const cutoff = now - rangeDays * 24 * 60 * 60 * 1000;
    return videos.filter((v) => {
      if (statusFilter !== "all" && v.status !== statusFilter) return false;
      if (subjectFilter !== "all" && v.subject !== subjectFilter) return false;
      if (search) {
        const haystack = `${v.filename} ${v.subject || ""}`.toLowerCase();
        if (!haystack.includes(search.toLowerCase())) return false;
      }
      const recorded = v.recorded_at || v.upload_date;
      if (recorded) {
        const ts = Date.parse(recorded);
        if (!Number.isNaN(ts) && ts < cutoff) return false;
      }
      return true;
    });
  }, [videos, statusFilter, subjectFilter, search, timeRange]);

  const { data: selectedTeacherPrivacyProfile } = useQuery({
    queryKey: ["teacher-privacy-profile", selectedTeacher],
    enabled: Boolean(selectedTeacher),
    queryFn: () => privacyProfileApi.get(selectedTeacher).then((r) => r.data),
  });
  const selectedTeacherPrivacyReady = selectedTeacherPrivacyProfile?.status === "active";

  const uploadMutation = useMutation({
    mutationFn: (payload) => {
      const formData = new FormData();
      formData.append("file", payload.file);
      formData.append("teacher_id", payload.teacherId);
      return videoApi.upload(formData);
    },
    onSuccess: () => {
      toast.success(t("videosPage.uploadedQueued"));
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["assessments"] });
      setFile(null);
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(
        typeof detail === "string" ? detail : detail?.message || t("videosPage.uploadFailed")
      );
    },
  });
  const retryMutation = useMutation({
    mutationFn: (videoId) => videoApi.retry(videoId),
    onSuccess: () => {
      toast.success(t("videosPage.analysisRequeued"));
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["assessments"] });
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || t("videosPage.analysisRetryFailed"));
    },
  });
  const retryPrivacyMutation = useMutation({
    mutationFn: (videoId) => videoApi.retryPrivacy(videoId),
    onSuccess: () => {
      toast.success(t("videosPage.privacyRequeued"));
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["assessments"] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : detail?.message || t("videosPage.privacyRetryFailed"));
    },
  });

  const onSubmit = (e) => {
    e.preventDefault();
    if (!file || !selectedTeacher) {
      toast.error(t("videosPage.selectTeacherAndFile"));
      return;
    }
    if (!selectedTeacherPrivacyReady) {
      toast.error(t("videosPage.completePrivacyProfile"));
      return;
    }
    uploadMutation.mutate({ file, teacherId: selectedTeacher });
  };
  const hasLoadError = teachersError || videosError || assessmentsError;

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title={t("videosPage.title")}
          description={t("videosPage.description")}
        />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          <div className="md:col-span-3 space-y-6">
            <Panel>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                {t("videosPage.filters")}
              </h2>
              <div className="space-y-3 text-xs">
                <Field label={t("teachersPage.teacher")}>
                  <Select
                    value={selectedTeacher}
                    onChange={(e) => setSelectedTeacher(e.target.value)}
                    size="sm"
                  >
                    <option value="">{t("videosPage.allTeachers")}</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} • {t.subject}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("teachersPage.subject")}>
                  <Select
                    value={subjectFilter}
                    onChange={(e) => setSubjectFilter(e.target.value)}
                    size="sm"
                  >
                    <option value="all">{t("videosPage.allSubjects")}</option>
                    {subjectOptions.map((subject) => (
                      <option key={subject} value={subject}>
                        {subject}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("videosPage.status")}>
                  <Select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    size="sm"
                  >
                    <option value="all">{t("teachersPage.all")}</option>
                    <option value="queued">{t("videosPage.queued")}</option>
                    <option value="processing">{t("videosPage.processing")}</option>
                    <option value="completed">{t("videosPage.completed")}</option>
                    <option value="failed">{t("videosPage.failed")}</option>
                  </Select>
                </Field>
                <Field label={t("videosPage.timeRange")}>
                  <Select
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value)}
                    size="sm"
                  >
                    <option value="30">{t("videosPage.last30Days")}</option>
                    <option value="60">{t("videosPage.last60Days")}</option>
                    <option value="90">{t("videosPage.last90Days")}</option>
                    <option value="365">{t("videosPage.last12Months")}</option>
                  </Select>
                </Field>
                <Field label={t("videosPage.search")}>
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("videosPage.searchPlaceholder")}
                    size="sm"
                  />
                </Field>
              </div>
            </Panel>
            <Panel>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                {t("videosPage.uploadRecording")}
              </h2>
              <p className="mb-3 text-[11px] text-slate-500">
                {t("videosPage.uploadAccepted")}
              </p>
              {selectedTeacher && (
                <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  {selectedTeacherPrivacyReady
                    ? t("videosPage.privacyProfileReady")
                    : t("videosPage.privacyProfileRequiredBeforeUpload")}
                </div>
              )}
              <form onSubmit={onSubmit} className="space-y-3 text-sm">
                <Field label={t("teachersPage.teacher")}>
                  <Select
                    value={selectedTeacher}
                    onChange={(e) => setSelectedTeacher(e.target.value)}
                    size="sm"
                  >
                    <option value="">{t("videosPage.selectTeacher")}</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} • {t.subject}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("videosPage.videoFile")}>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="mt-1 w-full text-xs text-slate-600 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700"
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={uploadMutation.isPending || (Boolean(selectedTeacher) && !selectedTeacherPrivacyReady)}
                  fullWidth
                  className="mt-2"
                >
                  {uploadMutation.isPending
                    ? t("videosPage.uploading")
                    : Boolean(selectedTeacher) && !selectedTeacherPrivacyReady
                      ? t("videosPage.privacyProfileRequired")
                      : t("videosPage.uploadAnalyze")}
                </Button>
              </form>
            </Panel>
          </div>

          <div className="space-y-6 md:col-span-9">
            <Panel>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {t("videosPage.recordingsLibrary")}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {t("videosPage.recordingsLibraryDescription")}
                  </p>
                </div>
                <div className="text-xs text-slate-500">
                  {t("videosPage.recordingsCount", { count: filteredVideos.length })}
                </div>
              </div>
              {loadingVideos || loadingAssessments ? (
                <LoadingState message={t("videosPage.loadingRecordings")} />
              ) : hasLoadError ? (
                <ErrorState
                  title={t("videosPage.unableToLoadTitle")}
                  message={t("videosPage.unableToLoadMessage")}
                />
              ) : filteredVideos.length === 0 ? (
                <EmptyState
                  title={t("videosPage.noMatchingTitle")}
                  message={t("videosPage.noMatchingMessage")}
                />
              ) : (
                <div className="space-y-3">
                  {filteredVideos.map((v) => {
                    const assessment = assessmentByVideoId.get(v.id);
                    const teacher = teachers.find((t) => t.id === v.teacher_id);
                    return (
                      <VideoRow
                        key={v.id}
                        video={v}
                        assessment={assessment}
                        teacher={teacher}
                        isAdmin={isAdmin}
                        onRetry={(videoId) => retryMutation.mutate(videoId)}
                        onRetryPrivacy={(videoId) => retryPrivacyMutation.mutate(videoId)}
                        isRetrying={retryMutation.isPending && retryMutation.variables === v.id}
                        isRetryingPrivacy={
                          retryPrivacyMutation.isPending && retryPrivacyMutation.variables === v.id
                        }
                      />
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}

