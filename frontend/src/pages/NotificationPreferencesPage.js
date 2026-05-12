import React, { useEffect, useState } from "react";
import api from "@/lib/api";

const DEFAULT_PREFERENCES = {
  email_notifications: true,
  feedback_updates: true,
  access_updates: true,
  system_updates: true,
  weekly_digest: false,
};

const normalizePreferences = (payload) => ({
  ...DEFAULT_PREFERENCES,
  ...(payload?.preferences || payload?.data || payload || {}),
});

const preferenceLabels = [
  {
    key: "email_notifications",
    title: "Email notifications",
    description: "Receive important Cognivio updates by email.",
  },
  {
    key: "feedback_updates",
    title: "Feedback updates",
    description: "Get notified when new feedback, reviews, or analysis results are available.",
  },
  {
    key: "access_updates",
    title: "Access and approval updates",
    description: "Receive updates about account approvals, organization access, and permissions.",
  },
  {
    key: "system_updates",
    title: "System updates",
    description: "Receive important platform and workflow notifications.",
  },
  {
    key: "weekly_digest",
    title: "Weekly digest",
    description: "Receive a weekly summary of activity and growth signals.",
  },
];

export default function NotificationPreferencesPage() {
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [status, setStatus] = useState("loading");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadPreferences = async () => {
      setStatus("loading");
      setError("");

      try {
        const response = await api.get("/notifications/preferences");
        if (!active) return;

        setPreferences(normalizePreferences(response?.data));
        setStatus("ready");
      } catch (err) {
        if (!active) return;

        setPreferences(DEFAULT_PREFERENCES);
        setError(
          err?.response?.data?.detail ||
            err?.message ||
            "Notification preferences are using default settings."
        );
        setStatus("ready");
      }
    };

    loadPreferences();

    return () => {
      active = false;
    };
  }, []);

  const updatePreference = (key) => {
    setMessage("");
    setError("");
    setPreferences((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const savePreferences = async () => {
    setSaving(true);
    setMessage("");
    setError("");

    try {
      await api.put("/notifications/preferences", preferences);
      setMessage("Notification preferences saved.");
    } catch (err) {
      setError(
        err?.response?.data?.detail ||
          err?.message ||
          "Could not save notification preferences right now."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Account Settings
          </p>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">
            Notification Preferences
          </h1>
          <p className="mt-2 text-slate-600">
            Choose which Cognivio updates you want to receive.
          </p>
        </div>

        {status === "loading" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-slate-600">Loading preferences…</p>
          </div>
        )}

        {status === "ready" && (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="divide-y divide-slate-100">
              {preferenceLabels.map((item) => (
                <label
                  key={item.key}
                  className="flex cursor-pointer items-start justify-between gap-4 p-5"
                >
                  <div>
                    <h2 className="font-semibold text-slate-900">{item.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      {item.description}
                    </p>
                  </div>

                  <input
                    type="checkbox"
                    checked={Boolean(preferences[item.key])}
                    onChange={() => updatePreference(item.key)}
                    className="mt-1 h-5 w-5 rounded border-slate-300"
                  />
                </label>
              ))}
            </div>

            <div className="border-t border-slate-100 p-5">
              {error && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {error}
                </div>
              )}

              {message && (
                <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  {message}
                </div>
              )}

              <button
                type="button"
                onClick={savePreferences}
                disabled={saving}
                className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save preferences"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}