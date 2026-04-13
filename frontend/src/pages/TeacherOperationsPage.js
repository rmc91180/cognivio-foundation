import React, { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, PageContextHeader, Panel, SectionHeader } from "@/components/ui";
import { privacyProfileApi, teacherApi } from "@/lib/api";

export function TeacherOperationsPage() {
  const { teacherId } = useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [referenceFiles, setReferenceFiles] = useState([]);

  const { data: teacherRes } = useQuery({
    queryKey: ["teacher", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.get(teacherId).then((res) => res.data),
  });

  const { data: privacyProfileRes } = useQuery({
    queryKey: ["teacher-privacy-profile", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => privacyProfileApi.get(teacherId).then((res) => res.data),
  });

  const savePrivacyMutation = useMutation({
    mutationFn: (files) => {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      return privacyProfileApi.upload(teacherId, formData);
    },
    onSuccess: () => {
      toast.success(t("teacherOperations.privacySaved"));
      setReferenceFiles([]);
      queryClient.invalidateQueries({ queryKey: ["teacher-privacy-profile", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["teacher", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["videos"] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(
        typeof detail === "string" ? detail : detail?.message || t("teacherOperations.privacySaveFailed")
      );
    },
  });

  const privacyReady = privacyProfileRes?.status === "active";
  const linkedAdmin = teacherRes?.manager_name || teacherRes?.manager_email || t("teacherOperations.notAssigned");

  return (
    <LayoutShell>
      <div className="mx-auto max-w-5xl px-6 py-6">
        <PageContextHeader
          breadcrumbs={[
            { label: t("nav.masterAdmin"), to: "/master-admin" },
            { label: t("nav.teachers"), to: "/teachers" },
            { label: teacherRes?.name || t("teacherProfile.fallbackTeacher"), to: `/teachers/${teacherId}` },
            { label: t("teacherOperations.title") },
          ]}
          title={t("teacherOperations.title")}
          description={t("teacherOperations.description")}
          meta={teacherRes?.name || t("teacherProfile.fallbackTeacher")}
          stats={[
            {
              label: t("teacherOperations.schoolLabel"),
              value: teacherRes?.school_name || t("teacherOperations.notAssigned"),
            },
            {
              label: t("teacherOperations.organizationLabel"),
              value: teacherRes?.organization_name || t("teacherOperations.notAssigned"),
            },
            {
              label: t("teacherOperations.linkedAdminLabel"),
              value: linkedAdmin,
            },
          ]}
          quickLinks={[
            { label: t("teacherOperations.openTeacherSummary"), to: `/teachers/${teacherId}` },
            { label: t("teacherOperations.openVideos"), to: `/videos?teacher_id=${teacherId}` },
            { label: t("teacherOperations.openPrivacyReview"), to: `/privacy-review?teacher_id=${teacherId}` },
          ]}
        />

        <Panel className="space-y-4">
          <SectionHeader
            eyebrow={t("teacherOperations.privacyEyebrow")}
            title={t("teacherOperations.privacyTitle")}
            description={t("teacherOperations.privacyDescription")}
          />
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-sm font-medium text-slate-800">
              {privacyReady
                ? t("teacherOperations.privacyReady", { count: privacyProfileRes?.reference_count || 0 })
                : t("teacherOperations.privacyNotReady")}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {t("teacherOperations.privacyHint")}
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => setReferenceFiles(Array.from(event.target.files || []))}
            className="hidden"
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
            >
              {t("teacherProfile.chooseFiles")}
            </button>
            <span className="text-xs text-slate-500">
              {referenceFiles.length
                ? t("teacherProfile.referenceFilesSelected", { count: referenceFiles.length })
                : t("teacherProfile.noFilesSelected")}
            </span>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={() => savePrivacyMutation.mutate(referenceFiles)}
              disabled={savePrivacyMutation.isPending || referenceFiles.length === 0}
            >
              {savePrivacyMutation.isPending
                ? t("teachersPage.saving")
                : t("teacherProfile.savePrivacyProfile")}
            </Button>
            <Link
              to={`/videos?teacher_id=${teacherId}`}
              className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {t("teacherOperations.continueToUpload")}
            </Link>
          </div>
        </Panel>
      </div>
    </LayoutShell>
  );
}
