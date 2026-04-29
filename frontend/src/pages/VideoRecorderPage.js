import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutShell } from "@/components/LayoutShell";
import { VideoRecorder } from "@/components/VideoRecorder";
import { observationSessionApi, teacherApi, videoApi } from "@/lib/api";
import { toast } from "sonner";

export function VideoRecorderPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const teacherIdFromUrl = searchParams.get("teacher_id") || "";
  const observationSessionId = searchParams.get("observation_session_id") || "";
  const [selectedTeacher, setSelectedTeacher] = useState(teacherIdFromUrl);
  const [subject, setSubject] = useState("");
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedUrl, setRecordedUrl] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [queued, setQueued] = useState(false);

  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers"],
    queryFn: () => teacherApi.list().then((res) => res.data),
  });

  const { data: linkedSession } = useQuery({
    queryKey: ["observation-session", observationSessionId],
    enabled: Boolean(observationSessionId),
    queryFn: () => observationSessionApi.get(observationSessionId).then((res) => res.data),
  });

  useEffect(() => {
    if (linkedSession?.teacher_id) {
      setSelectedTeacher(linkedSession.teacher_id);
      return;
    }
    if (teacherIdFromUrl) {
      setSelectedTeacher(teacherIdFromUrl);
    }
  }, [linkedSession?.teacher_id, teacherIdFromUrl]);

  const selectedTeacherObj = useMemo(
    () => teachers.find((t) => t.id === selectedTeacher),
    [teachers, selectedTeacher]
  );

  useEffect(() => {
    if (selectedTeacherObj?.subject) {
      setSubject((current) => current || selectedTeacherObj.subject);
    }
  }, [selectedTeacherObj?.id, selectedTeacherObj?.subject]);

  const uploadMutation = useMutation({
    mutationFn: ({ file, teacherId, subjectValue, recordedAt, sessionId }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("teacher_id", teacherId);
      if (subjectValue) formData.append("subject", subjectValue);
      if (recordedAt) formData.append("recorded_at", recordedAt);
      if (sessionId) formData.append("observation_session_id", sessionId);
      return videoApi.upload(formData, {
        onUploadProgress: (event) => {
          if (event.total) {
            const pct = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(pct);
          }
        },
      });
    },
    onSuccess: () => {
      toast.success(t("videoRecorderPage.uploadingQueued"));
      setQueued(true);
      setUploadProgress(0);
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["assessments"] });
      queryClient.invalidateQueries({ queryKey: ["observation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-observation-sessions"] });
      if (observationSessionId) {
        queryClient.invalidateQueries({ queryKey: ["observation-session", observationSessionId] });
      }
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || t("videoRecorderPage.uploadFailed"));
      setUploadProgress(0);
    },
  });

  const handleUpload = () => {
    if (!recordedBlob || !selectedTeacher) {
      toast.error(t("videoRecorderPage.selectTeacherAndRecordFirst"));
      return;
    }
    setQueued(false);
    const subjectValue = subject || selectedTeacherObj?.subject || "";
    const recordedAt = new Date().toISOString();
    const ext = recordedBlob.type?.includes("mp4") ? "mp4" : "webm";
    const file = new File([recordedBlob], `class-recording.${ext}`, {
      type: recordedBlob.type || "video/webm",
    });
    uploadMutation.mutate({
      file,
      teacherId: selectedTeacher,
      subjectValue,
      recordedAt,
      sessionId: observationSessionId,
    });
  };

  const focusElements = linkedSession?.focus_elements || [];

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-semibold text-slate-900">
            {t("videoRecorderPage.title")}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {t("videoRecorderPage.description")}
          </p>
        </div>

        {linkedSession ? (
          <div className="mb-6 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <div className="font-semibold">
              Focusing on {focusElements.length ? focusElements.join(", ") : "the planned observation goals"}
            </div>
            {linkedSession.focus_note ? (
              <div className="mt-1 text-xs leading-5 text-sky-800">
                {linkedSession.focus_note}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          <div className="md:col-span-7">
            <VideoRecorder
              onRecordingReady={(blob, url) => {
                setRecordedBlob(blob);
                setRecordedUrl(url);
              }}
            />
          </div>
          <div className="md:col-span-5">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                {t("videoRecorderPage.metadata")}
              </h2>
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    {t("videoRecorderPage.teacher")}
                  </label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                    value={selectedTeacher}
                    disabled={Boolean(linkedSession?.teacher_id)}
                    onChange={(e) => {
                      setSelectedTeacher(e.target.value);
                      const teacher = teachers.find((t) => t.id === e.target.value);
                      setSubject(teacher?.subject || "");
                    }}
                  >
                    <option value="">{t("videoRecorderPage.selectTeacher")}</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} • {t.subject}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    {t("videoRecorderPage.subject")}
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                  />
                </div>
                {recordedUrl && (
                  <div className="text-[11px] text-slate-500">
                    {t("videoRecorderPage.readyToUpload")}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={uploadMutation.isPending}
                  className="mt-2 inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-xs font-medium text-white shadow-lg shadow-primary/30 hover:bg-primary/90 disabled:opacity-60"
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
                {queued && (
                  <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
                    {t("videoRecorderPage.queuedMessage")}
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
