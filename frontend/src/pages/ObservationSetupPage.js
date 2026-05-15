import React, { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import api, { teacherApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, EmptyState, Field, PageHeader, Panel } from "@/components/ui";

const FOCUS_AREAS = [
  "Student discussion",
  "Checks for understanding",
  "Clear directions",
  "Student thinking",
  "Small-group support",
  "Lesson pacing",
];

const normalizeTeachers = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.teachers)) return payload.teachers;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};

export function ObservationSetupPage() {
  const [searchParams] = useSearchParams();
  const requestedTeacherId = searchParams.get("teacher_id") || "";
  const [selectedTeacherId, setSelectedTeacherId] = useState(requestedTeacherId);
  const [focusAreas, setFocusAreas] = useState([]);
  const [focusNote, setFocusNote] = useState("");
  const [savedSession, setSavedSession] = useState(null);

  const teachersQuery = useQuery({
    queryKey: ["observation-setup-teachers"],
    queryFn: () => teacherApi.list().then((res) => res.data),
  });

  const teachers = useMemo(() => normalizeTeachers(teachersQuery.data), [teachersQuery.data]);
  const selectedTeacher = teachers.find((teacher) => teacher.id === selectedTeacherId);

  const createSessionMutation = useMutation({
    mutationFn: (payload) => api.post("/api/observation-sessions", payload).then((res) => res.data),
    onSuccess: (session) => {
      setSavedSession(session);
      setFocusNote("");
    },
  });

  const toggleFocusArea = (area) => {
    setFocusAreas((current) => {
      if (current.includes(area)) {
        return current.filter((item) => item !== area);
      }
      if (current.length >= 3) {
        return current;
      }
      return [...current, area];
    });
  };

  const canSave = selectedTeacherId && focusAreas.length >= 1 && focusAreas.length <= 3;

  return (
    <LayoutShell>
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
        <PageHeader
          title="Plan an observation"
          description="Choose the teacher, name what you want to watch for, and connect the next recording to a clear coaching focus."
        />

        {savedSession ? (
          <Panel className="mb-6 border-emerald-200 bg-emerald-50">
            <h2 className="text-base font-semibold text-emerald-950">Observation focus saved.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-900">
              When the lesson recording is uploaded, Cognivio will connect the feedback to what you were watching for.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Link to={`/record?teacher_id=${savedSession.teacher_id || ""}&session_id=${savedSession.id || ""}`} className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-emerald-950 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-900">
                Upload or record video
              </Link>
              <Link to="/dashboard" className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-100">
                Go back to dashboard
              </Link>
              {savedSession.teacher_id ? (
                <Link to={`/teachers/${savedSession.teacher_id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-100">
                  View teacher profile
                </Link>
              ) : null}
            </div>
          </Panel>
        ) : null}

        <Panel>
          {teachersQuery.isLoading ? <p className="text-sm text-slate-500">Loading teachers...</p> : null}
          {teachersQuery.isError ? (
            <EmptyState
              title="Teacher list is not available right now."
              message="Try again in a moment, then choose the teacher or trainee for this observation."
            />
          ) : null}

          {!teachersQuery.isLoading && !teachersQuery.isError ? (
            <form
              className="space-y-6"
              onSubmit={(event) => {
                event.preventDefault();
                createSessionMutation.mutate({
                  teacher_id: selectedTeacherId,
                  focus_elements: focusAreas,
                  focus_note: focusNote,
                  status: "pending",
                });
              }}
            >
              <Field label="1. Select teacher or trainee">
                <select
                  value={selectedTeacherId}
                  onChange={(event) => setSelectedTeacherId(event.target.value)}
                  className="min-h-[44px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="">Choose a teacher</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.name || teacher.email || "Unnamed teacher"}
                    </option>
                  ))}
                </select>
              </Field>

              <div>
                <div className="text-sm font-semibold text-slate-900">2. Choose observation focus</div>
                <p className="mt-1 text-sm text-slate-500">Choose one to three areas.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {FOCUS_AREAS.map((area) => {
                    const active = focusAreas.includes(area);
                    return (
                      <button
                        key={area}
                        type="button"
                        onClick={() => toggleFocusArea(area)}
                        className={[
                          "min-h-[44px] rounded-md border px-3 py-2 text-left text-sm transition-colors",
                          active
                            ? "border-primary/30 bg-primary/10 font-semibold text-primary"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                        ].join(" ")}
                      >
                        {area}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Field label="3. Add focus note">
                <textarea
                  value={focusNote}
                  onChange={(event) => setFocusNote(event.target.value)}
                  rows={5}
                  placeholder="What do you want Cognivio to pay attention to in this lesson?"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
                />
              </Field>

              {selectedTeacher ? (
                <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  You are planning for {selectedTeacher.name || selectedTeacher.email}.
                </div>
              ) : null}

              {createSessionMutation.isError ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Could not save this observation focus right now.
                </div>
              ) : null}

              <Button type="submit" fullWidth disabled={!canSave || createSessionMutation.isPending}>
                {createSessionMutation.isPending ? "Saving..." : "Save and continue"}
              </Button>
            </form>
          ) : null}
        </Panel>
      </div>
    </LayoutShell>
  );
}
