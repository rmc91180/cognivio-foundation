import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { CoachingTimelinePanel } from "@/components/coaching/CoachingTimelinePanel";
import { useAuth } from "@/hooks/useAuth";
import { assessmentApi, teacherApi } from "@/lib/api";
import { isAdminUser } from "@/lib/userRoutes";

export function ReflectionRecordPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { teacherId: routeTeacherId } = useParams();
  const queryClient = useQueryClient();
  const isAdmin = isAdminUser(user);
  const teacherId = isAdmin ? routeTeacherId : user?.teacher_id || null;
  const isRtl = i18n.dir() === "rtl";

  const { data: teacherRes } = useQuery({
    queryKey: ["teacher", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.get(teacherId).then((r) => r.data),
  });
  const { data: currentReflectionRes } = useQuery({
    queryKey: ["teacher-summary-reflection", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => assessmentApi.teacherSummaryReflection(teacherId).then((r) => r.data),
  });
  const { data: reflectionHistoryRes } = useQuery({
    queryKey: ["teacher-reflection-history", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => assessmentApi.teacherReflectionHistory(teacherId).then((r) => r.data),
  });
  const { data: coachingTimelineRes } = useQuery({
    queryKey: ["teacher-coaching-timeline", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.coachingTimeline(teacherId).then((r) => r.data),
  });

  const [selfReflection, setSelfReflection] = useState("");
  const [actionsTaken, setActionsTaken] = useState("");

  useEffect(() => {
    setSelfReflection(currentReflectionRes?.self_reflection || "");
    setActionsTaken(currentReflectionRes?.actions_taken || "");
  }, [currentReflectionRes]);

  const saveReflectionMutation = useMutation({
    mutationFn: (payload) => assessmentApi.saveTeacherSummaryReflection(teacherId, payload),
    onSuccess: () => {
      toast.success(t("teacherProfile.reflectionSaved"));
      queryClient.invalidateQueries({ queryKey: ["teacher-summary-reflection", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["teacher-reflection-history", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["coaching-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-coaching-timeline", teacherId] });
    },
    onError: () => {
      toast.error(t("teacherProfile.reflectionSaveFailed"));
    },
  });

  const currentEntries = reflectionHistoryRes?.current_entries || [];
  const reflectionHistory = reflectionHistoryRes?.history || [];

  const latestTeacherReflection = useMemo(
    () =>
      currentEntries.find((entry) => entry.author_role === "teacher") ||
      reflectionHistory.find((entry) => entry.author_role === "teacher") ||
      null,
    [currentEntries, reflectionHistory]
  );
  const latestAdminReflection = useMemo(
    () =>
      currentEntries.find((entry) => entry.author_role !== "teacher") ||
      reflectionHistory.find((entry) => entry.author_role !== "teacher") ||
      null,
    [currentEntries, reflectionHistory]
  );

  const editorTitle = isAdmin
    ? t("teacherProfile.adminReflectionTitle")
    : t("teacherProfile.teacherReflection");
  const editorDescription = isAdmin
    ? t("teacherProfile.adminReflectionPlaceholder")
    : t("teacherProfile.teacherReflectionPlaceholder");
  const followThroughTitle = isAdmin
    ? t("teacherProfile.adminFollowThroughTitle")
    : t("teacherWorkspace.currentTeacherResponseTitle");
  const followThroughPlaceholder = isAdmin
    ? t("teacherProfile.adminFollowThroughPlaceholder")
    : t("teacherWorkspace.currentTeacherResponsePlaceholder");

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === "he" ? "he-IL" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language]
  );

  if (!teacherId) {
    return (
      <LayoutShell>
        <div className="mx-auto max-w-5xl px-6 py-6">
          <PageHeader
            title={t("teacherProfile.reflectionRecordTitle")}
            description={t("teacherWorkspace.noLinkedTeacherDescription")}
          />
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="mx-auto max-w-5xl px-6 py-6">
        <PageHeader
          title={t("teacherProfile.reflectionRecordTitle")}
          description={t("teacherProfile.reflectionRecordDescription")}
          meta={
            isAdmin
              ? t("teacherProfile.adminReflectionRecordMeta", {
                  name: teacherRes?.name || t("teacherWorkspace.fallbackName"),
                })
              : t("teacherProfile.sharedReflectionRecordMeta")
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                to={isAdmin ? `/teachers/${teacherId}` : "/my-workspace"}
                className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                {isAdmin
                  ? t("teacherProfile.returnToTeacher")
                  : t("teacherWorkspace.returnHome")}
              </Link>
              <Button
                size="sm"
                onClick={() =>
                  saveReflectionMutation.mutate({
                    self_reflection: selfReflection,
                    actions_taken: actionsTaken,
                  })
                }
                disabled={saveReflectionMutation.isPending}
              >
                {saveReflectionMutation.isPending
                  ? t("teachersPage.saving")
                  : t("teacherProfile.saveReflection")}
              </Button>
            </div>
          }
        />

        <div className="grid gap-4 md:grid-cols-2">
          <Panel>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("teacherProfile.latestTeacherReflectionTitle")}
            </div>
            <div className="mt-2 text-sm text-slate-800">
              {latestTeacherReflection?.self_reflection ||
                t("teacherProfile.noTeacherReflection")}
            </div>
            {latestTeacherReflection?.saved_at ? (
              <div className="mt-2 text-[11px] text-slate-500">
                {dateFormatter.format(new Date(latestTeacherReflection.saved_at))}
              </div>
            ) : null}
          </Panel>
          <Panel>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("teacherProfile.latestAdminReflectionTitle")}
            </div>
            <div className="mt-2 text-sm text-slate-800">
              {latestAdminReflection?.self_reflection ||
                t("teacherProfile.noPrincipalReflection")}
            </div>
            {latestAdminReflection?.saved_at ? (
              <div className="mt-2 text-[11px] text-slate-500">
                {dateFormatter.format(new Date(latestAdminReflection.saved_at))}
              </div>
            ) : null}
          </Panel>
        </div>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <SectionHeader
            title={t("teacherProfile.currentReflectionEntryTitle")}
            description={t("teacherProfile.currentReflectionEntryDescription")}
            eyebrow={t("teacherProfile.recordHistory")}
          />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-600">
                {editorTitle}
              </label>
              <textarea
                rows={5}
                value={selfReflection}
                onChange={(e) => setSelfReflection(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                placeholder={editorDescription}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-600">
                {followThroughTitle}
              </label>
              <textarea
                rows={5}
                value={actionsTaken}
                onChange={(e) => setActionsTaken(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                placeholder={followThroughPlaceholder}
              />
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <SectionHeader
            title={t("teacherProfile.reflectionHistoryTitle")}
            description={t("teacherProfile.reflectionHistoryDescription")}
            eyebrow={t("teacherProfile.recordHistory")}
          />
          <div className="mt-4 space-y-3">
            {reflectionHistory.length ? (
              reflectionHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">
                      {entry.author_name || t("teacherProfile.unknownAuthor")}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {entry.saved_at ? dateFormatter.format(new Date(entry.saved_at)) : ""}
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">
                    {entry.author_role === "teacher"
                      ? t("teacherProfile.teacher")
                      : t("teacherProfile.principal")}
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {t("teacherProfile.reflectionTextLabel")}
                      </div>
                      <div className={`text-xs text-slate-700 ${isRtl ? "text-right" : "text-left"}`}>
                        {entry.self_reflection || t("teacherProfile.noReflectionEntry")}
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {t("teacherProfile.followThroughTextLabel")}
                      </div>
                      <div className={`text-xs text-slate-700 ${isRtl ? "text-right" : "text-left"}`}>
                        {entry.actions_taken || t("teacherProfile.noFollowThroughEntry")}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
                {t("teacherProfile.noReflectionHistory")}
              </div>
            )}
          </div>
        </section>

        <div className="mt-6">
          <CoachingTimelinePanel
            title={t("coachingTimeline.title")}
            description={t("coachingTimeline.description")}
            eyebrow={t("teacherProfile.recordHistory")}
            entries={coachingTimelineRes?.entries || []}
            user={user}
            teacherId={teacherId}
            t={t}
            emptyLabel={t("coachingTimeline.empty")}
            dateFormatter={dateFormatter}
          />
        </div>
      </div>
    </LayoutShell>
  );
}
