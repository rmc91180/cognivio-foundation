import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { CoachingTimelinePanel } from "@/components/coaching/CoachingTimelinePanel";
import { EvidenceRecordList } from "@/components/coaching/EvidenceRecordList";
import { useAuth } from "@/hooks/useAuth";
import { actionPlanApi, teacherApi } from "@/lib/api";
import { isAdminUser } from "@/lib/userRoutes";

function makeGoalId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `goal_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

export function ActionPlanRecordPage() {
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
  const { data: actionPlanRes } = useQuery({
    queryKey: ["action-plan", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => actionPlanApi.get(teacherId).then((r) => r.data),
  });
  const { data: actionPlanHistoryRes } = useQuery({
    queryKey: ["action-plan-history", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => actionPlanApi.history(teacherId).then((r) => r.data),
  });
  const { data: coachingTimelineRes } = useQuery({
    queryKey: ["teacher-coaching-timeline", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.coachingTimeline(teacherId).then((r) => r.data),
  });
  const { data: evidenceCatalogRes } = useQuery({
    queryKey: ["teacher-evidence-catalog", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.evidenceCatalog(teacherId).then((r) => r.data),
  });

  const [actionPlanGoals, setActionPlanGoals] = useState([]);
  const [actionPlanNotes, setActionPlanNotes] = useState("");
  const [pendingEvidenceByGoal, setPendingEvidenceByGoal] = useState({});

  useEffect(() => {
    const plan = actionPlanHistoryRes?.current_plan || actionPlanRes;
    if (!plan) return;
    setActionPlanGoals(plan.goals || []);
    setActionPlanNotes(plan.notes || "");
  }, [actionPlanHistoryRes, actionPlanRes]);

  const saveActionPlanMutation = useMutation({
    mutationFn: (payload) => actionPlanApi.save(teacherId, payload),
    onSuccess: () => {
      toast.success(t("teacherProfile.actionPlanSaved"));
      queryClient.invalidateQueries({ queryKey: ["action-plan", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["action-plan-history", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["coaching-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-coaching-timeline", teacherId] });
    },
    onError: () => {
      toast.error(t("teacherProfile.actionPlanSaveFailed"));
    },
  });

  const openGoalsCount = useMemo(
    () =>
      actionPlanGoals.filter(
        (goal) => goal?.status !== "complete" && goal?.status !== "implemented"
      ).length,
    [actionPlanGoals]
  );
  const completedGoalsCount = useMemo(
    () =>
      actionPlanGoals.filter(
        (goal) => goal?.status === "complete" || goal?.status === "implemented"
      ).length,
    [actionPlanGoals]
  );
  const nextDueGoal = useMemo(() => {
    return actionPlanGoals
      .filter((goal) => goal?.due_date)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
  }, [actionPlanGoals]);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === "he" ? "he-IL" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language]
  );

  const updateGoal = (goalId, patch) =>
    setActionPlanGoals((prev) =>
      prev.map((goal) => (goal.id === goalId ? { ...goal, ...patch } : goal))
    );
  const attachEvidenceToGoal = (goalId) => {
    const referenceKey = pendingEvidenceByGoal[goalId];
    if (!referenceKey) return;
    const record = (evidenceCatalogRes?.items || []).find(
      (item) => item.reference_key === referenceKey
    );
    setActionPlanGoals((prev) =>
      prev.map((goal) => {
        if (goal.id !== goalId) return goal;
        const existingLinks = Array.isArray(goal.evidence_links) ? goal.evidence_links : [];
        if (existingLinks.includes(referenceKey)) return goal;
        return {
          ...goal,
          evidence_links: [...existingLinks, referenceKey],
          evidence_records: record
            ? [record, ...(goal.evidence_records || []).filter((item) => item.id !== record.id)]
            : goal.evidence_records,
        };
      })
    );
    setPendingEvidenceByGoal((prev) => ({ ...prev, [goalId]: "" }));
  };
  const detachEvidenceFromGoal = (goalId, referenceKey) => {
    setActionPlanGoals((prev) =>
      prev.map((goal) => {
        if (goal.id !== goalId) return goal;
        return {
          ...goal,
          evidence_links: (goal.evidence_links || []).filter((item) => item !== referenceKey),
          evidence_records: (goal.evidence_records || []).filter(
            (item) => item.reference_key !== referenceKey
          ),
        };
      })
    );
  };
  const removeGoal = (goalId) =>
    setActionPlanGoals((prev) => prev.filter((goal) => goal.id !== goalId));

  if (!teacherId) {
    return (
      <LayoutShell>
        <div className="mx-auto max-w-5xl px-6 py-6">
          <PageHeader
            title={t("teacherProfile.actionPlanRecordTitle")}
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
          title={t("teacherProfile.actionPlanRecordTitle")}
          description={t("teacherProfile.actionPlanRecordDescription")}
          meta={
            isAdmin
              ? t("teacherProfile.adminActionPlanRecordMeta", {
                  name: teacherRes?.name || t("teacherWorkspace.fallbackName"),
                })
              : t("teacherWorkspace.sharedPlanTitle")
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
                  saveActionPlanMutation.mutate({
                    goals: actionPlanGoals,
                    notes: actionPlanNotes,
                  })
                }
                disabled={saveActionPlanMutation.isPending}
              >
                {saveActionPlanMutation.isPending
                  ? t("teachersPage.saving")
                  : isAdmin
                    ? t("teacherProfile.saveActionPlan")
                    : t("teacherWorkspace.saveImplementationNotes")}
              </Button>
            </div>
          }
        />

        <div className="grid gap-4 md:grid-cols-3">
          <Panel>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("teacherProfile.coachingStatusGoals")}
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {openGoalsCount}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {t("teacherProfile.goalsInMotionCount", {
                open: openGoalsCount,
                completed: completedGoalsCount,
              })}
            </div>
          </Panel>
          <Panel>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("teacherProfile.nextCheckpoint")}
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-900">
              {nextDueGoal?.due_date || t("teacherProfile.nextConferenceNotScheduled")}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {nextDueGoal?.title || t("teacherProfile.noSharedGoalsYet")}
            </div>
          </Panel>
          <Panel>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("teacherProfile.recordHistory")}
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-900">
              {(actionPlanHistoryRes?.history || []).length}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {t("teacherProfile.historyEntriesSaved")}
            </div>
          </Panel>
        </div>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <SectionHeader
            title={t("teacherProfile.currentSharedPlanTitle")}
            description={
              isAdmin
                ? t("teacherProfile.currentSharedPlanAdminDescription")
                : t("teacherProfile.currentSharedPlanTeacherDescription")
            }
            eyebrow={t("timeScope.ongoingGoal")}
          />
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
            {t("teacherProfile.actionPlanSyncNotice")}
          </div>

          <div className="mt-4 space-y-3 text-xs">
            {actionPlanGoals.length ? (
              actionPlanGoals.map((goal) => (
                <div
                  key={goal.id}
                  className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    {isAdmin ? (
                      <input
                        type="text"
                        value={goal.title}
                        onChange={(e) => updateGoal(goal.id, { title: e.target.value })}
                        placeholder={t("teacherProfile.goalTitlePlaceholder")}
                        className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800"
                      />
                    ) : (
                      <div className="text-sm font-semibold text-slate-900">
                        {goal.title || t("teacherWorkspace.goalUntitled")}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      {isAdmin ? (
                        <select
                          value={goal.status || "planned"}
                          onChange={(e) => updateGoal(goal.id, { status: e.target.value })}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                        >
                          <option value="planned">{t("teacherProfile.goalStatusPlanned")}</option>
                          <option value="in_progress">{t("teacherProfile.goalStatusInProgress")}</option>
                          <option value="complete">{t("teacherProfile.goalStatusComplete")}</option>
                          <option value="implemented">{t("teacherProfile.goalStatusImplemented")}</option>
                        </select>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                          {goal.status === "complete"
                            ? t("teacherProfile.goalStatusComplete")
                            : goal.status === "implemented"
                              ? t("teacherProfile.goalStatusImplemented")
                              : goal.status === "in_progress"
                                ? t("teacherProfile.goalStatusInProgress")
                                : t("teacherProfile.goalStatusPlanned")}
                        </span>
                      )}
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => removeGoal(goal.id)}
                          className="text-[11px] text-slate-500 hover:text-slate-700"
                        >
                          {t("teacherProfile.removeGoal")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {isAdmin ? (
                    <textarea
                      rows={2}
                      value={goal.description || ""}
                      onChange={(e) => updateGoal(goal.id, { description: e.target.value })}
                      placeholder={t("teacherProfile.goalDescriptionPlaceholder")}
                      className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
                    />
                  ) : (
                    <div className="mt-2 text-xs text-slate-700">
                      {goal.description || t("teacherWorkspace.goalNoDescription")}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    <label className="text-slate-500">{t("teacherProfile.dueDate")}</label>
                    {isAdmin ? (
                      <input
                        type="date"
                        value={goal.due_date || ""}
                        onChange={(e) => updateGoal(goal.id, { due_date: e.target.value })}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                      />
                    ) : (
                      <span className="text-slate-700">
                        {goal.due_date || t("teacherProfile.dateNotSet")}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("teacherProfile.goalEvidenceTitle")}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          {goal.progress_summary || t("teacherProfile.goalEvidenceEmpty")}
                        </div>
                      </div>
                      {goal.progress_signal ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                          {t(`goalProgressSignals.${goal.progress_signal}`)}
                        </span>
                      ) : null}
                    </div>
                    {goal.latest_evidence_at ? (
                      <div className="mt-2 text-[11px] text-slate-500">
                        {t("teacherProfile.latestEvidenceLabel")}:{" "}
                        {dateFormatter.format(new Date(goal.latest_evidence_at))}
                      </div>
                    ) : null}
                    <div className="mt-3">
                      <EvidenceRecordList
                        records={goal.evidence_records || []}
                        user={user}
                        teacherId={teacherId}
                        t={t}
                        dateFormatter={dateFormatter}
                        emptyLabel={t("teacherProfile.goalEvidenceEmpty")}
                      />
                    </div>
                    {isAdmin ? (
                      <div className="mt-3 rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("teacherProfile.attachEvidence")}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <select
                            value={pendingEvidenceByGoal[goal.id] || ""}
                            onChange={(e) =>
                              setPendingEvidenceByGoal((prev) => ({
                                ...prev,
                                [goal.id]: e.target.value,
                              }))
                            }
                            className="min-w-[220px] rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                          >
                            <option value="">{t("teacherProfile.selectEvidencePlaceholder")}</option>
                            {(evidenceCatalogRes?.items || []).map((item) => (
                              <option
                                key={item.reference_key || item.id}
                                value={item.reference_key || ""}
                              >
                                {item.title}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => attachEvidenceToGoal(goal.id)}
                            className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                          >
                            {t("teacherProfile.attachEvidenceButton")}
                          </button>
                        </div>
                        {(goal.evidence_links || []).length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {(goal.evidence_links || []).map((referenceKey) => (
                              <button
                                key={`${goal.id}-${referenceKey}`}
                                type="button"
                                onClick={() => detachEvidenceFromGoal(goal.id, referenceKey)}
                                className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
                              >
                                {t("teacherProfile.removeLinkedEvidence")}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
                {t("teacherProfile.noSharedGoalsYet")}
              </div>
            )}

            {isAdmin ? (
              <button
                type="button"
                onClick={() =>
                  setActionPlanGoals((prev) => [
                    ...prev,
                    {
                      id: makeGoalId(),
                      title: "",
                      description: "",
                      due_date: "",
                      status: "planned",
                    },
                  ])
                }
                className="inline-flex items-center rounded-md border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-600 hover:bg-slate-50"
              >
                {t("teacherProfile.addGoal")}
              </button>
            ) : null}

            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-600">
                {t("teacherProfile.actionPlanNotes")}
              </label>
              <textarea
                rows={3}
                value={actionPlanNotes}
                onChange={(e) => setActionPlanNotes(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800"
                placeholder={
                  isAdmin
                    ? t("teacherProfile.actionPlanNotesPlaceholder")
                    : t("teacherWorkspace.goalsImplementationPlaceholder")
                }
              />
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <SectionHeader
            title={t("teacherProfile.actionPlanHistoryTitle")}
            description={t("teacherProfile.actionPlanHistoryDescription")}
            eyebrow={t("teacherProfile.recordHistory")}
          />
          <div className="mt-4 space-y-3">
            {(actionPlanHistoryRes?.history || []).length ? (
              actionPlanHistoryRes.history.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">
                      {entry.saved_by_name || t("teacherProfile.unknownAuthor")}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {entry.saved_at ? dateFormatter.format(new Date(entry.saved_at)) : ""}
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">
                    {entry.saved_by_role || t("teacherProfile.unknownRole")}
                  </div>
                  {entry.goals?.length ? (
                    <ul className={`mt-3 list-disc space-y-1 text-xs text-slate-700 ${isRtl ? "pr-4" : "pl-4"}`}>
                      {entry.goals.map((goal) => (
                        <li key={`${entry.id}-${goal.id}`}>
                          {goal.title || t("teacherWorkspace.goalUntitled")}
                          {goal.due_date ? ` • ${goal.due_date}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-3 text-xs text-slate-500">
                      {t("teacherProfile.noSharedGoalsYet")}
                    </div>
                  )}
                  {entry.notes ? (
                    <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-3 text-xs text-slate-700">
                      {entry.notes}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
                {t("teacherProfile.noActionPlanHistory")}
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
