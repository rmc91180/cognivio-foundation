import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { assessmentApi, teacherApi, videoApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { toast } from "sonner";
import { Link, useLocation } from "react-router-dom";

export function VideosPage() {
  const queryClient = useQueryClient();
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
              Review recordings, filter by focus, and take action on insights.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          <div className="md:col-span-3 space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Filters
              </h2>
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600">
                    Teacher
                  </label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                    value={selectedTeacher}
                    onChange={(e) => setSelectedTeacher(e.target.value)}
                  >
                    <option value="">All teachers</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} • {t.subject}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600">
                    Subject
                  </label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                    value={subjectFilter}
                    onChange={(e) => setSubjectFilter(e.target.value)}
                  >
                    <option value="all">All subjects</option>
                    {subjectOptions.map((subject) => (
                      <option key={subject} value={subject}>
                        {subject}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600">
                    Status
                  </label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">All</option>
                    <option value="processing">Processing</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600">
                    Time range
                  </label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value)}
                  >
                    <option value="30">Last 30 days</option>
                    <option value="60">Last 60 days</option>
                    <option value="90">Last 90 days</option>
                    <option value="365">Last 12 months</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600">
                    Search
                  </label>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by filename or subject"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                  />
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Upload recording
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

          <div className="space-y-6 md:col-span-9">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Recordings library
                  </h2>
                  <p className="text-xs text-slate-500">
                    Filter by topic, status, and time to review recordings that matter.
                  </p>
                </div>
                <div className="text-xs text-slate-500">
                  {filteredVideos.length} recordings
                </div>
              </div>
              {loadingVideos || loadingAssessments ? (
                <div className="text-xs text-slate-500">Loading recordings...</div>
              ) : filteredVideos.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-xs text-slate-500">
                  No recordings match the current filters.
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredVideos.map((v) => {
                    const assessment = assessmentByVideoId.get(v.id);
                    const teacher = teachers.find((t) => t.id === v.teacher_id);
                    return (
                      <div
                        key={v.id}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold text-slate-900">
                              {teacher?.name || "Teacher"} • {v.subject || "Subject"}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {v.recorded_at || v.upload_date} • {v.status}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-600">
                            {assessment && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
                                Score {assessment.overall_score?.toFixed(1) ?? "N/A"}
                              </span>
                            )}
                            <Link
                              to={`/teachers/${v.teacher_id}`}
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                            >
                              Teacher page
                            </Link>
                            <Link
                              to={`/videos/${v.id}`}
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                            >
                              View recording
                            </Link>
                          </div>
                        </div>
                        <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              Summary
                            </div>
                            <div className="mt-1 line-clamp-2">
                              {assessment?.summary || "No assessment summary yet."}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              Recommendations
                            </div>
                            {assessment?.recommendations?.length ? (
                              <ul className="mt-1 list-disc space-y-1 pl-4">
                                {assessment.recommendations.slice(0, 2).map((rec, idx) => (
                                  <li key={idx}>{rec}</li>
                                ))}
                              </ul>
                            ) : (
                              <div className="mt-1 text-xs text-slate-500">
                                No recommendations yet.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}

