import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { LayoutShell } from "@/components/LayoutShell";
import {
  PageContextHeader,
  Panel,
  SectionHeader,
  SkeletonCard,
  SkeletonText,
} from "@/components/ui";
import { resolveCoachingLink } from "@/lib/coachingRoutes";
import { observationSessionApi, reportApi } from "@/lib/api";
import { useAdminTeacherDeepDiveData } from "@/pages/teacher-deep-dive/useAdminTeacherDeepDiveData";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { isSuperAdminUser } from "@/lib/userRoutes";

function TeacherProfileSkeleton() {
  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <SkeletonText width={120} />
          <SkeletonText width={320} className="mt-4" />
          <SkeletonText width={460} className="mt-3" />
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <SkeletonText width="80%" />
            <SkeletonText width="70%" />
            <SkeletonText width="75%" />
          </div>
        </div>
        <div className="mt-6 space-y-4">
          <SkeletonCard height={180} />
          <SkeletonCard height={260} />
          <SkeletonCard height={220} />
        </div>
      </div>
    </LayoutShell>
  );
}

function observationSessionOutcomeLabel(status) {
  if (status === "feedback_given") return "Feedback shared";
  if (status === "analysis_complete") return "Feedback ready";
  if (status === "recording_uploaded") return "Recording uploaded";
  return "Planned";
}

