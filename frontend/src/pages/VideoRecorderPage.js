import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutShell } from "@/components/LayoutShell";
import { VideoRecorder } from "@/components/VideoRecorder";
import api, { teacherApi, videoApi } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { isTeacherUser } from "@/lib/userRoutes";

const normalizeTeachers = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.teachers)) return payload.teachers;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};

const normalizeSessions = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.sessions)) return payload.sessions;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};

const uploadBlockerLink = (code) => {
  if (code === "PRIVACY_CONSENT_REQUIRED") return "/consent";
  if (code === "TEACHER_PROFILE_REQUIRED") return "/my-profile";
  if (code === "REFERENCE_IMAGES_REQUIRED") return "/my-profile#privacy-reference-images";
  return "";
};

const uploadBlockerLabel = (code) => {
  if (code === "PRIVACY_CONSENT_REQUIRED") return "Open privacy consent";
  if (code === "TEACHER_PROFILE_REQUIRED") return "Open Teacher Profile";
  if (code === "REFERENCE_IMAGES_REQUIRED") return "Open reference photos";
  return "Open setup";
};

export function VideoRecorderPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const requestedTeacherId = searchParams.get("teacher_id") || "";
  const requestedSessionId = searchParams.get("session_id") || "";
  const [selectedTeacher, setSelectedTeacher] = useState(requestedTeacherId);
  const [subject, setSubject] = useState("");
  const [lessonTitle, setLessonTitle] = useState("");
  const [classSection, setClassSection] = useState("");
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedUrl, setRecordedUrl] = useState("");
  const [selectedVideoFile, setSelectedVideoFile] = useState(null);
  const [selectedVideoName, setSelectedVideoName] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [queued, setQueued] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadErrorCode, setUploadErrorCode] = useState("");
  const [lastUploadPayload, setLastUploadPayload] = useState(null);
  const [uploadedVideoId, setUploadedVideoId] = useState("");
  const isTeacher = isTeacherUser(user);

  const { data: teachersPayload } = useQuery({
    queryKey: ["teachers"],
    queryFn: () => teacherApi.list().then((res) => res.data),
    enabled: !isTeacher,
  });

  const profileQuery = useQuery({
    queryKey: ["teacher-self-profile"],
    queryFn: () => teacherApi.currentProfile().then((res) => res.data),
    enabled: isTeacher,
  });
  const readiness = profileQuery.data?.readiness || {};
  const readinessBlocker = isTeacher ? (readiness.blockers || [])[0] : null;
  const uploadBlockerMessage = readinessBlocker?.message || "";
  const uploadBlockerHref = uploadBlockerLink(readinessBlocker?.code);
  const uploadErrorHref = uploadBlockerHref || uploadBlockerLink(uploadErrorCode);
  const uploadErrorLinkLabel = uploadBlockerLabel(readinessBlocker?.code || uploadErrorCode);

  const teachers = useMemo(() => normalizeTeachers(teachersPayload), [teachersPayload]);

  const selectedTeacherObj = useMemo(
    () => teachers.find((teacher) => teacher.id === selectedTeacher),
    [teachers, selectedTeacher]
  );

  React.useEffect(() => {
    if (isTeacher) {
      const profile = profileQuery.data?.profile;

      if (!selectedTeacher && (user?.teacher_id || profile?.id)) {
        setSelectedTeacher(user?.teacher_id || profile?.id);
      }

      if (profile) {
        setSubject((current) => current || profile.primary_subject || profile.subject || "");
        setClassSection((current) => current || profile.class_section || profile.department || "");
      }
    } else if (!selectedTeacher && teachers.length === 1) {
      setSelectedTeacher(teachers[0].id);
      setSubject(teachers[0].subject || "");
    }
  }, [isTeacher, selectedTeacher, teachers, user?.teacher_id, profileQuery.data]);

  const pendingSessionsQuery = useQuery({
    queryKey: ["observation-pending-session", selectedTeacher],
    enabled: Boolean(selectedTeacher),
    queryFn: () =>
      api
        .get("/api/observations/sessions/pending", { params: { teacher_id: selectedTeacher } })
        .then((res) => res.data),
    retry: false,
  });

  const pendingSessions = useMemo(
    () => normalizeSessions(pendingSessionsQuery.data),
    [pendingSessionsQuery.data]
  );

  const activeSession = useMemo(() => {
    if (requestedSessionId) {
      return pendingSessions.find((session) => session.id === requestedSessionId) || {
        id: requestedSessionId,
      };
    }

    return pendingSessions[0] || null;
  }, [pendingSessions, requestedSessionId]);

  const uploadMutation = useMutation({
    mutationFn: ({ file, teacherId, subjectValue, recordedAt, lessonTitleValue, classSectionValue }) => {
      const formData = new FormData();
      formData.append("file", file);

      if (!isTeacher && teacherId) formData.append("teacher_id", teacherId);
      if (subjectValue) formData.append("subject", subjectValue);
      if (lessonTitleValue) formData.append("lesson_title", lessonTitleValue);
      if (classSectionValue) formData.append("class_section", classSectionValue);
      if (recordedAt) formData.append("recorded_at", recordedAt);
      if (activeSession?.id) formData.append("observation_session_id", activeSession.id);

      return videoApi.upload(formData, {
        onUploadProgress: (event) => {
          if (event.total) {
            const pct = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(pct);
          }
        },
      });
    },
    onSuccess: (response) => {
      toast.success(t("videoRecorderPage.uploadingQueued"));
      setQueued(true);
      setUploadedVideoId(response?.data?.video?.id || response?.data?.id || response?.data?.video_id || "");
      setUploadProgress(0);
      setUploadError("");
      setUploadErrorCode("");
      setLastUploadPayload(null);
      setSelectedVideoFile(null);
      setSelectedVideoName("");
      setFileInputKey((current) => current + 1);

      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["assessments"] });
      queryClient.invalidateQueries({ queryKey: ["observation-pending-session", selectedTeacher] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      const message =
        typeof detail === "string"
          ? detail
          : detail?.message || t("videoRecorderPage.uploadFailed");

      toast.error(message);
      setUploadError(message);
      setUploadErrorCode(detail?.code || "");
      if (uploadBlockerLink(detail?.code)) {
        setLastUploadPayload(null);
      }
      setUploadProgress(0);
    },
  });

  const clearSelectedVideoFile = () => {
    setSelectedVideoFile(null);
    setSelectedVideoName("");
    setFileInputKey((current) => current + 1);
  };

  const handleVideoFileChange = (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("video/")) {
      toast.error("Please choose a video file.");
      event.target.value = "";
      return;
    }

    setSelectedVideoFile(file);
    setSelectedVideoName(file.name);
    setRecordedBlob(null);
    setRecordedUrl("");
    setQueued(false);
    setUploadError("");
    setUploadProgress(0);
  };

  const buildUploadPayload = () => {
    const fileToUpload = selectedVideoFile;

    if ((!recordedBlob && !fileToUpload) || (!isTeacher && !selectedTeacher)) {
      toast.error(
        isTeacher
          ? "Record a lesson or choose a video file first."
          : "Select a teacher, then record a lesson or choose a video file first."
      );
      return null;
    }

    if (isTeacher && readinessBlocker) {
      const message = uploadBlockerMessage || "Complete teacher setup before uploading videos.";
      toast.error(message);
      setUploadError(message);
      setUploadErrorCode(readinessBlocker.code || "");
      setLastUploadPayload(null);
      return null;
    }

    setQueued(false);
    setUploadError("");
    setUploadErrorCode("");

    const subjectValue = subject || selectedTeacherObj?.subject || "";
    const recordedAt = new Date().toISOString();

    let file = fileToUpload;

    if (!file) {
      const ext = recordedBlob.type?.includes("mp4") ? "mp4" : "webm";
      file = new File([recordedBlob], `class-recording.${ext}`, {
        type: recordedBlob.type || "video/webm",
      });
    }

    return {
      file,
      teacherId: selectedTeacher,
      subjectValue,
      lessonTitleValue: lessonTitle,
      classSectionValue: classSection,
      recordedAt,
    };
  };

  const handleUpload = () => {
    const payload = buildUploadPayload();

    if (!payload) return;

    setLastUploadPayload(payload);
    uploadMutation.mutate(payload);
  };

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-semibold text-slate-900">
            {t("videoRecorderPage.title")}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Record directly in the browser or upload an existing classroom video, then queue it for AI analysis.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          <div className="space-y-4 md:col-span-7">
            <VideoRecorder
              onRecordingReady={(blob, url) => {
                setRecordedBlob(blob);
                setRecordedUrl(url);
                setSelectedVideoFile(null);
                setSelectedVideoName("");
                setFileInputKey((current) => current + 1);
              }}
            />

            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4">
              <div className="text-sm font-semibold text-slate-900">
                Upload an existing classroom video
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Use this when the lesson was recorded outside Cognivio. The selected file will use the metadata on the right and queue through the same analysis pipeline.
              </p>

              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
                  Choose video file
                  <input
                    key={fileInputKey}
                    type="file"
                    accept="video/*"
                    className="sr-only"
                    onChange={handleVideoFileChange}
                  />
                </label>

                {selectedVideoName ? (
                  <div className="flex flex-1 items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <span className="truncate">{selectedVideoName}</span>
                    <button
                      type="button"
                      onClick={clearSelectedVideoFile}
                      className="font-semibold text-slate-900 underline"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">No file selected</div>
                )}
              </div>
            </div>
          </div>

          <div className="md:col-span-5">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              {isTeacher ? (
                <div className={`mb-4 rounded-lg border px-3 py-3 text-sm ${readinessBlocker ? "border-amber-200 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}>
                  <div className="font-semibold">This recording will connect to your teacher workspace.</div>
                  <div className={`mt-2 space-y-1 ${readinessBlocker ? "text-amber-900" : "text-emerald-800"}`}>
                    <div>{readiness.privacy_consent_complete || readiness.consent_complete ? "Privacy consent complete." : "Complete privacy consent before uploading videos."}</div>
                    <div>{readiness.teacher_profile_complete ? "Teacher profile complete." : "Complete your teacher profile before uploading videos."}</div>
                    <div>{readiness.privacy_reference_images_ready ? "Reference images ready." : "Add at least 4 teacher reference photos before uploading videos."}</div>
                  </div>
                  {readinessBlocker && uploadBlockerHref ? (
                    <Link
                      to={uploadBlockerHref}
                      className="mt-2 inline-flex font-semibold text-amber-950 underline"
                    >
                      {uploadBlockerLabel(readinessBlocker.code)}
                    </Link>
                  ) : null}
                </div>
              ) : selectedTeacherObj ? (
                <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-950">
                  <div className="font-semibold">
                    You are observing {selectedTeacherObj.name || selectedTeacherObj.email}.
                  </div>
                  {activeSession?.focus_elements?.length ? (
                    <div className="mt-1 text-sky-800">
                      Focus: {activeSession.focus_elements.join(", ")}
                    </div>
                  ) : pendingSessionsQuery.isFetching ? (
                    <div className="mt-1 text-sky-800">Checking for a saved observation focus...</div>
                  ) : (
                    <div className="mt-1 text-sky-800">
                      No saved focus was found, so this will upload as a standard lesson recording.
                    </div>
                  )}
                </div>
              ) : null}

              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                {t("videoRecorderPage.metadata")}
              </h2>

              <div className="space-y-3 text-xs">
                {!isTeacher ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-600">
                      {t("videoRecorderPage.teacher")}
                    </label>
                    <select
                      className="mt-1 min-h-[44px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-primary/40 focus:ring"
                      value={selectedTeacher}
                      disabled={isTeacher}
                      onChange={(event) => {
                        setSelectedTeacher(event.target.value);
                        const teacher = teachers.find((item) => item.id === event.target.value);
                        setSubject(teacher?.subject || "");
                      }}
                    >
                      <option value="">{t("videoRecorderPage.selectTeacher")}</option>
                      {teachers.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.name} • {teacher.subject}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Lesson title or topic
                  </label>
                  <input
                    type="text"
                    value={lessonTitle}
                    onChange={(event) => setLessonTitle(event.target.value)}
                    placeholder="For example, Comparing fractions"
                    className="mt-1 min-h-[44px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-primary/40 focus:ring"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    {t("videoRecorderPage.subject")}
                  </label>
                  {isTeacher && profileQuery.data?.profile?.subjects?.length ? (
                    <select
                      value={subject}
                      onChange={(event) => setSubject(event.target.value)}
                      className="mt-1 min-h-[44px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-primary/40 focus:ring"
                    >
                      {profileQuery.data.profile.subjects.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={subject}
                      onChange={(event) => setSubject(event.target.value)}
                      className="mt-1 min-h-[44px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-primary/40 focus:ring"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Class or section
                  </label>
                  <input
                    type="text"
                    value={classSection}
                    onChange={(event) => setClassSection(event.target.value)}
                    className="mt-1 min-h-[44px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-primary/40 focus:ring"
                  />
                </div>

                {(recordedUrl || selectedVideoFile) && (
                  <div className="text-[11px] text-slate-500">
                    {selectedVideoFile
                      ? "Selected video ready to upload."
                      : t("videoRecorderPage.readyToUpload")}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={uploadMutation.isPending}
                  className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-lg shadow-primary/30 hover:bg-primary/90 disabled:opacity-60"
                >
                  {uploadMutation.isPending
                    ? t("videoRecorderPage.uploading")
                    : t("videoRecorderPage.uploadQueue")}
                </button>

                {uploadProgress > 0 && (
                  <div className="mt-2">
                    <div className="h-2 w-full rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {t("videoRecorderPage.uploadProgress", { progress: uploadProgress })}
                    </div>
                  </div>
                )}

                {uploadError ? (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                    <div>{uploadError}</div>

                    {uploadErrorHref ? (
                      <Link to={uploadErrorHref} className="mt-2 inline-flex font-semibold text-amber-950 underline">
                        {uploadErrorLinkLabel}
                      </Link>
                    ) : null}

                    {lastUploadPayload ? (
                      <button
                        type="button"
                        onClick={() => uploadMutation.mutate(lastUploadPayload)}
                        className="mt-2 inline-flex min-h-[36px] rounded-md border border-amber-200 bg-white px-3 py-1.5 font-semibold text-amber-950 hover:bg-amber-100"
                      >
                        Retry upload
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {queued && (
                  <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
                    <div>{t(isTeacher ? "videoRecorderPage.queuedMessageTeacher" : "videoRecorderPage.queuedMessage")}</div>

                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      {uploadedVideoId ? (
                        <Link
                          to={`/videos/${uploadedVideoId}`}
                          className="inline-flex min-h-[36px] items-center justify-center rounded-md bg-emerald-950 px-3 py-1.5 font-semibold text-white hover:bg-emerald-900"
                        >
                          Review recording
                        </Link>
                      ) : null}

                      <Link
                        to={isTeacher ? "/my-lessons" : "/dashboard"}
                        className="inline-flex min-h-[36px] items-center justify-center rounded-md border border-emerald-200 bg-white px-3 py-1.5 font-semibold text-emerald-950 hover:bg-emerald-100"
                      >
                        {isTeacher ? "Back to lessons" : "Back to dashboard"}
                      </Link>

                      {activeSession?.id ? (
                        <Link
                          to={`/observation/new?teacher_id=${selectedTeacher}&session_id=${activeSession.id}`}
                          className="inline-flex min-h-[36px] items-center justify-center rounded-md border border-emerald-200 bg-white px-3 py-1.5 font-semibold text-emerald-950 hover:bg-emerald-100"
                        >
                          View observation
                        </Link>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}
