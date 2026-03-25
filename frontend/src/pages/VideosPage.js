import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { assessmentApi, teacherApi, videoApi, privacyProfileApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { toast } from "sonner";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { VideoRow } from "@/features/videos/components/VideoRow";
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

export function VideosPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const fileInputRef = useRef(null);
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
                    <option value="queued">{t("videosPage.analysisQueued")}</option>
                    <option value="processing">{t("videosPage.analysisProcessing")}</option>
                    <option value="completed">{t("videosPage.analysisReady")}</option>
                    <option value="failed">{t("videosPage.analysisFailed")}</option>
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
                  <div className="mt-1 space-y-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {t("videosPage.chooseFile")}
                      </Button>
                      <span className="text-xs text-slate-500">
                        {file ? file.name : t("videosPage.noFileSelected")}
                      </span>
                    </div>
                  </div>
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

