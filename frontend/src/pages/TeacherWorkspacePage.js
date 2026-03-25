import React, { useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { VideoRecorder } from "@/components/VideoRecorder";
import { Button, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useTeacherWorkspaceData } from "@/pages/teacher-workspace/useTeacherWorkspaceData";

function WorkspaceSection({ title, description, tags, active, children, activeLabel }) {
  return (
    <Panel className={[active ? "border-primary/40 bg-primary/5" : "border-slate-200 bg-white", "space-y-4 border transition-colors"].join(" ")}>
      <SectionHeader
        title={title}
        description={description}
        eyebrow={active ? activeLabel : null}
        tags={tags}
      />
      {children}
    </Panel>
  );
}

export function TeacherWorkspacePage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const activeSection = useMemo(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts[1] || "overview";
  }, [location.pathname]);
  const { refs, state, data, mutations } = useTeacherWorkspaceData({
    teacherId: user?.teacher_id || null,
    teacherName: user?.name,
    teacherSubject: user?.subject,
    t,
    i18n,
  });

  const isRtl = i18n.dir() === "rtl";
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
  const latestReviewedAt = latestAssessment?.analyzed_at || latestAssessment?.recorded_at || latestAssessment?.created_at || null;
  const privacyReady = privacyProfileRes?.status === "active";
  const openGoals = state.actionPlanGoals.filter((goal) => goal?.status !== "complete" && goal?.status !== "implemented");
  const completedGoals = state.actionPlanGoals.filter((goal) => goal?.status === "complete" || goal?.status === "implemented");
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
  const recurringChallenges = summaryInsightsRes?.recommendations || [];
  const urgentItems = [
    !privacyReady ? t("teacherWorkspace.urgentPrivacy") : null,
    !latestAssessment ? t("teacherWorkspace.urgentNoLesson") : null,
    latestObservation?.admin_comment ? t("teacherWorkspace.urgentComment") : null,
    openGoals.length ? t("teacherWorkspace.urgentGoals", { count: openGoals.length }) : null,
  ].filter(Boolean);
  const formatDateTime = (value) => {
    if (!value) return t("teacherProfile.notConfigured");
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value;
    return new Intl.DateTimeFormat(i18n.language === "he" ? "he-IL" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(parsed));
  };
  const formatScore = (value) => {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return "N/A";
    return new Intl.NumberFormat(i18n.language === "he" ? "he-IL" : "en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(numeric);
  };

  if (!teacherId) {
    return (
      <LayoutShell>
        <div className="mx-auto max-w-4xl px-6 py-6">
          <PageHeader title={t("teacherWorkspace.title")} description={t("teacherWorkspace.description")} meta={t("teacherWorkspace.roleMeta")} />
          <Panel className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900">{t("teacherWorkspace.noLinkedTeacherTitle")}</h2>
            <p className="text-sm text-slate-500">{t("teacherWorkspace.noLinkedTeacherDescription")}</p>
          </Panel>
        </div>
      </LayoutShell>
    );
  }

  const saveReflection = (event) => {
    event.preventDefault();
    mutations.saveReflectionMutation.mutate({
      self_reflection: state.selfReflection,
      actions_taken: state.actionsTaken,
    });
  };

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title={t("teacherWorkspace.title")}
          description={t("teacherWorkspace.description")}
          meta={t("teacherWorkspace.roleMeta")}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => navigate("/videos")}>{t("teacherWorkspace.openVideos")}</Button>
              <Button size="sm" variant="secondary" onClick={() => navigate("/my-workspace/materials")}>{t("teacherWorkspace.openMaterials")}</Button>
            </div>
          }
        />

        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{t("teacherWorkspace.roleBadge")}</div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{t("teacherWorkspace.welcomeTitle", { name: teacherRes?.name || user?.name || t("teacherWorkspace.fallbackName") })}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("teacherWorkspace.welcomeDescription")}</p>
              </div>
            </div>
            <div className="grid gap-2 text-right text-xs text-slate-500">
              <div>{latestReviewedAt ? formatDateTime(latestReviewedAt) : t("teacherProfile.noLessonReviewedYet")}</div>
              <div>{t("teacherWorkspace.summaryGoals")}: {openGoals.length}</div>
              <div>{t("teacherWorkspace.summaryUploads")}</div>
            </div>
          </div>
        </div>

        <Panel className="mb-6 border border-dashed border-slate-300 bg-slate-50/80">
          <SectionHeader
            title={t("teacherWorkspace.startHereTitle")}
            description={t("teacherWorkspace.startHereDescription")}
            eyebrow={t("teacherWorkspace.workspaceTag")}
          />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {[
              [
                "/my-workspace",
                t("teacherWorkspace.startHereLatestTitle"),
                t("teacherWorkspace.startHereLatestDescription"),
              ],
              [
                "/my-workspace/goals",
                t("teacherWorkspace.startHereGoalsTitle"),
                t("teacherWorkspace.startHereGoalsDescription"),
              ],
              [
                "/my-workspace/materials",
                t("teacherWorkspace.startHereMaterialsTitle"),
                t("teacherWorkspace.startHereMaterialsDescription"),
              ],
            ].map(([to, title, description]) => (
              <Link
                key={to}
                to={to}
                className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-700 transition-colors hover:bg-slate-100"
              >
                <div className="font-semibold text-slate-900">{title}</div>
                <div className="mt-1 text-xs text-slate-500">{description}</div>
              </Link>
            ))}
          </div>
        </Panel>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Panel className="space-y-3 self-start lg:sticky lg:top-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">{t("teacherWorkspace.sectionsTitle")}</h2>
              <p className="mt-1 text-xs text-slate-500">{t("teacherWorkspace.sectionsDescription")}</p>
            </div>
            <div className="space-y-2">
              {[
                ["overview", t("teacherWorkspace.currentTitle"), t("teacherWorkspace.currentDescription")],
                ["goals", t("teacherWorkspace.goalsTitle"), t("teacherWorkspace.goalsDescription")],
                ["materials", t("teacherWorkspace.materialsTitle"), t("teacherWorkspace.materialsDescription")],
                ["history", t("teacherWorkspace.historyTitle"), t("teacherWorkspace.historyDescription")],
              ].map(([id, title, description]) => (
                <Link key={id} to={id === "overview" ? "/my-workspace" : `/my-workspace/${id}`} className={["block rounded-xl border px-3 py-3 text-sm transition-colors", activeSection === id ? "border-primary/30 bg-primary/10 text-primary" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"].join(" ")}>
                  <div className="font-semibold">{title}</div>
                  <div className="mt-1 text-xs text-slate-500">{description}</div>
                </Link>
              ))}
            </div>
          </Panel>

          <div className="space-y-6">
            <WorkspaceSection title={t("teacherWorkspace.currentTitle")} description={t("teacherWorkspace.currentDescription")} tags={[t("timeScope.latestClass"), t("timeScope.immediateFollowUp")]} active={activeSection === "overview"} activeLabel={t("teacherWorkspace.activeSectionLabel")}>
              <div className="grid gap-4 md:grid-cols-2">
                <Panel><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("teacherWorkspace.currentSummaryTitle")}</div><div className="mt-2 text-xs text-slate-700">{summaryInsightsRes?.summary || t("teacherProfile.noSummaryData")}</div></Panel>
                <Panel><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("teacherWorkspace.currentNextStep")}</div><div className="mt-2 text-xs text-slate-700">{summaryInsightsRes?.recommendations?.[0] || openGoals[0]?.title || t("teacherProfile.noNextStepsYet")}</div></Panel>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel><div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">{t("teacherProfile.latestStrengths")}</div>{latestSignals.strengths.length ? <ul className={`space-y-1 text-xs text-slate-700 ${isRtl ? "pr-4" : "pl-4"} list-disc`}>{latestSignals.strengths.map((item) => <li key={item.element_id}>{item.label} ({formatScore(item.score)}/10)</li>)}</ul> : <div className="text-xs text-slate-500">{t("teacherProfile.noRecentHighlights")}</div>}</Panel>
                <Panel><div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">{t("teacherProfile.immediateConcerns")}</div>{latestSignals.concerns.length ? <ul className={`space-y-1 text-xs text-slate-700 ${isRtl ? "pr-4" : "pl-4"} list-disc`}>{latestSignals.concerns.map((item) => <li key={item.element_id}>{item.label} ({formatScore(item.score)}/10)</li>)}</ul> : <div className="text-xs text-slate-500">{t("teacherProfile.noRecentHighlights")}</div>}</Panel>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel><div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("teacherWorkspace.currentUrgentTitle")}</div>{urgentItems.length ? <ul className={`space-y-1 text-xs text-slate-700 ${isRtl ? "pr-4" : "pl-4"} list-disc`}>{urgentItems.map((item) => <li key={item}>{item}</li>)}</ul> : <div className="text-xs text-slate-500">{t("teacherWorkspace.currentUrgentClear")}</div>}</Panel>
                <Panel><div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("teacherProfile.latestAdminComment")}</div><div className="text-xs text-slate-700">{latestObservation?.admin_comment || t("teacherProfile.noAdminComment")}</div></Panel>
              </div>
              <form onSubmit={saveReflection} className="grid gap-4 lg:grid-cols-2">
                <div><label className="mb-1 block text-[11px] font-medium text-slate-600">{t("teacherProfile.teacherReflection")}</label><textarea rows={4} value={state.selfReflection} onChange={(e) => state.setSelfReflection(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring" placeholder={t("teacherProfile.teacherReflectionPlaceholder")} /></div>
                <div><label className="mb-1 block text-[11px] font-medium text-slate-600">{t("teacherWorkspace.currentTeacherResponseTitle")}</label><textarea rows={4} value={state.actionsTaken} onChange={(e) => state.setActionsTaken(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring" placeholder={t("teacherWorkspace.currentTeacherResponsePlaceholder")} /></div>
                <div className="lg:col-span-2"><Button type="submit" size="sm" disabled={mutations.saveReflectionMutation.isPending}>{mutations.saveReflectionMutation.isPending ? t("teachersPage.saving") : t("teacherProfile.saveReflection")}</Button></div>
              </form>
            </WorkspaceSection>

            <WorkspaceSection title={t("teacherWorkspace.goalsTitle")} description={t("teacherWorkspace.goalsDescription")} tags={[t("timeScope.ongoingGoal"), t("timeScope.recurringPattern")]} active={activeSection === "goals"} activeLabel={t("teacherWorkspace.activeSectionLabel")}>
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel><div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">{t("teacherProfile.recurringChallenges")}</div>{recurringChallenges.length ? <ul className={`space-y-1 text-xs text-slate-700 ${isRtl ? "pr-4" : "pl-4"} list-disc`}>{recurringChallenges.slice(0, 3).map((item, idx) => <li key={idx}>{item}</li>)}</ul> : <div className="text-xs text-slate-500">{t("teacherProfile.noRecurringChallenges")}</div>}</Panel>
                <Panel><div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("teacherWorkspace.goalsImplementationNotes")}</div><textarea rows={4} value={state.actionPlanNotes} onChange={(e) => state.setActionPlanNotes(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800" placeholder={t("teacherProfile.actionPlanNotesPlaceholder")} /></Panel>
              </div>
              <div className="space-y-3 text-xs">
                {state.actionPlanGoals.map((goal) => (
                  <Panel key={goal.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <input type="text" value={goal.title} onChange={(e) => state.setActionPlanGoals((prev) => prev.map((item) => item.id === goal.id ? { ...item, title: e.target.value } : item))} placeholder={t("teacherProfile.goalTitlePlaceholder")} className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800" />
                      <select value={goal.status || "planned"} onChange={(e) => state.setActionPlanGoals((prev) => prev.map((item) => item.id === goal.id ? { ...item, status: e.target.value } : item))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"><option value="planned">{t("teacherProfile.goalStatusPlanned")}</option><option value="in_progress">{t("teacherProfile.goalStatusInProgress")}</option><option value="complete">{t("teacherProfile.goalStatusComplete")}</option></select>
                    </div>
                    <textarea rows={2} value={goal.description || ""} onChange={(e) => state.setActionPlanGoals((prev) => prev.map((item) => item.id === goal.id ? { ...item, description: e.target.value } : item))} placeholder={t("teacherProfile.goalDescriptionPlaceholder")} className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800" />
                  </Panel>
                ))}
                <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => state.setActionPlanGoals((prev) => [...prev, { id: `goal_${Date.now()}`, title: "", description: "", due_date: "", status: "planned" }])}>{t("teacherProfile.addGoal")}</Button><Button size="sm" onClick={() => mutations.saveActionPlanMutation.mutate({ goals: state.actionPlanGoals, notes: state.actionPlanNotes })} disabled={mutations.saveActionPlanMutation.isPending}>{mutations.saveActionPlanMutation.isPending ? t("teachersPage.saving") : t("teacherProfile.saveActionPlan")}</Button></div>
              </div>
            </WorkspaceSection>

            <WorkspaceSection title={t("teacherWorkspace.materialsTitle")} description={t("teacherWorkspace.materialsDescription")} tags={[t("teacherWorkspace.workspaceTag")]} active={activeSection === "materials"} activeLabel={t("teacherWorkspace.activeSectionLabel")}>
              <Panel><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-medium text-slate-800">{t("teacherProfile.privacyIdentityProfile")}</div><div className="mt-1 text-[11px] text-slate-500">{t("teacherProfile.privacyStatusLabel", { status: privacyReady ? t("teacherProfile.privacyReady", { count: privacyProfileRes?.reference_count || 0 }) : t("teacherProfile.notConfigured") })}</div></div><Button size="sm" variant="secondary" onClick={() => mutations.savePrivacyProfileMutation.mutate(state.privacyReferenceFiles)} disabled={mutations.savePrivacyProfileMutation.isPending || state.privacyReferenceFiles.length === 0}>{mutations.savePrivacyProfileMutation.isPending ? t("teachersPage.saving") : t("teacherProfile.savePrivacyProfile")}</Button></div><input ref={refs.privacyReferenceInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => state.setPrivacyReferenceFiles(Array.from(e.target.files || []))} className="hidden" /><div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={() => refs.privacyReferenceInputRef.current?.click()} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">{t("teacherProfile.chooseFiles")}</button><span className="text-[11px] text-slate-500">{state.privacyReferenceFiles.length > 0 ? t("teacherProfile.referenceFilesSelected", { count: state.privacyReferenceFiles.length }) : t("teacherProfile.noFilesSelected")}</span></div></Panel>
              <Panel><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900">{t("teacherProfile.lessonVideoHub")}</h3><p className="text-xs text-slate-500">{t("teacherProfile.lessonVideoHubDescription")}</p></div><Link to={`/videos?teacher_id=${teacherId}`} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100">{t("teacherProfile.openRecordingsPage")}</Link></div><div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2"><VideoRecorder onRecordingReady={(blob, url) => { state.setRecordedBlob(blob); state.setRecordedUrl(url); }} /><div className="space-y-3 text-xs text-slate-600"><input type="text" value={state.videoSubject} onChange={(e) => state.setVideoSubject(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800" /><div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">{state.recordedUrl ? t("teacherProfile.recordingReady") : t("teacherProfile.noRecordingYet")}</div><Button size="sm" onClick={() => { if (!privacyReady) { toast.error(t("teacherProfile.completePrivacyProfileFirst")); return; } if (!state.recordedBlob) { toast.error(t("teacherProfile.recordVideoFirst")); return; } const ext = state.recordedBlob.type?.includes("mp4") ? "mp4" : "webm"; const file = new File([state.recordedBlob], `teacher-recording.${ext}`, { type: state.recordedBlob.type || "video/webm" }); mutations.uploadRecordedMutation.mutate({ file, recordedAt: new Date().toISOString() }); }} disabled={mutations.uploadRecordedMutation.isPending}>{mutations.uploadRecordedMutation.isPending ? t("teacherProfile.uploading") : t("teacherProfile.uploadRecording")}</Button></div></div></Panel>
              <div className="grid gap-4 lg:grid-cols-3">
                <Panel>
                  <div className="mb-2 font-semibold text-slate-700">{t("teacherProfile.curriculum")}</div>
                  <input type="text" placeholder={t("teacherProfile.curriculumTitle")} value={state.curriculumTitle} onChange={(e) => state.setCurriculumTitle(e.target.value)} className="mb-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700" />
                  <input ref={refs.curriculumInputRef} type="file" accept=".pdf,.docx,.pptx,.jpeg,.jpg" onChange={(e) => state.setCurriculumFile(e.target.files?.[0] || null)} className="hidden" />
                  <button type="button" onClick={() => refs.curriculumInputRef.current?.click()} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">{t("teacherProfile.chooseFile")}</button>
                  <div className="mt-2 text-[11px] text-slate-500">{state.curriculumFile ? state.curriculumFile.name : t("teacherProfile.noFileSelected")}</div>
                  <Button size="sm" className="mt-3" onClick={() => {
                    if (!state.curriculumFile) {
                      toast.error(t("teacherProfile.selectCurriculumFile"));
                      return;
                    }
                    const formData = new FormData();
                    formData.append("teacher_id", teacherId);
                    formData.append("title", state.curriculumTitle || "");
                    formData.append("file", state.curriculumFile);
                    mutations.uploadCurriculumMutation.mutate(formData);
                  }} disabled={mutations.uploadCurriculumMutation.isPending}>
                    {mutations.uploadCurriculumMutation.isPending ? t("teachersPage.saving") : t("teacherProfile.uploadCurriculum")}
                  </Button>
                </Panel>
                <Panel>
                  <div className="mb-2 font-semibold text-slate-700">{t("teacherProfile.lessonPlan")}</div>
                  <input type="text" placeholder={t("teacherProfile.lessonPlanTitle")} value={state.lessonPlanTitle} onChange={(e) => state.setLessonPlanTitle(e.target.value)} className="mb-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700" />
                  <input type="date" value={state.lessonPlanDate} onChange={(e) => state.setLessonPlanDate(e.target.value)} className="mb-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700" />
                  <input ref={refs.lessonPlanInputRef} type="file" accept=".pdf,.docx,.pptx,.jpeg,.jpg" onChange={(e) => state.setLessonPlanFile(e.target.files?.[0] || null)} className="hidden" />
                  <button type="button" onClick={() => refs.lessonPlanInputRef.current?.click()} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">{t("teacherProfile.chooseFile")}</button>
                  <div className="mt-2 text-[11px] text-slate-500">{state.lessonPlanFile ? state.lessonPlanFile.name : t("teacherProfile.noFileSelected")}</div>
                  <Button size="sm" className="mt-3" onClick={() => {
                    if (!state.lessonPlanFile || !state.lessonPlanDate) {
                      toast.error(t("teacherProfile.selectLessonPlanFileDate"));
                      return;
                    }
                    const formData = new FormData();
                    formData.append("teacher_id", teacherId);
                    formData.append("title", state.lessonPlanTitle || "");
                    formData.append("date", state.lessonPlanDate);
                    formData.append("file", state.lessonPlanFile);
                    mutations.uploadLessonPlanMutation.mutate(formData);
                  }} disabled={mutations.uploadLessonPlanMutation.isPending}>
                    {mutations.uploadLessonPlanMutation.isPending ? t("teachersPage.saving") : t("teacherProfile.uploadLessonPlan")}
                  </Button>
                </Panel>
                <Panel>
                  <div className="mb-2 font-semibold text-slate-700">{t("teacherProfile.syllabus")}</div>
                  <input type="text" placeholder={t("teacherProfile.syllabusTitle")} value={state.syllabusTitle} onChange={(e) => state.setSyllabusTitle(e.target.value)} className="mb-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700" />
                  <input ref={refs.syllabusInputRef} type="file" accept=".pdf,.docx,.pptx,.jpeg,.jpg" onChange={(e) => state.setSyllabusFile(e.target.files?.[0] || null)} className="hidden" />
                  <button type="button" onClick={() => refs.syllabusInputRef.current?.click()} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">{t("teacherProfile.chooseFile")}</button>
                  <div className="mt-2 text-[11px] text-slate-500">{state.syllabusFile ? state.syllabusFile.name : t("teacherProfile.noFileSelected")}</div>
                  <Button size="sm" className="mt-3" onClick={() => {
                    if (!state.syllabusFile) {
                      toast.error(t("teacherProfile.selectSyllabusFile"));
                      return;
                    }
                    const formData = new FormData();
                    formData.append("teacher_id", teacherId);
                    formData.append("title", state.syllabusTitle || "");
                    formData.append("file", state.syllabusFile);
                    mutations.uploadSyllabusMutation.mutate(formData);
                  }} disabled={mutations.uploadSyllabusMutation.isPending}>
                    {mutations.uploadSyllabusMutation.isPending ? t("teachersPage.saving") : t("teacherProfile.uploadSyllabus")}
                  </Button>
                </Panel>
              </div>
            </WorkspaceSection>

            <WorkspaceSection title={t("teacherWorkspace.historyTitle")} description={t("teacherWorkspace.historyDescription")} tags={[t("timeScope.acrossRecentObservations")]} active={activeSection === "history"} activeLabel={t("teacherWorkspace.activeSectionLabel")}>
              <div className="grid gap-4 lg:grid-cols-3">
                <Panel><div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("teacherWorkspace.historyRecentLessons")}</div>{videos.length ? <ul className="space-y-2 text-xs text-slate-700">{videos.slice(0, 5).map((video) => <li key={video.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"><div className="font-medium text-slate-800">{video.filename || t("teacherProfile.lessonRecordingFallback")}</div><div className="mt-1 text-[11px] text-slate-500">{video.recorded_at || video.upload_date ? formatDateTime(video.recorded_at || video.upload_date) : t("teacherProfile.dateNotSet")}</div></li>)}</ul> : <div className="text-xs text-slate-500">{t("teacherProfile.noVideosForTeacher")}</div>}</Panel>
                <Panel><div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("teacherWorkspace.historyRecentFeedback")}</div>{observations.length ? <ul className="space-y-2 text-xs text-slate-700">{observations.slice(0, 5).map((obs) => <li key={obs.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"><div className="font-medium text-slate-800">{obs.admin_comment || t("teacherProfile.noAdminComment")}</div><div className="mt-1 text-[11px] text-slate-500">{formatDateTime(obs.created_at)}</div></li>)}</ul> : <div className="text-xs text-slate-500">{t("teacherProfile.noObservations")}</div>}</Panel>
                <Panel><div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("teacherWorkspace.historyCompletedGoals")}</div>{completedGoals.length ? <ul className={`space-y-1 text-xs text-slate-700 ${isRtl ? "pr-4" : "pl-4"} list-disc`}>{completedGoals.map((goal) => <li key={goal.id}>{goal.title}</li>)}</ul> : <div className="text-xs text-slate-500">{t("teacherWorkspace.noCompletedGoals")}</div>}</Panel>
              </div>
            </WorkspaceSection>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}
