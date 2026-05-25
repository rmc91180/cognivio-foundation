import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, Trash2 } from "lucide-react";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, ErrorState, Field, Input, LoadingState, PageContextHeader, Panel, SectionHeader } from "@/components/ui";
import { demoApi, teacherApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

const ACCEPTED_REFERENCE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;

const profileReturnTarget = (location) => {
  const params = new URLSearchParams(location.search);
  return params.get("returnTo") || location.state?.returnTo || location.state?.from || "/my-workspace";
};

const splitSubjects = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const isSafeReferenceImageFile = (file) => {
  if (!file) return false;
  if (!ACCEPTED_REFERENCE_IMAGE_TYPES.has(file.type)) return false;
  if (file.size > MAX_REFERENCE_IMAGE_BYTES) return false;
  return true;
};

const referenceImageValidationMessage = (file) => {
  if (!file) return "Please choose a PNG, JPG, or WebP image.";
  if (!ACCEPTED_REFERENCE_IMAGE_TYPES.has(file.type)) {
    return "Please choose a PNG, JPG, or WebP image. SVG files are not supported for reference images.";
  }
  if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
    return "Please choose an image smaller than 10 MB.";
  }
  return "Please choose a PNG, JPG, or WebP image.";
};

const toSafeStoredImageUrl = (url) => {
  if (typeof url !== "string" || !url.trim()) return "";

  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.href;
    }
  } catch {
    return "";
  }

  return "";
};

const formatFileSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function TeacherSelfProfilePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const returnTo = useMemo(() => profileReturnTarget(location), [location]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [form, setForm] = useState({
    name: "",
    grade_level: "",
    class_section: "",
    subject: "",
    subjectsText: "",
    primary_subject: "",
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
    const subjects = profile.subjects?.length ? profile.subjects : [profile.subject].filter(Boolean);
    setForm({
      name: profile.name || "",
      grade_level: profile.grade_level || "",
      class_section: profile.class_section || profile.department || "",
      subject: profile.subject || subjects[0] || "",
      subjectsText: subjects.join(", "),
      primary_subject: profile.primary_subject || profile.subject || subjects[0] || "",
      category: profile.category || "",
    });
  }, [profileQuery.data]);

  const invalidateTeacherPages = () => {
    ["teacher-self-profile", "teacher-lessons", "teacher-coaching", "teacher-dashboard", "teacher-recognition"].forEach((key) =>
      queryClient.invalidateQueries({ queryKey: [key] })
    );
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const subjects = splitSubjects(form.subjectsText);
      return teacherApi.updateCurrentProfile({
        name: form.name,
        grade_level: form.grade_level,
        class_section: form.class_section,
        department: form.class_section,
        subject: form.primary_subject || form.subject || subjects[0],
        subjects,
        primary_subject: form.primary_subject || subjects[0],
        category: form.category,
      });
    },
    onSuccess: async () => {
      toast.success("Profile saved.");
      invalidateTeacherPages();
      try {
        await refreshUser();
      } catch {
        // The profile is saved even if the refreshed session arrives on the next page load.
      }
      navigate(returnTo, { replace: true });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Your profile could not be saved right now.");
    },
  });

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!isSafeReferenceImageFile(selectedImage)) {
        throw new Error(referenceImageValidationMessage(selectedImage));
      }

      const data = new FormData();
      data.append("file", selectedImage);
      return teacherApi.uploadReferenceImage(data);
    },
    onSuccess: () => {
      toast.success("Reference image saved.");
      setSelectedImage(null);
      invalidateTeacherPages();
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail || error?.message;
      toast.error(typeof detail === "string" ? detail : "That image could not be saved.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (imageId) => teacherApi.deleteReferenceImage(imageId),
    onSuccess: () => {
      toast.success("Reference image removed.");
      invalidateTeacherPages();
    },
    onError: () => toast.error("That reference image could not be removed right now."),
  });

  const seedMutation = useMutation({
    mutationFn: () => demoApi.seed({ persona: "teacher", scope: "current_teacher" }),
    onSuccess: (response) => {
      const counts = response?.data?.counts || {};
      toast.success(`Demo workspace filled with ${counts.videos || 0} lessons and ${counts.coaching_tasks || 0} goals.`);
      invalidateTeacherPages();
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Demo seeding is available only in demo workspaces.");
    },
  });

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleImageChange = (event) => {
    const file = event.target.files?.[0] || null;

    if (!file) {
      setSelectedImage(null);
      return;
    }

    if (!isSafeReferenceImageFile(file)) {
      setSelectedImage(null);
      event.target.value = "";
      toast.error(referenceImageValidationMessage(file));
      return;
    }

    setSelectedImage(file);
  };

  const readiness = profileQuery.data?.readiness || {};
  const referenceImages = profileQuery.data?.reference_images || [];
  const demoEligible = Boolean(profileQuery.data?.demo_eligible);
  const referenceImageCount = readiness.privacy_reference_images_count ?? readiness.privacy_reference_image_count ?? 0;
  const referenceImageRequiredCount = readiness.privacy_reference_images_required_count || 4;
  const canSave = form.grade_level.trim() && (form.primary_subject.trim() || form.subject.trim() || splitSubjects(form.subjectsText).length);
  const pageTitle = readiness.teacher_profile_complete ? "Teacher Profile" : "Finish your teacher profile";

  return (
    <LayoutShell>
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
        <PageContextHeader
          breadcrumbs={[{ label: "My Workspace", to: "/my-workspace" }, { label: "Teacher Profile" }]}
          title={pageTitle}
          description="Keep your teaching details, privacy status, and reference images connected to your lesson recordings."
          badge={readiness.teacher_profile_complete ? "Edit profile" : "Teacher setup"}
          actions={
            demoEligible ? (
              <Button type="button" variant="secondary" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
                {seedMutation.isPending ? "Filling..." : "Fill my demo workspace"}
              </Button>
            ) : null
          }
        />

        {profileQuery.isLoading ? <LoadingState message="Opening your profile..." /> : null}
        {profileQuery.isError ? (
          <ErrorState
            title="Your profile could not be opened"
            message="Try again in a moment. If this keeps happening, ask your administrator to confirm your teacher account is linked."
          />
        ) : null}

        {!profileQuery.isLoading && !profileQuery.isError ? (
          <div className="space-y-6">
            <Panel className="space-y-5">
              <SectionHeader title="Teaching details" description="These details help your lessons, filters, and coaching notes stay organized." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Display name">
                  <Input value={form.name} onChange={updateField("name")} placeholder="Your name" />
                </Field>
                <Field label="Grade level">
                  <Input value={form.grade_level} onChange={updateField("grade_level")} placeholder="For example, Grade 7" required />
                </Field>
                <Field label="Class or section">
                  <Input value={form.class_section} onChange={updateField("class_section")} placeholder="For example, Period 2" />
                </Field>
                <Field label="Primary subject">
                  <Input value={form.primary_subject} onChange={updateField("primary_subject")} placeholder="For example, English Language Arts" required />
                </Field>
                <Field label="Subjects taught">
                  <Input value={form.subjectsText} onChange={updateField("subjectsText")} placeholder="Math, Science, Discussion seminar" />
                </Field>
                <Field label="Professional stage">
                  <Input value={form.category} onChange={updateField("category")} placeholder="Optional" />
                </Field>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button type="button" onClick={() => saveMutation.mutate()} disabled={!canSave || saveMutation.isPending}>
                  {saveMutation.isPending ? "Saving..." : "Save profile"}
                </Button>
                <Link to={returnTo} className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                  Back
                </Link>
              </div>
            </Panel>

            <Panel id="privacy-reference-images" className="space-y-5">
              <SectionHeader
                title="Privacy & consent"
                description="Privacy reference images support the privacy blur workflow for your classroom recordings. They are not used for login, surveillance, tracking, or general identification."
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Consent</div>
                  <div className="mt-1 font-semibold text-slate-900">{readiness.consent_complete ? "Complete" : "Needs review"}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Privacy reference images</div>
                  <div className="mt-1 font-semibold text-slate-900">{referenceImageCount} of {referenceImageRequiredCount} ready</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Privacy blur pipeline</div>
                  <div className="mt-1 font-semibold text-slate-900">
                    {readiness.privacy_reference_images_ready ? "Reference images are ready" : "Add reference images"}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to="/privacy" className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                  Review privacy settings
                </Link>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <label className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                  <ImagePlus className="h-4 w-4" />
                  Choose reference image
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleImageChange} />
                </label>

                {selectedImage ? (
                  <div className="mt-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500">
                        <ImagePlus className="h-6 w-6" aria-hidden="true" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Reference image selected</div>
                        <div className="text-xs text-slate-600">
                          {selectedImage.name} · {formatFileSize(selectedImage.size)}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">Save this image to add it to your privacy reference set.</div>
                      </div>
                    </div>
                    <Button type="button" onClick={() => uploadMutation.mutate()} disabled={uploadMutation.isPending || !selectedImage}>
                      {uploadMutation.isPending ? "Uploading..." : "Save reference image"}
                    </Button>
                  </div>
                ) : null}
              </div>

              {referenceImages.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {referenceImages.map((image) => {
                    const safeStoredImageUrl = toSafeStoredImageUrl(image.image_url);

                    return (
                      <div key={image.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        {safeStoredImageUrl ? (
                          <img src={safeStoredImageUrl} alt="Teacher reference" className="h-32 w-full rounded-md object-cover" />
                        ) : (
                          <div className="flex h-32 items-center justify-center rounded-md bg-white text-sm text-slate-500">Reference image metadata ready</div>
                        )}
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{image.status || "ready"}</span>
                          <Button type="button" size="sm" variant="secondary" onClick={() => deleteMutation.mutate(image.id)} disabled={deleteMutation.isPending}>
                            <Trash2 className="mr-1 h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                  Add reference images so the privacy blur workflow has what it needs before processing your recordings.
                </div>
              )}
            </Panel>
          </div>
        ) : null}
      </div>
    </LayoutShell>
  );
}

export default TeacherSelfProfilePage;
