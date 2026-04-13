import React, { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LayoutShell } from "@/components/LayoutShell";
import { CoachingTimelinePanel } from "@/components/coaching/CoachingTimelinePanel";
import { EvidenceRecordList } from "@/components/coaching/EvidenceRecordList";
import { PageContextHeader, Panel, SectionHeader } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { actionPlanApi, assessmentApi, teacherApi } from "@/lib/api";
import { getCoachingHubRoute } from "@/lib/coachingRoutes";
import { isAdminUser } from "@/lib/userRoutes";
import { buildInstitutionContextTags } from "@/lib/institutionContext";

const HUB_TABS = ["goals", "reflections", "timeline", "conference"];

function getSafeTab(value) {
  return HUB_TABS.includes(value) ? value : "goals";
}

function formatSavedAt(value, formatter, fallback) {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return formatter.format(new Date(parsed));
}

export function CoachingHubPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { teacherId: routeTeacherId } = useParams();
  const [searchParams] = useSearchParams();
  const isAdmin = isAdminUser(user);
  const teacherId = isAdmin ? routeTeacherId : user?.teacher_id || null;
  const activeTab = getSafeTab(searchParams.get("tab"));
  const baseRoute = getCoachingHubRoute(user, teacherId);
  const locale = i18n.language === "he" ? "he-IL" : "en-US";
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
  const { data: conferencePrepRes } = useQuery({
    queryKey: ["teacher-conference-prep", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.conferencePrep(teacherId).then((r) => r.data),
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

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale]
  );

  const goals = actionPlanRes?.goals || [];
  const openGoals = goals.filter(
    (goal) => goal?.status !== "complete" && goal?.status !== "implemented"
  );
  const completedGoals = goals.filter(
    (goal) => goal?.status === "complete" || goal?.status === "implemented"
  );
  const currentEntries = reflectionHistoryRes?.current_entries || [];
  const reflectionHistory = reflectionHistoryRes?.history || [];
  const latestTeacherReflection =
    currentEntries.find((entry) => entry.author_role === "teacher") ||
    reflectionHistory.find((entry) => entry.author_role === "teacher") ||
    null;
  const latestAdminReflection =
    currentEntries.find((entry) => entry.author_role !== "teacher") ||
    reflectionHistory.find((entry) => entry.author_role !== "teacher") ||
    null;

  const headerTitle = isAdmin
    ? t("teacherProfile.coachingHubTitle")
    : t("teacherWorkspace.coachingHubTitle");
  const headerDescription = isAdmin
    ? t("teacherProfile.coachingHubDescription")
    : t("teacherWorkspace.coachingHubDescription");
  const headerMeta = isAdmin
    ? t("teacherProfile.coachingHubMeta", {
        name: teacherRes?.name || t("teacherWorkspace.fallbackName"),
      })
    : t("teacherWorkspace.coachingHubMeta");

  const tabLinks = [
    {
      label: t("teacherWorkspace.goalsTitle"),
      to: `${baseRoute}?tab=goals`,
      active: activeTab === "goals",
    },
    {
      label: t("teacherWorkspace.reflectionsTitle"),
      to: `${baseRoute}?tab=reflections`,
      active: activeTab === "reflections",
    },
    {
      label: t("coachingTimeline.title"),
      to: `${baseRoute}?tab=timeline`,
      active: activeTab === "timeline",
    },
    {
      label: t("teacherProfile.conferenceContinuityTitle"),
      to: `${baseRoute}?tab=conference`,
      active: activeTab === "conference",
    },
  ];

  const focusedRecordLink =
    activeTab === "goals"
      ? isAdmin
        ? `/teachers/${teacherId}/action-plan`
        : "/my-workspace/goals"
      : activeTab === "reflections"
        ? isAdmin
          ? `/teachers/${teacherId}/reflections`
          : "/my-workspace/reflections"
        : null;

  const currentReflectionRecords = currentReflectionRes?.linked_evidence_records || [];
  const conferenceContinuityLines = isAdmin
    ? conferencePrepRes?.continuity_lines || []
    : adaptiveSupportRes?.conference_continuity_lines || [];
  const publishedAgendaItems = conferenceAgendaRes?.agenda_items || [];
  const adminAgendaItems = conferencePrepRes?.agenda || [];
  const nextConferenceAt = conferencePrepRes?.next_conference || teacherRes?.next_coaching_conference;
  const institutionTags = buildInstitutionContextTags({
    subject: teacherRes,
    schoolLabel: t("teacherProfile.contextSchoolLabel"),
    organizationLabel: t("teacherProfile.contextOrganizationLabel"),
    managerLabel: t("teacherProfile.contextAdministratorLabel"),
    unknownLabel: t("teacherProfile.contextUnknown"),
  });

  const renderGoalsTab = () => (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <SectionHeader
          eyebrow={t("timeScope.ongoingGoal")}
          title={t("teacherProfile.currentSharedPlanTitle")}
          description={
            isAdmin
              ? t("teacherProfile.coachingHubGoalsAdminDescription")
              : t("teacherProfile.coachingHubGoalsTeacherDescription")
          }
        />
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Panel>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("teacherProfile.coachingStatusGoals")}
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{openGoals.length}</div>
            <div className="mt-1 text-xs text-slate-500">
              {t("teacherProfile.goalsInMotionCount", {
                open: openGoals.length,
                completed: completedGoals.length,
              })}
            </div>
          </Panel>
          <Panel>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("teacherProfile.recordHistory")}
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {(actionPlanHistoryRes?.history || []).length}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {t("teacherProfile.historyEntriesSaved")}
            </div>
          </Panel>
          <Panel>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("teacherProfile.coachingOwnershipTitle")}
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-900">
              {isAdmin
                ? t("teacherProfile.coachingOwnershipAdmin")
                : t("teacherProfile.coachingOwnershipTeacher")}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {isAdmin
                ? t("teacherProfile.currentSharedPlanAdminDescription")
                : t("teacherProfile.currentSharedPlanTeacherDescription")}
            </div>
          </Panel>
        </div>
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {t("teacherProfile.coachingHubGoalsNote")}
        </div>
        <div className="mt-4 space-y-3">
          {openGoals.length ? (
            openGoals.map((goal) => (
              <div key={goal.id} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {goal.title || t("teacherWorkspace.goalUntitled")}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      {goal.description || t("teacherWorkspace.goalNoDescription")}
                    </div>
                  </div>
                  {goal.progress_signal ? (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                      {t(`goalProgressSignals.${goal.progress_signal}`)}
                    </span>
                  ) : null}
                </div>
                {goal.progress_summary ? (
                  <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-3 text-xs text-slate-700">
                    {goal.progress_summary}
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
              </div>
            ))
          ) : (
            <div className="rounded-md border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500">
              {t("teacherProfile.noSharedGoalsYet")}
            </div>
          )}
        </div>
      </section>
    </div>
  );

  const renderReflectionsTab = () => (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <SectionHeader
          eyebrow={t("teacherProfile.recordHistory")}
          title={t("teacherProfile.reflectionRecordTitle")}
          description={t("teacherProfile.coachingHubReflectionsDescription")}
        />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Panel className="h-full">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("teacherProfile.latestTeacherReflectionTitle")}
            </div>
            <div className="mt-2 text-sm text-slate-800">
              {latestTeacherReflection?.self_reflection || t("teacherProfile.noTeacherReflection")}
            </div>
            <div className="mt-3 text-[11px] text-slate-500">
              {formatSavedAt(
                latestTeacherReflection?.saved_at,
                dateFormatter,
                t("teacherProfile.noTeacherReflection")
              )}
            </div>
          </Panel>
          <Panel className="h-full">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("teacherProfile.latestAdminReflectionTitle")}
            </div>
            <div className="mt-2 text-sm text-slate-800">
              {latestAdminReflection?.self_reflection || t("teacherProfile.noPrincipalReflection")}
            </div>
            <div className="mt-3 text-[11px] text-slate-500">
              {formatSavedAt(
                latestAdminReflection?.saved_at,
                dateFormatter,
                t("teacherProfile.noPrincipalReflection")
              )}
            </div>
          </Panel>
        </div>

        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {t("teacherProfile.coachingHubReflectionNote")}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel className="h-full">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("teacherProfile.followThroughTextLabel")}
            </div>
            <div className="mt-2 text-sm text-slate-800">
              {currentReflectionRes?.actions_taken || t("teacherProfile.noFollowThroughEntry")}
            </div>
            {(currentReflectionRes?.linked_goal_titles || []).length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {currentReflectionRes.linked_goal_titles.map((title) => (
                  <span
                    key={title}
                    className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-600"
                  >
                    {title}
                  </span>
                ))}
              </div>
            ) : null}
          </Panel>
          <Panel className="h-full">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("teacherProfile.anchorReflectionTitle")}
            </div>
            <div className="mt-2 text-sm text-slate-800">
              {t("teacherProfile.anchorReflectionDescription")}
            </div>
            <div className="mt-3">
              <EvidenceRecordList
                records={currentReflectionRecords}
                user={user}
                teacherId={teacherId}
                t={t}
                dateFormatter={dateFormatter}
                emptyLabel={t("teacherProfile.noReflectionEvidenceLinked")}
              />
            </div>
          </Panel>
        </div>

      </section>
    </div>
  );

  const renderTimelineTab = () => (
    <CoachingTimelinePanel
      title={t("coachingTimeline.title")}
      description={t("teacherProfile.coachingHubTimelineDescription")}
      eyebrow={t("teacherProfile.recordHistory")}
      entries={coachingTimelineRes?.entries || []}
      user={user}
      teacherId={teacherId}
      t={t}
      emptyLabel={t("coachingTimeline.empty")}
      dateFormatter={dateFormatter}
    />
  );

  const renderConferenceTab = () => (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <SectionHeader
          eyebrow={isAdmin ? t("teacherProfile.conferencePrepEyebrow") : t("timeScope.acrossRecentObservations")}
          title={t("teacherProfile.conferenceContinuityTitle")}
          description={
            isAdmin
              ? t("teacherProfile.conferenceContinuityDescription")
              : t("teacherWorkspace.upcomingConferenceSyncNote")
          }
        />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel className="h-full">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("teacherProfile.coachingStatusConference")}
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-900">
              {nextConferenceAt
                ? formatSavedAt(nextConferenceAt, dateFormatter, t("teacherProfile.nextConferenceNotScheduled"))
                : t("teacherProfile.nextConferenceNotScheduled")}
            </div>
            <div className="mt-3 space-y-2">
              {conferenceContinuityLines.length ? (
                conferenceContinuityLines.map((line, index) => (
                  <div
                    key={`${line}-${index}`}
                    className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700"
                  >
                    {line}
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                  {t("teacherProfile.conferencePrepNoContinuity")}
                </div>
              )}
            </div>
          </Panel>
          <Panel className="h-full">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {isAdmin ? t("teacherProfile.conferencePrepAgenda") : t("teacherWorkspace.publishedAgendaTitle")}
            </div>
            <div className="mt-3">
              {(isAdmin ? adminAgendaItems : publishedAgendaItems).length ? (
                <ul className={`list-disc space-y-2 text-sm text-slate-700 ${isRtl ? "pr-5" : "pl-5"}`}>
                  {(isAdmin ? adminAgendaItems : publishedAgendaItems).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                  {isAdmin
                    ? t("teacherProfile.conferencePrepNoContinuity")
                    : t("teacherWorkspace.upcomingConferenceNoDate")}
                </div>
              )}
            </div>
            {isAdmin && conferencePrepRes?.published_agenda?.published_at ? (
              <div className="mt-3 text-[11px] text-slate-500">
                {t("teacherProfile.publishAgendaStatus", {
                  date: formatSavedAt(
                    conferencePrepRes.published_agenda.published_at,
                    dateFormatter,
                    ""
                  ),
                })}
              </div>
            ) : null}
          </Panel>
        </div>
      </section>
    </div>
  );

  if (!teacherId) {
    return (
      <LayoutShell>
        <div className="mx-auto max-w-6xl px-6 py-6">
          <PageContextHeader
            title={headerTitle}
            description={t("teacherWorkspace.noLinkedTeacherDescription")}
          />
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageContextHeader
          breadcrumbs={
            isAdmin
              ? [
                  { label: t("nav.teachers"), to: "/teachers" },
                  {
                    label: teacherRes?.name || t("teacherWorkspace.fallbackName"),
                    to: `/teachers/${teacherId}`,
                  },
                  { label: headerTitle },
                ]
              : [
                  { label: t("nav.myWorkspace"), to: "/my-workspace" },
                  { label: headerTitle },
                ]
          }
          title={headerTitle}
          description={headerDescription}
          meta={headerMeta}
          tags={institutionTags}
          stats={[
            {
              label: t("teacherProfile.coachingStatusGoals"),
              value: t("teacherProfile.goalsInMotionCount", {
                open: openGoals.length,
                completed: completedGoals.length,
              }),
            },
            {
              label: t("teacherProfile.latestTeacherReflectionTitle"),
              value: formatSavedAt(
                latestTeacherReflection?.saved_at,
                dateFormatter,
                t("teacherProfile.noTeacherReflection")
              ),
            },
            {
              label: t("teacherProfile.coachingStatusConference"),
              value: nextConferenceAt
                ? formatSavedAt(nextConferenceAt, dateFormatter, t("teacherProfile.nextConferenceNotScheduled"))
                : t("teacherProfile.nextConferenceNotScheduled"),
            },
          ]}
          quickLinks={tabLinks}
          actions={
            focusedRecordLink ? (
              <Link
                to={focusedRecordLink}
                className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                {activeTab === "goals"
                  ? t("teacherProfile.openActionPlanRecord")
                  : t("teacherProfile.openReflectionRecord")}
              </Link>
            ) : null
          }
        />

        {activeTab === "goals" ? renderGoalsTab() : null}
        {activeTab === "reflections" ? renderReflectionsTab() : null}
        {activeTab === "timeline" ? renderTimelineTab() : null}
        {activeTab === "conference" ? renderConferenceTab() : null}
      </div>
    </LayoutShell>
  );
}

export default CoachingHubPage;
