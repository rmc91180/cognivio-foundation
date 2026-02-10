import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { assessmentApi, teacherApi, videoApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { toast } from "sonner";

export function VideosPage() {
  const queryClient = useQueryClient();
  const [selectedTeacher, setSelectedTeacher] = useState("");
  const [file, setFile] = useState(null);

  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers"],
    queryFn: () => teacherApi.list().then((res) => res.data),
  });

  const { data: videos = [], isLoading: loadingVideos } = useQuery({
    queryKey: ["videos", { teacherId: selectedTeacher || undefined }],
    queryFn: () =>
      videoApi
        .list({ teacher_id: selectedTeacher || undefined })
        .then((res) => res.data),
  });

  const { data: assessments = [], isLoading: loadingAssessments } = useQuery({
    queryKey: ["assessments"],
    queryFn: () => assessmentApi.list().then((res) => res.data),
  });

  const uploadMutation = useMutation({
    mutationFn: (payload) => {
      const formData = new FormData();
      formData.append("file", payload.file);
      formData.append("teacher_id", payload.teacherId);
      return videoApi.upload(formData);
    },
    onSuccess: () => {
      toast.success("Video uploaded, analysis started");
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["assessments"] });
      setFile(null);
    },
    onError: (error) => {
      toast.error(
        error?.response?.data?.detail || "Failed to upload video for analysis"
      );
    },
  });

  const onSubmit = (e) => {
    e.preventDefault();
    if (!file || !selectedTeacher) {
      toast.error("Select a teacher and video file");
      return;
    }
    uploadMutation.mutate({ file, teacherId: selectedTeacher });
  };

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="font-heading text-2xl font-semibold text-slate-900">
              Videos & Assessments
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Upload classroom videos and review AI-generated assessments.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          <div className="md:col-span-5">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Upload video
              </h2>
              <form onSubmit={onSubmit} className="space-y-3 text-sm">
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Teacher
                  </label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                    value={selectedTeacher}
                    onChange={(e) => setSelectedTeacher(e.target.value)}
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
                    Video file
                  </label>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="mt-1 w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700"
                  />
                </div>
                <button
                  type="submit"
                  disabled={uploadMutation.isPending}
                  className="mt-2 inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-xs font-medium text-white shadow-lg shadow-primary/30 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {uploadMutation.isPending
                    ? "Uploading..."
                    : "Upload & analyze"}
                </button>
              </form>
            </div>
          </div>

          <div className="space-y-6 md:col-span-7">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Recent videos
              </h2>
              {loadingVideos ? (
                <div className="text-xs text-slate-500">Loading videos...</div>
              ) : videos.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-xs text-slate-500">
                  No videos uploaded yet.
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  {videos.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div>
                        <div className="font-medium text-slate-900">
                          {v.filename}
                        </div>
                        <div className="text-xs text-slate-500">
                          {v.upload_date} • {v.status}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Recent assessments
              </h2>
              {loadingAssessments ? (
                <div className="text-xs text-slate-500">
                  Loading assessments...
                </div>
              ) : assessments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-xs text-slate-500">
                  No assessments yet. Upload a classroom video to generate your
                  first one.
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  {assessments.slice(0, 5).map((a) => (
                    <div
                      key={a.id}
                      className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-slate-900">
                          Overall {a.overall_score.toFixed(2)}/4
                        </div>
                        <div className="text-xs text-slate-500">
                          {a.analyzed_at}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-slate-600 line-clamp-2">
                        {a.summary}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}

