import React, { useMemo } from "react";
import { useParams } from "react-router-dom";
import { LayoutShell } from "@/components/LayoutShell";
import { CoachingTimelinePanel } from "@/components/coaching/CoachingTimelinePanel";
import { PageContextHeader, Panel, SectionHeader } from "@/components/ui";
import { useAdminTeacherDeepDiveData } from "@/pages/teacher-deep-dive/useAdminTeacherDeepDiveData";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";

export function TeacherOngoingCoachingPage() {
  const { teacherId } = useParams();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const {
    teacherRes,
    conferencePrepRes,
    coachingTimelineEntries,
    latestTeacherReflection,
    latestAdminReflection,
    recurringPatternSummary,
    openGoals,
    completedGoals,
    patternStrengthLabel,
    formatDateTime,
  } = useAdminTeacherDeepDiveData({ teacherId });

  const timelineFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === "he" ? "he-IL" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language]
  );

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageContextHeader
          breadcrumbs={[
            { label: t("nav.teachers"), to: "/teachers" },
            {
              label: teacherRes?.name || t("teacherProfile.fallbackTeacher"),
              to: `/teachers/${teacherId}`,
            },
            { label: t("teacherProfile.ongoingCoachingPageTitle") },
          ]}
          title={t("teacherProfile.ongoingCoachingPageTitle")}
          description={t("teacherProfile.ongoingCoachingPageDescription")}
          meta={t("teacherProfile.ongoingCoachingPageMeta", {
            name: teacherRes?.name || t("teacherProfile.fallbackTeacher"),
          })}
          stats={[
            {
              label: t("teacherProfile.coachingStatusGoals"),
              value: t("teacherProfile.goalsInMotionCount", {
                open: openGoals.length,
                completed: completedGoals.length,
              }),
            },
            {
              label: t("teacherProfile.patternStrength"),
              value: patternStrengthLabel,
            },
            {
              label: t("teacherProfile.coachingStatusConference"),
              value: conferencePrepRes?.next_conference
                ? formatDateTime(conferencePrepRes.next_conference)
                : t("teacherProfile.nextConferenceNotScheduled"),
            },
          ]}
          quickLinks={[
            { label: t("teacherProfile.returnToTeacher"), to: `/teachers/${teacherId}` },
            {
              label: t("teacherProfile.openActionPlanRecord"),
              to: `/teachers/${teacherId}/action-plan`,
            },
            {
              label: t("teacherProfile.openReflectionRecord"),
              to: `/teachers/${teacherId}/reflections`,
            },
            { label: t("teacherProfile.openHistoryPage"), to: `/teachers/${teacherId}/history` },
          ]}
        />

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                eyebrow={t("timeScope.ongoingGoal")}
                title={t("teacherProfile.longTermGoalsAndAdherence")}
                description={t("teacherProfile.longTermGoalsAndAdherenceDescription")}
              />
              <div className="mt-4 space-y-3">
                {openGoals.length ? (
                  openGoals.map((goal) => (
                    <div
                      key={goal.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {goal.title || t("teacherWorkspace.goalUntitled")}
                          </div>
                          <div className="mt-1 text-xs text-slate-600">
                            {goal.description || t("teacherWorkspace.goalNoDescription")}
                          </div>
                        </div>
                        {goal.progress_signal ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                            {t(`goalProgressSignals.${goal.progress_signal}`)}
                          </span>
                        ) : null}
                      </div>
                      {goal.progress_summary ? (
                        <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-3 text-xs text-slate-700">
                          {goal.progress_summary}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-md border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500">
                    {t("teacherProfile.noSharedGoalsYet")}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                eyebrow={t("timeScope.recurringPattern")}
                title={t("teacherProfile.recurringPatternsTitle")}
                description={t("teacherProfile.longTermGoalsEvidenceNote")}
              />
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Panel className="h-full">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
                    {t("teacherProfile.recurringStrengths")}
                  </div>
                  <div className="mt-3 space-y-2">
                    {recurringPatternSummary.strengths.length ? (
                      recurringPatternSummary.strengths.map((item) => (
                        <div
                          key={item.elementId}
                          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-slate-800"
                        >
                          {item.label}
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-500">
                        {t("teacherProfile.noRecurringStrengths")}
                      </div>
                    )}
                  </div>
                </Panel>
                <Panel className="h-full">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">
                    {t("teacherProfile.recurringChallenges")}
                  </div>
                  <div className="mt-3 space-y-2">
                    {recurringPatternSummary.challenges.length ? (
                      recurringPatternSummary.challenges.map((item) => (
                        <div
                          key={item.elementId}
                          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-slate-800"
                        >
                          {item.label}
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-500">
                        {t("teacherProfile.noRecurringChallenges")}
                      </div>
                    )}
                  </div>
                </Panel>
              </div>
            </section>
          </div>

          <div className="space-y-6 lg:col-span-4">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                eyebrow={t("teacherProfile.conferencePrepContinuity")}
                title={t("teacherProfile.conferenceContinuityTitle")}
                description={t("teacherProfile.conferenceContinuityDescription")}
              />
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                {(conferencePrepRes?.continuity_lines || []).length ? (
                  conferencePrepRes.continuity_lines.slice(0, 4).map((line, index) => (
                    <div
                      key={`${line}-${index}`}
                      className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3"
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
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                eyebrow={t("teacherProfile.professionalInsights")}
                title={t("teacherProfile.sharedRecordsTitle")}
                description={t("teacherProfile.sharedRecordsDescription")}
              />
              <div className="mt-4 space-y-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.latestTeacherReflectionTitle")}
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    {latestTeacherReflection?.self_reflection ||
                      t("teacherProfile.noTeacherReflection")}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.latestAdminReflectionTitle")}
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    {latestAdminReflection?.self_reflection ||
                      t("teacherProfile.noPrincipalReflection")}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="mt-6">
          <CoachingTimelinePanel
            title={t("coachingTimeline.title")}
            description={t("coachingTimeline.description")}
            eyebrow={t("teacherProfile.recordHistory")}
            entries={coachingTimelineEntries}
            user={user}
            teacherId={teacherId}
            t={t}
            emptyLabel={t("coachingTimeline.empty")}
            dateFormatter={timelineFormatter}
          />
        </div>
      </div>
    </LayoutShell>
  );
}
