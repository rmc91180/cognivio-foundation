import React from "react";
import { Link, useParams } from "react-router-dom";
import { LayoutShell } from "@/components/LayoutShell";
import { ObservationFocusPanel } from "@/components/assessment/ObservationFocusPanel";
import { PageContextHeader, Panel, SectionHeader } from "@/components/ui";
import { useAdminTeacherDeepDiveData } from "@/pages/teacher-deep-dive/useAdminTeacherDeepDiveData";
import { useTranslation } from "react-i18next";
import { buildInstitutionContextTags } from "@/lib/institutionContext";

export function TeacherLatestLessonPage() {
  const { teacherId } = useParams();
  const { t } = useTranslation();
  const {
    teacherRes,
    summaryInsightsRes,
    latestAssessment,
    latestReviewedAt,
    latestLessonObservations,
    latestObservation,
    latestLessonSignals,
    analysisMoments,
    formatClock,
    formatDateTime,
    formatScore,
    formatMomentPhase,
    formatMomentReason,
  } = useAdminTeacherDeepDiveData({ teacherId });

  const latestVideoLink = latestAssessment?.video_id
    ? `/videos/${latestAssessment.video_id}`
    : `/videos?teacher_id=${teacherId}`;
  const institutionTags = buildInstitutionContextTags({
    subject: teacherRes,
    schoolLabel: t("teacherProfile.contextSchoolLabel"),
    organizationLabel: t("teacherProfile.contextOrganizationLabel"),
    managerLabel: t("teacherProfile.contextAdministratorLabel"),
    unknownLabel: t("teacherProfile.contextUnknown"),
  });

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
            { label: t("teacherProfile.latestLessonPageTitle") },
          ]}
          title={t("teacherProfile.latestLessonPageTitle")}
          description={t("teacherProfile.latestLessonPageDescription")}
          meta={t("teacherProfile.latestLessonPageMeta", {
            name: teacherRes?.name || t("teacherProfile.fallbackTeacher"),
          })}
          tags={institutionTags}
          stats={[
            {
              label: t("teacherProfile.coachingStatusLatestLesson"),
              value: latestReviewedAt
                ? formatDateTime(latestReviewedAt)
                : t("teacherProfile.noLessonReviewedYet"),
            },
            {
              label: t("labels.score"),
              value:
                latestAssessment?.overall_score != null
                  ? `${formatScore(latestAssessment.overall_score)}/10`
                  : t("teacherProfile.notConfigured"),
            },
            {
              label: t("teacherProfile.lessonObservationCount"),
              value: `${latestLessonObservations.length}`,
            },
          ]}
          quickLinks={[
            { label: t("teacherProfile.returnToTeacher"), to: `/teachers/${teacherId}` },
            { label: t("teacherProfile.openVideo"), to: latestVideoLink },
            {
              label: t("teacherProfile.openOngoingCoachingPage"),
              to: `/teachers/${teacherId}/coaching`,
            },
          ]}
        />

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                eyebrow={t("timeScope.fromThisLesson")}
                title={t("teacherProfile.latestVideoReview")}
                description={t("teacherProfile.latestVideoReviewDescription")}
              />
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                {summaryInsightsRes?.summary || t("teacherProfile.noSummaryData")}
              </div>

              <ObservationFocusPanel
                className="mt-4"
                frameworkType={latestAssessment?.framework_type || "danielson"}
                priorityElements={latestAssessment?.priority_elements || []}
                focusNote={latestAssessment?.focus_note}
                title={t("teacherProfile.focusContextTitle")}
                description={t("teacherProfile.focusContextDescription")}
              />

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Panel className="h-full">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
                    {t("teacherProfile.latestStrengths")}
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    {latestLessonSignals.strengths.length ? (
                      latestLessonSignals.strengths.map((item) => (
                        <div
                          key={item.element_id}
                          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2"
                        >
                          <div className="font-medium text-slate-900">{item.label}</div>
                          <div className="mt-1 text-xs text-slate-600">
                            {t("teacherProfile.lessonSignalScoreLine", {
                              score: formatScore(item.score),
                            })}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-500">
                        {t("teacherProfile.noRecentHighlights")}
                      </div>
                    )}
                  </div>
                </Panel>
                <Panel className="h-full">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">
                    {t("teacherProfile.immediateConcerns")}
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    {latestLessonSignals.concerns.length ? (
                      latestLessonSignals.concerns.map((item) => (
                        <div
                          key={item.element_id}
                          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
                        >
                          <div className="font-medium text-slate-900">{item.label}</div>
                          <div className="mt-1 text-xs text-slate-600">
                            {t("teacherProfile.lessonSignalScoreLine", {
                              score: formatScore(item.score),
                            })}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-500">
                        {t("teacherProfile.noRecentHighlights")}
                      </div>
                    )}
                  </div>
                </Panel>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                eyebrow={t("teacherProfile.timestampedEvidence")}
                title={t("teacherProfile.lessonEvidenceTitle")}
                description={t("teacherProfile.lessonEvidenceDescription")}
              />
              <div className="mt-4 space-y-3">
                {latestLessonObservations.length ? (
                  latestLessonObservations.map((observation) => (
                    <div
                      key={observation.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {observation.timestamp_seconds != null
                            ? formatClock(observation.timestamp_seconds)
                            : t("teacherProfile.observationRecorded")}
                        </div>
                        {observation.video_id ? (
                          <Link
                            to={`/videos/${observation.video_id}`}
                            className="text-[11px] font-medium text-primary hover:underline"
                          >
                            {t("teacherProfile.viewLinkedClip")}
                          </Link>
                        ) : null}
                      </div>
                      <div className="mt-2 text-sm text-slate-800">
                        {observation.admin_comment ||
                          observation.summary ||
                          t("teacherProfile.observationRecorded")}
                      </div>
                      {observation.teacher_response ? (
                        <div className="mt-2 text-xs text-slate-600">
                          <span className="font-semibold text-slate-700">
                            {t("teacherProfile.latestTeacherResponse")}
                          </span>{" "}
                          {observation.teacher_response}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-md border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500">
                    {t("teacherProfile.noLessonObservations")}
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-6 lg:col-span-4">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                eyebrow={t("teacherProfile.latestAdminComment")}
                title={t("teacherProfile.lessonSpecificFollowUpTitle")}
                description={t("teacherProfile.lessonSpecificFollowUpDescription")}
              />
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.latestAdminComment")}
                  </div>
                  <div className="mt-2">
                    {latestObservation?.admin_comment || t("teacherProfile.noAdminComment")}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.latestTeacherResponse")}
                  </div>
                  <div className="mt-2">
                    {latestObservation?.teacher_response ||
                      t("teacherProfile.noLatestTeacherResponse")}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                eyebrow={t("teacherProfile.recommendedMomentsTitle")}
                title={t("teacherProfile.lessonMomentsTitle")}
                description={t("teacherProfile.lessonMomentsDescription")}
              />
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                {analysisMoments.length ? (
                  analysisMoments.slice(0, 4).map((moment) => (
                    <div
                      key={`${moment.start_sec}-${moment.end_sec}`}
                      className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="font-medium text-slate-900">
                        {formatClock(moment.start_sec)}-{formatClock(moment.end_sec)}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        {formatMomentPhase(moment.phase)} •{" "}
                        {formatMomentReason(moment.selection_reason)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                    {t("teacherProfile.noRecommendedMoments")}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}
