import React, { useEffect, useState } from "react";
import api from "@/lib/api";

const normalizeTeachers = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.teachers)) return payload.teachers;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

export default function ObservationSetupPage() {
  const [teachers, setTeachers] = useState([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [focusNote, setFocusNote] = useState("");
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadTeachers = async () => {
      setStatus("loading");
      setError("");

      try {
        const response = await api.get("/teachers");
        if (!active) return;

        setTeachers(normalizeTeachers(response?.data));
        setStatus("ready");
      } catch (err) {
        if (!active) return;

        setTeachers([]);
        setError(
          err?.response?.data?.detail ||
            err?.message ||
            "Teacher list is not available right now."
        );
        setStatus("error");
      }
    };

    loadTeachers();

    return () => {
      active = false;
    };
  }, []);

  const createObservation = async (event) => {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!selectedTeacherId) {
      setError("Choose a teacher before creating an observation.");
      return;
    }

    try {
      await api.post("/observations/sessions", {
        teacher_id: selectedTeacherId,
        focus_note: focusNote,
      });
      setMessage("Observation setup saved.");
      setFocusNote("");
    } catch (err) {
      setError(
        err?.response?.data?.detail ||
          err?.message ||
          "Could not create the observation setup right now."
      );
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Observation
          </p>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">
            Observation Setup
          </h1>
          <p className="mt-2 text-slate-600">
            Prepare a focused observation by choosing the teacher and recording the observation focus.
          </p>
        </div>

        <form
          onSubmit={createObservation}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          {status === "loading" && (
            <p className="text-sm text-slate-600">Loading teachers…</p>
          )}

          {status === "error" && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {error}
            </div>
          )}

          {message && (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {message}
            </div>
          )}

          {status === "ready" && (
            <>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Teacher
                </span>
                <select
                  value={selectedTeacherId}
                  onChange={(event) => setSelectedTeacherId(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
                >
                  <option value="">Select a teacher</option>
                  {teachers.map((teacher, index) => {
                    const id = teacher?.id || teacher?._id || index;
                    const name =
                      teacher?.name ||
                      teacher?.teacher_name ||
                      teacher?.email ||
                      "Unnamed Teacher";

                    return (
                      <option key={id} value={teacher?.id || teacher?._id || ""}>
                        {name}
                      </option>
                    );
                  })}
                </select>
              </label>

              <label className="mt-5 block">
                <span className="text-sm font-medium text-slate-700">
                  Observation focus
                </span>
                <textarea
                  value={focusNote}
                  onChange={(event) => setFocusNote(event.target.value)}
                  rows={5}
                  placeholder="Example: Pay particular attention to questioning, student discussion, or checks for understanding."
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900"
                />
              </label>

              <button
                type="submit"
                className="mt-5 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm"
              >
                Save observation setup
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}