export function TeacherProfilePage() {
  const { teacherId } = useParams();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const {
    isLoading,
    teacherRes,
    summaryInsightsRes,
    conferencePrepRes,
    coachingTasks,
    latestAssessment,
    latestReviewedAt,
    latestObservation,
    latestTeacherReflection,
    latestAdminReflection,
    latestLessonSignals,
    recurringPatternSummary,
    openGoals,
    completedGoals,
    patternStrengthLabel,
    formatDateTime,
    formatScore,
  } = useAdminTeacherDeepDiveData({ teacherId });

  const { data: observationSessions = [] } = useQuery({
    queryKey: ["observation-sessions", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () =>
      observationSessionApi
        .list({ teacher_id: teacherId })
        .then((res) => res.data),
  });

  const latestVideoLink = latestAssessment?.video_id
    ? `/videos/${latestAssessment.video_id}`
    : `/videos?teacher_id=${teacherId}`;
  const adminActionTasks = coachingTasks.slice(0, 3);
  const isSuperAdmin = isSuperAdminUser(user);
  const teacherContextCards = [
    {
      label: t("teacherProfile.contextSchoolLabel"),
      value: teacherRes?.school_name || t("teacherProfile.contextUnknown"),
    },
    {
      label: t("teacherProfile.contextOrganizationLabel"),
      value: teacherRes?.organization_name || t("teacherProfile.contextUnknown"),
    },
    {
      label: t("teacherProfile.contextAdministratorLabel"),
      value:
        teacherRes?.manager_name || teacherRes?.manager_email || t("teacherProfile.contextUnknown"),
    },
  ];

  const handleExportReport = async (format) => {
    try {
      const res = await reportApi.export(format, { teacher_id: teacherId });
      const blob = new Blob([res.data], { type: res.headers["content-type"] });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        format === "csv"
          ? i18n.language === "he"
            ? "teacher-summary-he.csv"
            : "teacher-summary.csv"
          : i18n.language === "he"
            ? "teacher-summary-he.pdf"
            : "teacher-summary.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error(t("teacherProfile.reportExportFailed"));
    }
  };

  if (isLoading) {
    return <TeacherProfileSkeleton />;
  }

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageContextHeader
          breadcrumbs={[
            { label: t("nav.teachers"), to: "/teachers" },
            { label: teacherRes?.name || t("teacherProfile.fallbackTeacher") },
          ]}
          title={t("teacherProfile.title", {
            name: teacherRes?.name || t("teacherProfile.fallbackTeacher"),
          })}
          description={t("teacherProfile.summaryHubDescription")}
          meta={t("teacherProfile.coachingWorkspace")}
          stats={[
            {
              label: t("teacherProfile.coachingStatusLatestLesson"),
              value: latestReviewedAt
                ? formatDateTime(latestReviewedAt)
                : t("teacherProfile.noLessonReviewedYet"),
            },
            {
              label: t("teacherProfile.coachingStatusGoals"),
              value: t("teacherProfile.goalsInMotionCount", {
                open: openGoals.length,
                completed: completedGoals.length,
              }),
            },
            {
              label: t("teacherProfile.coachingStatusConference"),
              value: conferencePrepRes?.next_conference
                ? formatDateTime(conferencePrepRes.next_conference)
                : t("teacherProfile.nextConferenceNotScheduled"),
            },
          ]}
          quickLinks={[
            {
              label: "Plan observation",
              to: `/observation/new?teacher_id=${teacherId}`,
            },
            {
              label: t("teacherProfile.openLatestLessonPage"),
              to: `/teachers/${teacherId}/latest-lesson`,
            },
            {
              label: t("teacherProfile.openOngoingCoachingPage"),
              to: `/teachers/${teacherId}/coaching`,
            },
            {
              label: t("teacherProfile.openHistoryPage"),
              to: `/teachers/${teacherId}/history`,
            },
            {
              label: t("teacherProfile.openActionPlanRecord"),
              to: `/teachers/${teacherId}/action-plan`,
            },
            {
              label: t("teacherProfile.openReflectionRecord"),
              to: `/teachers/${teacherId}/reflections`,
            },
            ...(isSuperAdmin
              ? [
                  {
                    label: t("teacherProfile.openOperationsPage"),
                    to: `/teachers/${teacherId}/operations`,
                  },
                ]
              : []),
          ]}
        />

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <SectionHeader
            eyebrow={t("teacherProfile.contextEyebrow")}
            title={t("teacherProfile.contextTitle")}
            description={t("teacherProfile.contextDescription")}
          />
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {teacherContextCards.map((card) => (
              <Panel key={card.label} className="h-full">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {card.label}
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-900">
                  {card.value}
                </div>
              </Panel>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <SectionHeader
            eyebrow={t("teacherProfile.pageGuideTitle")}
            title={t("teacherProfile.pageGuideTitle")}
            description={t("teacherProfile.pageGuideDescription")}
          />
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Panel className="h-full">
              <div className="text-sm font-semibold text-slate-900">
                {t("teacherProfile.pageGuideLatestTitle")}
              </div>
              <div className="mt-2 text-sm text-slate-600">
                {t("teacherProfile.pageGuideLatestDescription")}
              </div>
            </Panel>
            <Panel className="h-full">
              <div className="text-sm font-semibold text-slate-900">
                {t("teacherProfile.pageGuidePatternsTitle")}
              </div>
              <div className="mt-2 text-sm text-slate-600">
                {t("teacherProfile.pageGuidePatternsDescription")}
              </div>
            </Panel>
            <Panel className="h-full">
              <div className="text-sm font-semibold text-slate-900">
                {t("teacherProfile.pageGuideActionsTitle")}
              </div>
              <div className="mt-2 text-sm text-slate-600">
                {t("teacherProfile.pageGuideActionsDescription")}
              </div>
            </Panel>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                eyebrow={t("timeScope.fromThisLesson")}
                title={t("teacherProfile.latestClassReview")}
                description={t("teacherProfile.latestClassReviewDescription")}
              />
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                {summaryInsightsRes?.summary || t("teacherProfile.noSummaryData")}
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Panel className="h-full">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
                    {t("teacherProfile.latestStrengths")}
                  </div>
                  <div className="mt-3 space-y-2">
                    {latestLessonSignals.strengths.length ? (
                      latestLessonSignals.strengths.map((item) => (
                        <div
                          key={item.element_id}
                          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2"
                        >
                          <div className="text-sm font-medium text-slate-900">{item.label}</div>
                          <div className="mt-1 text-xs text-slate-600">
                            {t("teacherProfile.lessonSignalScoreLine", {
                              score: formatScore(item.score),
                            })}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-500">{t("teacherProfile.noRecentHighlights")}</div>
                    )}
                  </div>
                </Panel>
                <Panel className="h-full">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">
                    {t("teacherProfile.immediateConcerns")}
                  </div>
                  <div className="mt-3 space-y-2">
                    {latestLessonSignals.concerns.length ? (
                      latestLessonSignals.concerns.map((item) => (
                        <div
                          key={item.element_id}
                          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
                        >
                          <div className="text-sm font-medium text-slate-900">{item.label}</div>
                          <div className="mt-1 text-xs text-slate-600">
                            {t("teacherProfile.lessonSignalScoreLine", {
                              score: formatScore(item.score),
                            })}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-500">{t("teacherProfile.noRecentHighlights")}</div>
                    )}
                  </div>
                </Panel>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Panel className="h-full">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.latestAdminComment")}
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    {latestObservation?.admin_comment || t("teacherProfile.noAdminComment")}
                  </div>
                </Panel>
                <Panel className="h-full">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.latestTeacherResponse")}
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    {latestObservation?.teacher_response ||
                      t("teacherProfile.noLatestTeacherResponse")}
                  </div>
                </Panel>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                eyebrow={t("timeScope.ongoingGoal")}
                title={t("teacherProfile.ongoingCoachingRecord")}
                description={t("teacherProfile.ongoingCoachingRecordDescription")}
              />
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Panel className="h-full">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.longTermGoals")}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {openGoals.length ? (
                      openGoals.slice(0, 4).map((goal) => (
                        <span
                          key={goal.id}
                          className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-700"
                        >
                          {goal.title || t("teacherWorkspace.goalUntitled")}
                        </span>
                      ))
                    ) : (
                      <div className="text-xs text-slate-500">{t("teacherProfile.noSharedGoalsYet")}</div>
                    )}
                  </div>
                </Panel>
                <Panel className="h-full">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.patternStrength")}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">
                    {patternStrengthLabel}
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-700">
                    {(recurringPatternSummary.challenges.length
                      ? recurringPatternSummary.challenges
                      : recurringPatternSummary.strengths
                    )
                      .slice(0, 3)
                      .map((item) => (
                        <div
                          key={item.elementId}
                          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                        >
                          {item.label}
                        </div>
                      ))}
                  </div>
                </Panel>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Panel className="h-full">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.latestTeacherReflectionTitle")}
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    {latestTeacherReflection?.self_reflection || t("teacherProfile.noTeacherReflection")}
                  </div>
                </Panel>
                <Panel className="h-full">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.latestAdminReflectionTitle")}
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    {latestAdminReflection?.self_reflection || t("teacherProfile.noPrincipalReflection")}
                  </div>
                </Panel>
              </div>
            </section>
          </div>

          <div className="space-y-6 lg:col-span-4">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                eyebrow={t("teacherProfile.adminActionLane")}
                title={t("teacherProfile.adminActionLane")}
                description={t("teacherProfile.adminActionLaneDescription")}
              />
              <div className="mt-4 space-y-3">
                {adminActionTasks.length ? (
                  adminActionTasks.map((task) => (
                    <div
                      key={task.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4"
                    >
                      <div className="text-sm font-semibold text-slate-900">{task.title}</div>
                      <div className="mt-2 text-xs uppercase tracking-wide text-slate-500">
                        {t(`coachingTasks.states.${task.state}`)}
                      </div>
                      <div className="mt-2 text-sm text-slate-700">{task.description}</div>
                      <Link
                        to={resolveCoachingLink(user, teacherId, task.route_hint, task.payload)}
                        className="mt-3 inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                      >
                        {t("coachingTasks.openTask")}
                      </Link>
                    </div>
                  ))
                ) : (
                  <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                    {t("coachingTasks.empty")}
                  </div>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to="/master-schedule"
                  className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-white hover:bg-primary/90"
                >
                  {t("teacherProfile.viewMasterSchedule")}
                </Link>
                <button
                  type="button"
                  onClick={() => handleExportReport("pdf")}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                >
                  {t("teacherProfile.exportPdf")}
                </button>
                <button
                  type="button"
                  onClick={() => handleExportReport("csv")}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                >
                  {t("teacherProfile.exportCsv")}
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                eyebrow="Observation planning"
                title="Observation sessions"
                description="Plan a focused visit or review past focus areas and outcomes."
                actions={
                  <Link
                    to={`/observation/new?teacher_id=${teacherId}`}
                    className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-white hover:bg-primary/90"
                  >
                    Plan observation
                  </Link>
                }
              />
              <div className="mt-4 space-y-3">
                {observationSessions.length ? (
                  observationSessions.slice(0, 5).map((session) => (
                    <div
                      key={session.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900">
                          {session.scheduled_date
                            ? formatDateTime(session.scheduled_date)
                            : "Date not set"}
                        </div>
                        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                          {observationSessionOutcomeLabel(session.status)}
                        </span>
                      </div>
                      {session.focus_elements?.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {session.focus_elements.map((focus) => (
                            <span
                              key={focus}
                              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700"
                            >
                              {focus}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {session.focus_note ? (
                        <p className="mt-3 text-xs leading-5 text-slate-600">
                          {session.focus_note}
                        </p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                    Focused observation plans will appear here.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                eyebrow={t("teacherProfile.recordHistory")}
                title={t("teacherProfile.historyArchiveTitle")}
                description={t("teacherProfile.historyArchiveDescription")}
              />
              <div className="mt-4 space-y-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                  {t("teacherProfile.historyArchiveSummary")}
                </div>
                <Link
                  to={`/teachers/${teacherId}/history`}
                  className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                >
                  {t("teacherProfile.openHistoryPage")}
                </Link>
                <Link
                  to={latestVideoLink}
                  className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                >
                  {t("teacherProfile.openVideo")}
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}
