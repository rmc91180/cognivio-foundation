import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, ErrorState, Field, Input, LoadingState, PageContextHeader, Panel } from "@/components/ui";
import { teacherApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

const profileReturnTarget = (location) => {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get("returnTo");
  const fromState = location.state?.returnTo || location.state?.from;
  return fromQuery || fromState || "/my-lessons";
};

export function TeacherSelfProfilePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const returnTo = useMemo(() => profileReturnTarget(location), [location]);
  const [form, setForm] = useState({
    name: "",
    grade_level: "",
    department: "",
    subject: "",
    category: "",
  });

  const profileQuery = useQuery({
    queryKey: ["teacher-self-profile"],
    queryFn: () => teacherApi.currentProfile().then((res) => res.data),
    retry: 1,
  });

  useEffect(() => {
    const profile = profileQuery.data?.profile;
    if (!profile) return;
    setForm({
      name: profile.name || "",
      grade_level: profile.grade_level || "",
      department: profile.department || "",
      subject: profile.subject || "",
      category: profile.category || "",
    });
  }, [profileQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => teacherApi.updateCurrentProfile(form),
    onSuccess: async () => {
      toast.success("Profile saved.");
      queryClient.invalidateQueries({ queryKey: ["teacher-self-profile"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-lessons"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-coaching"] });
      try {
        await refreshUser();
      } catch {
        // The profile is saved even if the session refresh needs the next page load.
      }
      navigate(returnTo, { replace: true });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Your profile could not be saved right now.");
    },
  });

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const canSave = form.subject.trim() && form.grade_level.trim();

  return (
    <LayoutShell>
      <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6 sm:py-6">
        <PageContextHeader
          breadcrumbs={[{ label: "My Workspace", to: "/my-workspace" }, { label: "Teacher profile" }]}
          title="Finish your teacher profile"
          description="Add the basic lesson context Cognivio needs before your recordings and coaching notes can stay connected to you."
          badge="Teacher setup"
        />

        {profileQuery.isLoading ? <LoadingState message="Opening your profile..." /> : null}
        {profileQuery.isError ? (
          <ErrorState
            title="Your profile could not be opened"
            message="Try again in a moment. If this keeps happening, ask your administrator to confirm your teacher account is linked."
          />
        ) : null}

        {!profileQuery.isLoading && !profileQuery.isError ? (
          <Panel className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name">
                <Input value={form.name} onChange={updateField("name")} placeholder="Your name" />
              </Field>
              <Field label="Grade level">
                <Input value={form.grade_level} onChange={updateField("grade_level")} placeholder="For example, Grade 7" required />
              </Field>
              <Field label="Class or section">
                <Input value={form.department} onChange={updateField("department")} placeholder="For example, Period 2" />
              </Field>
              <Field label="Subject">
                <Input value={form.subject} onChange={updateField("subject")} placeholder="For example, English Language Arts" required />
              </Field>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              <div className="font-semibold text-slate-900">Privacy setup</div>
              <p className="mt-1">
                Consent and privacy details stay separate from your teaching profile. You can review them any time from the privacy page.
              </p>
              <Link to="/privacy" className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-primary hover:text-primary/80">
                Open privacy page
              </Link>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" onClick={() => saveMutation.mutate()} disabled={!canSave || saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save profile"}
              </Button>
              <Link
                to={returnTo}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </Link>
            </div>
          </Panel>
        ) : null}
      </div>
    </LayoutShell>
  );
}

export default TeacherSelfProfilePage;
