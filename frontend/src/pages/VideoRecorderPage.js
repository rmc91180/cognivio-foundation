import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutShell } from "@/components/LayoutShell";
import { VideoRecorder } from "@/components/VideoRecorder";
import { teacherApi, videoApi } from "@/lib/api";
import { toast } from "sonner";

export function VideoRecorderPage() {
  const queryClient = useQueryClient();
  const [selectedTeacher, setSelectedTeacher] = useState("");
  const [subject, setSubject] = useState("");
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedUrl, setRecordedUrl] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [queued, setQueued] = useState(false);

  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers"],
    queryFn: () => teacherApi.list().then((res) => res.data),
  });

  const selectedTeacherObj = useMemo(
    () => teachers.find((t) => t.id === selectedTeacher),
    [teachers, selectedTeacher]
  );

  const uploadMutation = useMutation({
    mutationFn: ({ file, teacherId, subjectValue, recordedAt }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("teacher_id", teacherId);
      if (subjectValue) formData.append("subject", subjectValue);
      if (recordedAt) formData.append("recorded_at", recordedAt);
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
      toast.success("Uploaded. Queued for analysis.");
      setQueued(true);
      setUploadProgress(0);
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["assessments"] });
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || "Upload failed");
      setUploadProgress(0);
    },
  });

  const handleUpload = () => {
    if (!recordedBlob || !selectedTeacher) {
      toast.error("Select a teacher and record a video first.");
      return;
    }
    setQueued(false);
    const subjectValue = subject || selectedTeacherObj?.subject || "";
    const recordedAt = new Date().toISOString();
    const file = new File([recordedBlob], "class-recording.webm", {
      type: recordedBlob.type || "video/webm",
    });
    uploadMutation.mutate({
      file,
      teacherId: selectedTeacher,
      subjectValue,
      recordedAt,
    });
  };

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-semibold text-slate-900">
            Record Classroom Video
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Record directly in the browser, then upload for AI analysis.
          </p>
        </div>

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
                Recording metadata
              </h2>
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Teacher
                  </label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                    value={selectedTeacher}
                    onChange={(e) => {
                      setSelectedTeacher(e.target.value);
                      const teacher = teachers.find((t) => t.id === e.target.value);
                      setSubject(teacher?.subject || "");
                    }}
                  >
                    <option value="">Select a teacher</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} • {t.subject}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Subject
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
                    Recording ready to upload.
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={uploadMutation.isPending}
                  className="mt-2 inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-xs font-medium text-white shadow-lg shadow-primary/30 hover:bg-primary/90 disabled:opacity-60"
                >
                  {uploadMutation.isPending ? "Uploading..." : "Upload & queue"}
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
                      Upload progress: {uploadProgress}%
                    </div>
                  </div>
                )}
                {queued && (
                  <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
                    Queued for analysis. Check Videos & Assessments for status.
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
