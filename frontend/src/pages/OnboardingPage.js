import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, PageContextHeader, Panel } from "@/components/ui";
import { frameworkApi, onboardingApi, teacherApi } from "@/lib/api";

const STEPS = [
  "Welcome",
  "School details",
  "Framework",
  "Teachers",
  "Observation settings",
  "Ready",
];

export function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [school, setSchool] = useState({ name: "", country: "", language: "English", type: "k12", admin_contact: "" });
  const [framework, setFramework] = useState("danielson");
  const [teachers, setTeachers] = useState([{ name: "", email: "", department: "" }]);
  const [settings, setSettings] = useState({ required: 6, start: "September", end: "June", privacy: true });

  const { data: status } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => onboardingApi.status().then((res) => res.data),
  });
  const completeMutation = useMutation({
    mutationFn: (payload) => onboardingApi.complete(payload).then((res) => res.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboarding-status"] }),
  });
  const teacherMutation = useMutation({
    mutationFn: async () => {
      const valid = teachers.filter((teacher) => teacher.name && teacher.email);
      for (const teacher of valid) {
        await teacherApi.create({
          name: teacher.name,
          email: teacher.email,
          subject: "General",
          grade_level: "TBD",
          department: teacher.department,
        });
      }
      return valid.length;
    },
    onSuccess: (count) => toast.success(`${count} teacher${count === 1 ? "" : "s"} added`),
  });

  const progress = status?.completed_count ?? step;
  const frameworks = [
    ["danielson", "Danielson", "A widely used classroom practice framework."],
    ["marshall", "Marshall", "A concise school leadership rubric."],
    ["marzano", "Marzano", "Instructional strategies and learning science."],
    ["custom", "Custom", "Bring your own school or program rubric."],
  ];

  function importCsv(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = String(reader.result || "")
        .split(/\r?\n/)
        .map((row) => row.split(",").map((cell) => cell.trim()))
        .filter((row) => row[0] && row[1]);
      setTeachers(rows.map(([name, email, department]) => ({ name, email, department: department || "" })));
      toast.success(`${rows.length} teachers ready to import`);
    };
    reader.readAsText(file);
  }

  async function next() {
    if (step === 1) await completeMutation.mutateAsync({ step: "workspace_configured" });
    if (step === 2) {
      await frameworkApi.saveSelection({ framework_type: framework }).catch(() => null);
      await completeMutation.mutateAsync({ step: "framework_selected" });
    }
    if (step === 3) {
      await teacherMutation.mutateAsync();
      await completeMutation.mutateAsync({ step: "first_teacher_added" });
    }
    if (step === 4) await completeMutation.mutateAsync({ step: "observation_settings_configured" });
    setStep((value) => Math.min(value + 1, STEPS.length - 1));
  }

  const content = useMemo(() => {
    if (step === 0) {
      return (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-slate-950">Let's get your school set up in 10 minutes</h2>
          <p className="text-slate-600">We will configure your workspace, pick a framework, add teachers, and get you ready for the first observation.</p>
        </div>
      );
    }
    if (step === 1) {
      return (
        <div className="grid gap-3 md:grid-cols-2">
          {[
            ["name", "School or program name"],
            ["country", "Country"],
            ["language", "Language"],
            ["admin_contact", "Admin contact"],
          ].map(([key, label]) => (
            <label key={key} className="text-sm font-semibold text-slate-700">
              {label}
              <input value={school[key]} onChange={(e) => setSchool({ ...school, [key]: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
          ))}
          <label className="text-sm font-semibold text-slate-700">
            Type
            <select value={school.type} onChange={(e) => setSchool({ ...school, type: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
              <option value="k12">K-12 School</option>
              <option value="training">Training Program</option>
            </select>
          </label>
        </div>
      );
    }
    if (step === 2) {
      return (
        <div className="grid gap-3 md:grid-cols-4">
          {frameworks.map(([id, title, body]) => (
            <button key={id} type="button" onClick={() => setFramework(id)} className={`rounded-xl border p-4 text-left ${framework === id ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-white"}`}>
              <div className="font-semibold text-slate-950">{title}</div>
              <div className="mt-2 text-sm text-slate-600">{body}</div>
            </button>
          ))}
        </div>
      );
    }
    if (step === 3) {
      return (
        <div className="space-y-3">
          {teachers.map((teacher, index) => (
            <div key={index} className="grid gap-2 md:grid-cols-3">
              <input placeholder="Name" value={teacher.name} onChange={(e) => setTeachers((items) => items.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} className="rounded-lg border border-slate-300 px-3 py-2" />
              <input placeholder="Email" value={teacher.email} onChange={(e) => setTeachers((items) => items.map((item, i) => i === index ? { ...item, email: e.target.value } : item))} className="rounded-lg border border-slate-300 px-3 py-2" />
              <input placeholder="Department" value={teacher.department} onChange={(e) => setTeachers((items) => items.map((item, i) => i === index ? { ...item, department: e.target.value } : item))} className="rounded-lg border border-slate-300 px-3 py-2" />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setTeachers([...teachers, { name: "", email: "", department: "" }])}>Add another</Button>
            <label className="inline-flex cursor-pointer items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
              CSV bulk import
              <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
            </label>
          </div>
        </div>
      );
    }
    if (step === 4) {
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">Required observations per cycle<input type="number" value={settings.required} onChange={(e) => setSettings({ ...settings, required: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="text-sm font-semibold text-slate-700">Cycle start<input value={settings.start} onChange={(e) => setSettings({ ...settings, start: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="text-sm font-semibold text-slate-700">Cycle end<input value={settings.end} onChange={(e) => setSettings({ ...settings, end: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={settings.privacy} onChange={(e) => setSettings({ ...settings, privacy: e.target.checked })} /> Require privacy profile before uploads</label>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-slate-950">Ready to begin</h2>
        <p className="text-slate-600">Your workspace is ready. Plan your first observation or take the guided tour.</p>
      </div>
    );
  }, [framework, frameworks, school, settings, step, teachers]);

  return (
    <LayoutShell>
      <div className="mx-auto max-w-5xl px-6 py-6">
        <PageContextHeader title="Cognivio onboarding" description={`Setup progress: ${progress} of 6 steps complete`} />
        <Panel>
          <div className="mb-6 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-teal-500" style={{ width: `${Math.max(progress, step) / 6 * 100}%` }} />
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {STEPS.map((label, index) => <span key={label} className={`rounded-full px-3 py-1 text-xs font-semibold ${index === step ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>{label}</span>)}
          </div>
          {content}
          <div className="mt-8 flex justify-between">
            <Button variant="secondary" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</Button>
            {step < 5 ? (
              <Button onClick={next}>Continue</Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => { localStorage.setItem("cognivio-tour-pending", "1"); navigate("/dashboard"); }}>Take a tour</Button>
                <Button onClick={async () => { await completeMutation.mutateAsync({ completed: true }); navigate("/observation/new"); }}>Plan your first observation</Button>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </LayoutShell>
  );
}
