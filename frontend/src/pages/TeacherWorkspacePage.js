import React, { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { teacherApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { VideoRecorder } from "@/components/VideoRecorder";
import { Button, EmptyState, Field, Input, PageContextHeader, Panel, SectionHeader } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useTeacherWorkspaceData } from "@/pages/teacher-workspace/useTeacherWorkspaceData";
import { resolveCoachingLink } from "@/lib/coachingRoutes";
import { buildInstitutionContextTags } from "@/lib/institutionContext";

function WorkspacePanel({ title, description, eyebrow, children }) {
  return (
    <Panel className="space-y-4 border border-slate-200 bg-white">
      <SectionHeader title={title} description={description} eyebrow={eyebrow} />
      {children}
    </Panel>
  );
}

export function TeacherWorkspacePage() {
  const { t, i18n } = useTranslation();
  const { user, refreshUser } = useAuth();
  const [profileSubject, setProfileSubject] = useState("");
  const [profileGradeLevel, setProfileGradeLevel] = useState("");
  const [profileDepartment, setProfileDepartment] = useState("");
  const location = useLocation();
  const section = useMemo(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    return ["materials", "history"].includes(parts[1]) ? parts[1] : "overview";
  }, [location.pathname]);
  const { refs, state, data, mutations } = useTeacherWorkspaceData({
    teacherId: user?.teacher_id || null,
    teacherName: user?.name,
    teacherSubject: user?.subject,
    t,
    i18n,
  });

  const teacherId = data.teacherId;
  const teacherRes = data.teacherRes;
  const dashboardRes = data.dashboardRes;
  const summaryInsightsRes = data.summaryInsightsRes;
  const privacyProfileRes = data.privacyProfileRes;
  const videos = data.videosRes || [];
  const observations = useMemo(
    () => [...(data.observationsRes || [])].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)),
    [data.observationsRes]
  );
  const latestObservation = observations[0] || null;
  const latestAssessment = useMemo(() => {
    const assessments = dashboardRes?.assessments || [];
    return assessments.length ? assessments[assessments.length - 1] : null;
  }, [dashboardRes]);
  const { data: coachingTasksRes } = useQuery({
    queryKey: ["coaching-tasks", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.coachingTasks({ teacher_id: teacherId }).then((r) => r.data),
  });
  const { data: conferenceAgendaRes } = useQuery({
    queryKey: ["conference-agenda", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.conferenceAgenda(teacherId).then((r) => r.data),
  });
  const { data: adaptiveSupportRes } = useQuery({
    queryKey: ["teacher-adaptive-support", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.adaptiveSupport(teacherId).then((r) => r.data),
  });

  const latestReviewedAt = latestAssessment?.analyzed_at || latestAssessment?.recorded_at || latestAssessment?.created_at || null;
  const nextConferenceAt = teacherRes?.next_coaching_conference || null;
  const privacyReady = privacyProfileRes?.status === "active";
  const linkedAdminName = user?.manager_name || null;
  const linkedAdminEmail = user?.manager_email || null;
  const linkedSchoolName = user?.school_name || null;
  const linkedOrganizationName = user?.organization_name || null;
  const hasLinkedAdminContext = Boolean(
    linkedAdminName || linkedAdminEmail || linkedSchoolName || linkedOrganizationName
  );
  const openGoals = state.actionPlanGoals.filter((goal) => goal?.status !== "complete" && goal?.status !== "implemented");
  const completedGoals = state.actionPlanGoals.filter((goal) => goal?.status === "complete" || goal?.status === "implemented");
  const recurringChallenges = summaryInsightsRes?.recommendations || [];
  const urgentTasks = coachingTasksRes?.tasks || [];
  const isRtl = i18n.dir() === "rtl";
  const elementNameById = useMemo(
    () => (dashboardRes?.element_summary || []).reduce((acc, item) => ({ ...acc, [item.element_id]: item.element_name || item.element_id }), {}),
    [dashboardRes]
  );
  const latestSignals = useMemo(() => {
    const ranked = (latestAssessment?.element_scores || [])
      .map((row) => ({ ...row, label: elementNameById[row.element_id] || row.element_name || row.element_id }))
      .filter((row) => row.label && Number.isFinite(Number(row.score)));
    return {
      strengths: [...ranked].sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 2),
      concerns: [...ranked].sort((a, b) => Number(a.score) - Number(b.score)).slice(0, 2),
    };
  }, [latestAssessment, elementNameById]);

  const formatDateTime = (value) => {
    if (!value) return t("teacherProfile.notConfigured");
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value;
    return new Intl.DateTimeFormat(i18n.language === "he" ? "he-IL" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(parsed));
  };
  const formatScore = (value) => {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return "N/A";
    return new Intl.NumberFormat(i18n.language === "he" ? "he-IL" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(numeric);
  };

  const workspaceLinks = [
    { label: t("teacherWorkspace.currentTitle"), to: "/my-workspace", active: section === "overview" },
    { label: t("teacherWorkspace.goalsTitle"), to: "/my-workspace/coaching?tab=goals" },
    { label: t("teacherWorkspace.reflectionsTitle"), to: "/my-workspace/coaching?tab=reflections" },
    { label: t("teacherWorkspace.materialsTitle"), to: "/my-workspace/materials", active: section === "materials" },
    { label: t("teacherWorkspace.historyTitle"), to: "/my-workspace/history", active: section === "history" },
  ];

  const sectionTitle = section === "materials" ? t("teacherWorkspace.materialsTitle") : section === "history" ? t("teacherWorkspace.historyTitle") : t("teacherWorkspace.title");
  const sectionDescription = section === "materials" ? t("teacherWorkspace.materialsDescription") : section === "history" ? t("teacherWorkspace.historyDescription") : t("teacherWorkspace.description");
  const institutionTags = buildInstitutionContextTags({
    subject: user,
    schoolLabel: t("teacherWorkspace.linkedSchoolLabel"),
    organizationLabel: t("teacherWorkspace.linkedOrganizationLabel"),
    managerLabel: t("teacherWorkspace.linkedAdminNameLabel"),
    unknownLabel: t("teacherWorkspace.linkedAdminNotAssigned"),
  });
  const createSelfProfileMutation = useMutation({
    mutationFn: (payload) => teacherApi.createSelfProfile(payload).then((r) => r.data),
    onSuccess: async () => {
      await refreshUser();
      toast.success(t("teacherWorkspace.profileCreateSuccess"));
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("teacherWorkspace.profileCreateFailed"));
    },
  });

  const renderEmpty = (title, description, ctaLabel, ctaTo) => (
    <EmptyState
      title={title}
      description={description}
      action={ctaLabel && ctaTo ? <Link to={ctaTo} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">{ctaLabel}</Link> : null}
    />
  );

  const renderOverview = () => (
    <div className="space-y-6">
      {hasLinkedAdminContext ? (
        <WorkspacePanel
          title={t("teacherWorkspace.linkedAdminTitle")}
          description={t("teacherWorkspace.linkedAdminDescription")}
          eyebrow={t("teacherWorkspace.linkedAdminEyebrow")}
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t("teacherWorkspace.linkedAdminNameLabel")}
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900">
                {linkedAdminName || t("teacherWorkspace.linkedAdminNotAssigned")}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t("teacherWorkspace.linkedAdminEmailLabel")}
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900">
                {linkedAdminEmail || t("teacherWorkspace.linkedAdminNotAssigned")}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t("teacherWorkspace.linkedSchoolLabel")}
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900">
                {linkedSchoolName || t("teacherWorkspace.linkedAdminNotAssigned")}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t("teacherWorkspace.linkedOrganizationLabel")}
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900">
                {linkedOrganizationName || t("teacherWorkspace.linkedAdminNotAssigned")}
              </div>
            </div>
          </div>
        </WorkspacePanel>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <WorkspacePanel title={t("teacherWorkspace.currentSummaryTitle")} description={t("teacherWorkspace.currentDescription")} eyebrow={t("timeScope.latestClass")}>
          <div className="text-sm text-slate-700">{summaryInsightsRes?.summary || t("teacherProfile.noSummaryData")}</div>
        </WorkspacePanel>
        <WorkspacePanel title={t("teacherWorkspace.currentNextStep")} description={t("teacherWorkspace.startHereDescription")} eyebrow={t("timeScope.immediateFollowUp")}>
          <div className="text-sm text-slate-700">{adaptiveSupportRes?.teacher_prompt_body || summaryInsightsRes?.recommendations?.[0] || openGoals[0]?.title || t("teacherProfile.noNextStepsYet")}</div>
          <div className="flex flex-wrap gap-2">
            <Link to="/my-workspace/reflections" className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">{t("teacherWorkspace.reflectionsOpenRecord")}</Link>
            <Link to="/videos" className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">{t("teacherWorkspace.openVideos")}</Link>
          </div>
        </WorkspacePanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WorkspacePanel title={t("teacherWorkspace.currentUrgentTitle")} description={t("teacherWorkspace.currentDescription")} eyebrow={t("timeScope.immediateFollowUp")}>
          {urgentTasks.length ? (
            <div className="space-y-2">
              {urgentTasks.slice(0, 3).map((task) => (
                <div key={task.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-sm font-semibold text-slate-900">{task.title}</div>
                  <div className="mt-1 text-xs text-slate-600">{task.summary}</div>
                  {task.support_prompt && task.support_prompt !== task.summary ? <div className="mt-2 text-[11px] text-slate-500">{task.support_prompt}</div> : null}
                  <div className="mt-3">
                    <Link to={resolveCoachingLink(user, teacherId, task.route_hint, { videoId: task.video_id })} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">{t("coachingTasks.openTask")}</Link>
                  </div>
                </div>
              ))}
            </div>
          ) : renderEmpty(t("teacherWorkspace.currentUrgentClear"), t("teacherWorkspace.currentDescription"))}
        </WorkspacePanel>
        <WorkspacePanel title={t("teacherProfile.latestAdminComment")} description={t("teacherWorkspace.currentDescription")} eyebrow={t("timeScope.latestClass")}>
          <div className="text-sm text-slate-700">{latestObservation?.admin_comment || t("teacherProfile.noAdminComment")}</div>
        </WorkspacePanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WorkspacePanel title={t("teacherProfile.latestStrengths")} description={t("teacherWorkspace.currentDescription")} eyebrow={t("timeScope.latestClass")}>
          {latestSignals.strengths.length ? <ul className={`list-disc space-y-1 text-sm text-slate-700 ${isRtl ? "pr-5" : "pl-5"}`}>{latestSignals.strengths.map((item) => <li key={item.element_id}>{item.label} ({formatScore(item.score)}/10)</li>)}</ul> : <div className="text-sm text-slate-500">{t("teacherProfile.noRecentHighlights")}</div>}
        </WorkspacePanel>
        <WorkspacePanel title={t("teacherProfile.immediateConcerns")} description={t("teacherWorkspace.currentDescription")} eyebrow={t("timeScope.immediateFollowUp")}>
          {latestSignals.concerns.length ? <ul className={`list-disc space-y-1 text-sm text-slate-700 ${isRtl ? "pr-5" : "pl-5"}`}>{latestSignals.concerns.map((item) => <li key={item.element_id}>{item.label} ({formatScore(item.score)}/10)</li>)}</ul> : <div className="text-sm text-slate-500">{t("teacherProfile.noRecentHighlights")}</div>}
        </WorkspacePanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WorkspacePanel title={t("teacherWorkspace.sharedPlanTitle")} description={t("teacherWorkspace.sharedPlanDescription")} eyebrow={t("timeScope.ongoingGoal")}>
          <div className="text-sm text-slate-700">{openGoals.length ? t("teacherProfile.goalsInMotionCount", { open: openGoals.length, completed: completedGoals.length }) : t("teacherWorkspace.noSharedGoals")}</div>
          <div className="mt-2 text-xs text-slate-500">{t("teacherWorkspace.sharedPlanOwnership")}</div>
          <div className="mt-3"><Link to="/my-workspace/goals" className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">{t("teacherWorkspace.goalsOpenRecord")}</Link></div>
        </WorkspacePanel>
        <WorkspacePanel title={t("teacherProfile.latestTeacherReflectionTitle")} description={t("teacherWorkspace.reflectionsDescription")} eyebrow={t("timeScope.acrossRecentObservations")}>
          <div className="text-sm text-slate-700">{state.selfReflection || t("teacherProfile.noTeacherReflection")}</div>
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("teacherProfile.followThroughTextLabel")}</div>
          <div className="mt-2 text-sm text-slate-700">{state.actionsTaken || t("teacherProfile.noFollowThroughEntry")}</div>
          <div className="mt-3"><Link to="/my-workspace/reflections" className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">{t("teacherWorkspace.reflectionsOpenRecord")}</Link></div>
        </WorkspacePanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WorkspacePanel title={t("teacherProfile.recurringChallenges")} description={t("teacherWorkspace.goalsDescription")} eyebrow={t("timeScope.ongoingGoal")}>
          {recurringChallenges.length ? <ul className={`list-disc space-y-1 text-sm text-slate-700 ${isRtl ? "pr-5" : "pl-5"}`}>{recurringChallenges.slice(0, 3).map((item, idx) => <li key={`challenge-${idx}`}>{item}</li>)}</ul> : <div className="text-sm text-slate-500">{t("teacherProfile.noRecurringChallenges")}</div>}
        </WorkspacePanel>
        <WorkspacePanel title={t("teacherWorkspace.upcomingConferenceTitle")} description={t("teacherWorkspace.upcomingConferenceSyncNote")} eyebrow={t("timeScope.acrossRecentObservations")}>
          <div className="text-sm text-slate-700">{nextConferenceAt ? t("teacherWorkspace.upcomingConferenceStatus", { date: formatDateTime(nextConferenceAt) }) : t("teacherWorkspace.upcomingConferenceNoDate")}</div>
          {(adaptiveSupportRes?.conference_continuity_lines || []).length ? <ul className={`mt-3 list-disc space-y-1 text-sm text-slate-700 ${isRtl ? "pr-5" : "pl-5"}`}>{adaptiveSupportRes.conference_continuity_lines.map((item) => <li key={item}>{item}</li>)}</ul> : null}
          {conferenceAgendaRes?.agenda_items?.length ? <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3"><div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("teacherWorkspace.publishedAgendaTitle")}</div><ul className={`list-disc space-y-1 text-sm text-slate-700 ${isRtl ? "pr-5" : "pl-5"}`}>{conferenceAgendaRes.agenda_items.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
        </WorkspacePanel>
      </div>
    </div>
  );

  const renderMaterials = () => (
    <div className="space-y-6">
      <WorkspacePanel title={t("teacherProfile.privacyIdentityProfile")} description={t("teacherWorkspace.materialsDescription")} eyebrow={t("teacherWorkspace.workspaceTag")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-slate-800">{t("teacherProfile.privacyStatusLabel", { status: privacyReady ? t("teacherProfile.privacyReady", { count: privacyProfileRes?.reference_count || 0 }) : t("teacherProfile.notConfigured") })}</div>
            <div className="mt-1 text-xs text-slate-500">{t("teacherWorkspace.materialsDescription")}</div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => mutations.savePrivacyProfileMutation.mutate(state.privacyReferenceFiles)} disabled={mutations.savePrivacyProfileMutation.isPending || state.privacyReferenceFiles.length === 0}>{mutations.savePrivacyProfileMutation.isPending ? t("teachersPage.saving") : t("teacherProfile.savePrivacyProfile")}</Button>
        </div>
        <input ref={refs.privacyReferenceInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => state.setPrivacyReferenceFiles(Array.from(e.target.files || []))} className="hidden" />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => refs.privacyReferenceInputRef.current?.click()} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">{t("teacherProfile.chooseFiles")}</button>
          <span className="text-[11px] text-slate-500">{state.privacyReferenceFiles.length > 0 ? t("teacherProfile.referenceFilesSelected", { count: state.privacyReferenceFiles.length }) : t("teacherProfile.noFilesSelected")}</span>
        </div>
      </WorkspacePanel>

      <WorkspacePanel title={t("teacherProfile.lessonVideoHub")} description={t("teacherProfile.lessonVideoHubDescription")} eyebrow={t("teacherWorkspace.workspaceTag")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500">{t("teacherWorkspace.openVideos")}</div>
          <Link to={`/videos?teacher_id=${teacherId}`} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100">{t("teacherProfile.openRecordingsPage")}</Link>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <VideoRecorder onRecordingReady={(blob, url) => { state.setRecordedBlob(blob); state.setRecordedUrl(url); }} />
          <div className="space-y-3 text-xs text-slate-600">
            <input type="text" value={state.videoSubject} onChange={(e) => state.setVideoSubject(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800" />
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">{state.recordedUrl ? t("teacherProfile.recordingReady") : t("teacherProfile.noRecordingYet")}</div>
            <Button size="sm" onClick={() => {
              if (!privacyReady) { toast.error(t("teacherProfile.completePrivacyProfileFirst")); return; }
              if (!state.recordedBlob) { toast.error(t("teacherProfile.recordVideoFirst")); return; }
              const ext = state.recordedBlob.type?.includes("mp4") ? "mp4" : "webm";
              const file = new File([state.recordedBlob], `teacher-recording.${ext}`, { type: state.recordedBlob.type || "video/webm" });
              mutations.uploadRecordedMutation.mutate({ file, recordedAt: new Date().toISOString() });
            }} disabled={mutations.uploadRecordedMutation.isPending}>{mutations.uploadRecordedMutation.isPending ? t("teacherProfile.uploading") : t("teacherProfile.uploadRecording")}</Button>
          </div>
        </div>
      </WorkspacePanel>

      <div className="grid gap-4 lg:grid-cols-3">
        {[
          {
            title: t("teacherProfile.curriculum"),
            value: state.curriculumTitle,
            setValue: state.setCurriculumTitle,
            placeholder: t("teacherProfile.curriculumTitle"),
            inputRef: refs.curriculumInputRef,
            file: state.curriculumFile,
            setFile: state.setCurriculumFile,
            save: () => {
              if (!state.curriculumFile) { toast.error(t("teacherProfile.selectCurriculumFile")); return; }
              const formData = new FormData();
              formData.append("teacher_id", teacherId);
              formData.append("title", state.curriculumTitle || "");
              formData.append("file", state.curriculumFile);
              mutations.uploadCurriculumMutation.mutate(formData);
            },
            saving: mutations.uploadCurriculumMutation.isPending,
            saveLabel: t("teacherProfile.uploadCurriculum"),
          },
          {
            title: t("teacherProfile.syllabus"),
            value: state.syllabusTitle,
            setValue: state.setSyllabusTitle,
            placeholder: t("teacherProfile.syllabusTitle"),
            inputRef: refs.syllabusInputRef,
            file: state.syllabusFile,
            setFile: state.setSyllabusFile,
            save: () => {
              if (!state.syllabusFile) { toast.error(t("teacherProfile.selectSyllabusFile")); return; }
              const formData = new FormData();
              formData.append("teacher_id", teacherId);
              formData.append("title", state.syllabusTitle || "");
              formData.append("file", state.syllabusFile);
              mutations.uploadSyllabusMutation.mutate(formData);
            },
            saving: mutations.uploadSyllabusMutation.isPending,
            saveLabel: t("teacherProfile.uploadSyllabus"),
          },
        ].map((item) => (
          <Panel key={item.title}>
            <div className="mb-2 font-semibold text-slate-700">{item.title}</div>
            <input type="text" placeholder={item.placeholder} value={item.value} onChange={(e) => item.setValue(e.target.value)} className="mb-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700" />
            <input ref={item.inputRef} type="file" accept=".pdf,.docx,.pptx,.jpeg,.jpg" onChange={(e) => item.setFile(e.target.files?.[0] || null)} className="hidden" />
            <button type="button" onClick={() => item.inputRef.current?.click()} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">{t("teacherProfile.chooseFile")}</button>
            <div className="mt-2 text-[11px] text-slate-500">{item.file ? item.file.name : t("teacherProfile.noFileSelected")}</div>
            <Button size="sm" className="mt-3" onClick={item.save} disabled={item.saving}>{item.saving ? t("teachersPage.saving") : item.saveLabel}</Button>
          </Panel>
        ))}
        <Panel>
          <div className="mb-2 font-semibold text-slate-700">{t("teacherProfile.lessonPlan")}</div>
          <input type="text" placeholder={t("teacherProfile.lessonPlanTitle")} value={state.lessonPlanTitle} onChange={(e) => state.setLessonPlanTitle(e.target.value)} className="mb-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700" />
          <input type="date" value={state.lessonPlanDate} onChange={(e) => state.setLessonPlanDate(e.target.value)} className="mb-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700" />
          <input ref={refs.lessonPlanInputRef} type="file" accept=".pdf,.docx,.pptx,.jpeg,.jpg" onChange={(e) => state.setLessonPlanFile(e.target.files?.[0] || null)} className="hidden" />
          <button type="button" onClick={() => refs.lessonPlanInputRef.current?.click()} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">{t("teacherProfile.chooseFile")}</button>
          <div className="mt-2 text-[11px] text-slate-500">{state.lessonPlanFile ? state.lessonPlanFile.name : t("teacherProfile.noFileSelected")}</div>
          <Button size="sm" className="mt-3" onClick={() => {
            if (!state.lessonPlanFile || !state.lessonPlanDate) { toast.error(t("teacherProfile.selectLessonPlanFileDate")); return; }
            const formData = new FormData();
            formData.append("teacher_id", teacherId);
            formData.append("title", state.lessonPlanTitle || "");
            formData.append("date", state.lessonPlanDate);
            formData.append("file", state.lessonPlanFile);
            mutations.uploadLessonPlanMutation.mutate(formData);
          }} disabled={mutations.uploadLessonPlanMutation.isPending}>{mutations.uploadLessonPlanMutation.isPending ? t("teachersPage.saving") : t("teacherProfile.uploadLessonPlan")}</Button>
        </Panel>
      </div>
    </div>
  );

  const renderHistory = () => (
    <div className="grid gap-4 lg:grid-cols-3">
      <WorkspacePanel title={t("teacherWorkspace.historyRecentLessons")} description={t("teacherWorkspace.historyDescription")} eyebrow={t("timeScope.acrossRecentObservations")}>
        {videos.length ? <ul className="space-y-2 text-xs text-slate-700">{videos.slice(0, 5).map((video) => <li key={video.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"><div className="font-medium text-slate-800">{video.filename || t("teacherProfile.lessonRecordingFallback")}</div><div className="mt-1 text-[11px] text-slate-500">{video.recorded_at || video.upload_date ? formatDateTime(video.recorded_at || video.upload_date) : t("teacherProfile.dateNotSet")}</div></li>)}</ul> : renderEmpty(t("teacherProfile.noVideosForTeacher"), t("teacherWorkspace.historyDescription"), t("teacherWorkspace.openVideos"), "/videos")}
      </WorkspacePanel>
      <WorkspacePanel title={t("teacherWorkspace.historyRecentFeedback")} description={t("teacherWorkspace.historyDescription")} eyebrow={t("timeScope.acrossRecentObservations")}>
        {observations.length ? <ul className="space-y-2 text-xs text-slate-700">{observations.slice(0, 5).map((obs) => <li key={obs.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"><div className="font-medium text-slate-800">{obs.admin_comment || t("teacherProfile.noAdminComment")}</div><div className="mt-1 text-[11px] text-slate-500">{formatDateTime(obs.created_at)}</div></li>)}</ul> : renderEmpty(t("teacherProfile.noObservations"), t("teacherWorkspace.historyDescription"))}
      </WorkspacePanel>
      <WorkspacePanel title={t("teacherWorkspace.historyCompletedGoals")} description={t("teacherWorkspace.historyDescription")} eyebrow={t("timeScope.ongoingGoal")}>
        {completedGoals.length ? <ul className={`list-disc space-y-1 text-sm text-slate-700 ${isRtl ? "pr-5" : "pl-5"}`}>{completedGoals.map((goal) => <li key={goal.id}>{goal.title}</li>)}</ul> : renderEmpty(t("teacherWorkspace.noCompletedGoals"), t("teacherWorkspace.historyDescription"))}
      </WorkspacePanel>
    </div>
  );

  if (!teacherId) {
    return (
      <LayoutShell>
        <div className="mx-auto max-w-5xl px-6 py-6">
          <PageContextHeader
            breadcrumbs={[{ label: t("nav.myWorkspace") }]}
            title={t("teacherWorkspace.title")}
            description={t("teacherWorkspace.description")}
            meta={t("teacherWorkspace.roleMeta")}
            badge={t("teacherWorkspace.roleBadge")}
            tags={institutionTags}
          />
          <Panel className="space-y-5">
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900">{t("teacherWorkspace.noLinkedTeacherTitle")}</h2>
              <p className="text-sm text-slate-500">{t("teacherWorkspace.noLinkedTeacherDescription")}</p>
              <p className="text-xs text-slate-500">{t("teacherWorkspace.profileCreateSyncNote")}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("teacherWorkspace.linkedOrganizationLabel")}
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-900">
                  {linkedOrganizationName || t("teacherWorkspace.linkedAdminNotAssigned")}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("teacherWorkspace.linkedSchoolLabel")}
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-900">
                  {linkedSchoolName || t("teacherWorkspace.linkedAdminNotAssigned")}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("teacherWorkspace.linkedAdminNameLabel")}
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-900">
                  {linkedAdminName || linkedAdminEmail || t("teacherWorkspace.linkedAdminNotAssigned")}
                </div>
              </div>
            </div>

            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                createSelfProfileMutation.mutate({
                  subject: profileSubject,
                  grade_level: profileGradeLevel,
                  department: profileDepartment || undefined,
                });
              }}
            >
              <Field label={t("teacherWorkspace.profileSubjectLabel")}>
                <Input
                  value={profileSubject}
                  onChange={(event) => setProfileSubject(event.target.value)}
                  placeholder={t("teacherWorkspace.profileSubjectPlaceholder")}
                />
              </Field>
              <Field label={t("teacherWorkspace.profileGradeLevelLabel")}>
                <Input
                  value={profileGradeLevel}
                  onChange={(event) => setProfileGradeLevel(event.target.value)}
                  placeholder={t("teacherWorkspace.profileGradeLevelPlaceholder")}
                />
              </Field>
              <Field label={t("teacherWorkspace.profileDepartmentLabel")}>
                <Input
                  value={profileDepartment}
                  onChange={(event) => setProfileDepartment(event.target.value)}
                  placeholder={t("teacherWorkspace.profileDepartmentPlaceholder")}
                />
              </Field>
              <div className="md:col-span-2">
                <Button
                  type="submit"
                  disabled={
                    createSelfProfileMutation.isPending ||
                    !profileSubject.trim() ||
                    !profileGradeLevel.trim()
                  }
                >
                  {createSelfProfileMutation.isPending
                    ? t("teacherWorkspace.profileCreatePending")
                    : t("teacherWorkspace.profileCreateCta")}
                </Button>
              </div>
            </form>
          </Panel>
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageContextHeader
          breadcrumbs={[{ label: t("nav.myWorkspace"), to: "/my-workspace" }, section !== "overview" ? { label: sectionTitle } : null]}
          title={sectionTitle}
          description={sectionDescription}
          meta={t("teacherWorkspace.roleMeta")}
          badge={t("teacherWorkspace.roleBadge")}
          tags={institutionTags}
          stats={[
            { label: t("teacherProfile.coachingStatusLatestLesson"), value: latestReviewedAt ? formatDateTime(latestReviewedAt) : t("teacherProfile.noLessonReviewedYet") },
            { label: t("teacherProfile.coachingStatusGoals"), value: t("teacherProfile.goalsInMotionCount", { open: openGoals.length, completed: completedGoals.length }) },
            { label: t("teacherProfile.coachingStatusConference"), value: nextConferenceAt ? t("teacherWorkspace.upcomingConferenceStatus", { date: formatDateTime(nextConferenceAt) }) : t("teacherWorkspace.upcomingConferenceNoDate") },
          ]}
          quickLinks={workspaceLinks}
        />

        {section === "overview" ? renderOverview() : null}
        {section === "materials" ? renderMaterials() : null}
        {section === "history" ? renderHistory() : null}
      </div>
    </LayoutShell>
  );
}
