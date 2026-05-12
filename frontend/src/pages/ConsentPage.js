import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, PageContextHeader, Panel } from "@/components/ui";
import { consentApi } from "@/lib/api";

const CONSENTS = [
  ["video_recording", "Video recording", "Cognivio stores classroom videos so your observer can review teaching practice."],
  ["ai_analysis", "AI analysis", "Cognivio uses AI to identify lesson evidence and draft coaching feedback."],
  ["data_processing", "Data retention", "Cognivio stores performance records, comments, and action-plan progress for your school."],
];

export function ConsentPage() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState({});
  const { data } = useQuery({ queryKey: ["consent-status"], queryFn: () => consentApi.status().then((res) => res.data) });
  const mutation = useMutation({
    mutationFn: async () => {
      for (const [consent_type] of CONSENTS) {
        await consentApi.grant({ consent_type, granted: true, version: "2026-05" });
      }
    },
    onSuccess: () => {
      toast.success("Consent saved");
      navigate("/my-workspace");
    },
  });
  const allChecked = CONSENTS.every(([key]) => checked[key]);

  return (
    <LayoutShell>
      <div className="mx-auto max-w-3xl px-6 py-6">
        <PageContextHeader
          title="Privacy and consent"
          description="Before you can be observed in Cognivio, please review and confirm how your school uses video and feedback data."
        />
        <Panel className="space-y-5">
          <p className="text-sm leading-6 text-slate-600">
            Cognivio collects classroom videos, AI-supported lesson analysis, observer comments, performance scores, and coaching actions. You can withdraw consent or request your data at any time from the privacy page.
          </p>
          <a className="text-sm font-semibold text-primary" href="/privacy-policy" target="_blank" rel="noreferrer">Read the privacy policy</a>
          <div className="space-y-3">
            {CONSENTS.map(([key, title, body]) => (
              <label key={key} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4">
                <input
                  type="checkbox"
                  checked={Boolean(checked[key] || data?.consents?.[key]?.granted)}
                  onChange={(event) => setChecked((state) => ({ ...state, [key]: event.target.checked }))}
                  className="mt-1 h-5 w-5 accent-teal-600"
                />
                <span>
                  <span className="block font-semibold text-slate-900">{title}</span>
                  <span className="mt-1 block text-sm text-slate-600">{body}</span>
                </span>
              </label>
            ))}
          </div>
          <Button disabled={!allChecked || mutation.isPending} onClick={() => mutation.mutate()}>
            I understand and consent
          </Button>
          {!allChecked ? <p className="text-xs text-slate-500">Limited access mode remains active until all consent items are completed.</p> : null}
        </Panel>
      </div>
    </LayoutShell>
  );
}
