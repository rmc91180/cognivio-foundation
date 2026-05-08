import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, PageContextHeader, Panel } from "@/components/ui";
import { notificationApi } from "@/lib/api";

const EMAIL_TOGGLES = [
  ["email_observation_complete", "Lesson feedback reviewed"],
  ["email_goal_added", "Coaching goal updates"],
  ["email_recognition", "Recognition updates"],
  ["email_conference_reminder", "Conference reminders"],
];

export function NotificationPreferencesPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null);
  const { data } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => notificationApi.preferences().then((res) => res.data),
    onSuccess: (prefs) => setForm(prefs),
  });
  const prefs = form || data || {};

  const mutation = useMutation({
    mutationFn: (payload) => notificationApi.updatePreferences(payload).then((res) => res.data),
    onSuccess: (next) => {
      setForm(next);
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
      toast.success("Notification preferences saved");
    },
  });

  function setValue(key, value) {
    setForm((current) => ({ ...(current || data || {}), [key]: value }));
  }

  return (
    <LayoutShell>
      <div className="mx-auto max-w-4xl px-6 py-6">
        <PageContextHeader
          breadcrumbs={[{ label: "Settings" }, { label: "Notifications" }]}
          title="Notification preferences"
          description="Choose how Cognivio keeps you updated about feedback, goals, recognition, and prep reminders."
        />
        <Panel className="space-y-6">
          <div className="space-y-3">
            {EMAIL_TOGGLES.map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3">
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{label}</span>
                  <span className="block text-xs text-slate-500">Email me when this happens.</span>
                </span>
                <input
                  type="checkbox"
                  checked={prefs[key] !== false}
                  onChange={(event) => setValue(key, event.target.checked)}
                  className="h-5 w-5 accent-teal-600"
                />
              </label>
            ))}
          </div>

          <label className="block text-sm font-semibold text-slate-900">
            Email frequency
            <select
              value={prefs.email_frequency || "immediate"}
              onChange={(event) => setValue("email_frequency", event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="immediate">Immediately</option>
              <option value="daily_digest">Daily digest</option>
              <option value="off">Off</option>
            </select>
          </label>

          <Button onClick={() => mutation.mutate(prefs)} disabled={mutation.isPending}>
            Save preferences
          </Button>
        </Panel>
      </div>
    </LayoutShell>
  );
}
