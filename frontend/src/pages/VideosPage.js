import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assessmentApi, teacherApi, videoApi, evidenceApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { toast } from "sonner";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

function VideoRow({ video, assessment, teacher, isAdmin }) {
  const queryClient = useQueryClient();
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
      toast.success("Admin adjustment saved");
      queryClient.invalidateQueries({ queryKey: ["assessments"] });
    },
    onError: () => {
      toast.error("Failed to save admin adjustment");
    },
  });

  const elementOptions = assessment?.element_scores || [];

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-900">
            {teacher?.name || "Teacher"} • {video.subject || "Subject"}
          </div>
          <div className="text-[11px] text-slate-500">
            {video.recorded_at || video.upload_date} • {video.status}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-600">
          {assessment && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
              Score {assessment.overall_score?.toFixed(1) ?? "N/A"}
            </span>
          )}
          <Link
            to={`/teachers/${video.teacher_id}`}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          >
            Teacher page
          </Link>
          <Link
            to={`/videos/${video.id}`}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          >
            View recording
          </Link>
        </div>
      </div>
      <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Summary assessment
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
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="mt-3 inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
      >
        {open ? "Hide detailed assessment" : "View detailed assessment"}
      </button>
      {open && (
        <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700">
          {elementOptions.length === 0 ? (
            <div className="text-xs text-slate-500">No detailed scores yet.</div>
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
                      No evidence yet.
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {isAdmin && assessment && (
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px]">
              <div className="mb-2 font-semibold text-slate-700">
                Admin comment & adjustment
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                  value={selectedDomain}
                  onChange={(e) => setSelectedDomain(e.target.value)}
                >
                  <option value="">Select domain</option>
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
                  placeholder="Adjusted score"
                  className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                />
              </div>
              <textarea
                rows={2}
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="Admin comment or rationale"
                className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
              />
              <button
                type="button"
                onClick={() => {
                  if (!selectedDomain || !adjustedScore) {
                    toast.error("Select a domain and adjusted score");
                    return;
                  }
                  const adjusted = parseFloat(adjustedScore);
                  if (Number.isNaN(adjusted)) {
                    toast.error("Enter a valid score");
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
                Save adjustment
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function VideosPage() {
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
                      <VideoRow
                        key={v.id}
                        video={v}
                        assessment={assessment}
                        teacher={teacher}
                        isAdmin={isAdmin}
                      />
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

