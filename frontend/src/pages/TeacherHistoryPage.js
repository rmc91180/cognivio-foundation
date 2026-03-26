import React, { useState } from "react";
import { useParams } from "react-router-dom";
import { LayoutShell } from "@/components/LayoutShell";
import { MonthlySummary } from "@/components/MonthlySummary";
import { PageContextHeader, SectionHeader } from "@/components/ui";
import { useAdminTeacherDeepDiveData } from "@/pages/teacher-deep-dive/useAdminTeacherDeepDiveData";
import { useTranslation } from "react-i18next";

export function TeacherHistoryPage() {
  const { teacherId } = useParams();
  const { t } = useTranslation();
  const [periodMonths, setPeriodMonths] = useState(6);
  const {
    teacherRes,
    dashboardRes,
    observations,
    reflectionHistoryRes,
    actionPlanHistoryRes,
    formatDateTime,
  } = useAdminTeacherDeepDiveData({ teacherId, periodMonths });

  const reflectionHistory = reflectionHistoryRes?.history || [];
  const actionPlanHistory = actionPlanHistoryRes?.history || [];

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
            { label: t("teacherProfile.historyPageTitle") },
          ]}
          title={t("teacherProfile.historyPageTitle")}
          description={t("teacherProfile.historyPageDescription")}
          meta={t("teacherProfile.historyPageMeta", {
            name: teacherRes?.name || t("teacherProfile.fallbackTeacher"),
          })}
          stats={[
            {
              label: t("teacherProfile.lessonHistoryCount"),
              value: `${dashboardRes?.assessments?.length || 0}`,
            },
            {
              label: t("teacherProfile.reflectionHistoryTitle"),
              value: `${reflectionHistory.length}`,
            },
            {
              label: t("teacherProfile.actionPlanHistoryTitle"),
              value: `${actionPlanHistory.length}`,
            },
          ]}
          quickLinks={[
            { label: t("teacherProfile.returnToTeacher"), to: `/teachers/${teacherId}` },
            {
              label: t("teacherProfile.openLatestLessonPage"),
              to: `/teachers/${teacherId}/latest-lesson`,
            },
            {
              label: t("teacherProfile.openOngoingCoachingPage"),
              to: `/teachers/${teacherId}/coaching`,
            },
          ]}
        />

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <SectionHeader
                eyebrow={t("teacherProfile.historyArchiveTitle")}
                title={t("teacherProfile.historyArchiveDescription")}
              />
            </div>
            <label className="text-xs text-slate-500">
              {t("teacherProfile.period")}
              <select
                value={periodMonths}
                onChange={(event) => setPeriodMonths(Number(event.target.value))}
                className="ml-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              >
                <option value={1}>{t("teacherProfile.month1")}</option>
                <option value={3}>{t("teacherProfile.month3")}</option>
                <option value={6}>{t("teacherProfile.month6")}</option>
                <option value={12}>{t("teacherProfile.month12")}</option>
              </select>
            </label>
          </div>
          <MonthlySummary dashboardRes={dashboardRes} periodMonths={periodMonths} />
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <SectionHeader
              eyebrow={t("teacherProfile.historyObservationsTitle")}
              title={t("teacherProfile.historyObservationsTitle")}
            />
            <div className="mt-4 space-y-3">
              {observations.length ? (
                observations.slice(0, 8).map((observation) => (
                  <div
                    key={observation.id}
                    className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3"
                  >
                    <div className="text-[11px] text-slate-500">
                      {formatDateTime(observation.created_at)}
                    </div>
                    <div className="mt-2 text-sm text-slate-700">
                      {observation.admin_comment ||
                        observation.summary ||
                        t("teacherProfile.observationRecorded")}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                  {t("teacherProfile.noHistoryObservations")}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <SectionHeader
              eyebrow={t("teacherProfile.reflectionHistoryTitle")}
              title={t("teacherProfile.reflectionHistoryTitle")}
            />
            <div className="mt-4 space-y-3">
              {reflectionHistory.length ? (
                reflectionHistory.slice(0, 6).map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3"
                  >
                    <div className="text-[11px] text-slate-500">
                      {formatDateTime(entry.saved_at)}
                    </div>
                    <div className="mt-2 text-sm text-slate-700">
                      {entry.self_reflection || t("teacherProfile.noReflectionEntry")}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                  {t("teacherProfile.noHistoryReflections")}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <SectionHeader
              eyebrow={t("teacherProfile.actionPlanHistoryTitle")}
              title={t("teacherProfile.actionPlanHistoryTitle")}
            />
            <div className="mt-4 space-y-3">
              {actionPlanHistory.length ? (
                actionPlanHistory.slice(0, 6).map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3"
                  >
                    <div className="text-[11px] text-slate-500">
                      {formatDateTime(entry.saved_at)}
                    </div>
                    <div className="mt-2 text-sm text-slate-700">
                      {(entry.goals || [])
                        .map((goal) => goal.title)
                        .filter(Boolean)
                        .slice(0, 2)
                        .join(" • ") || t("teacherProfile.noSharedGoalsYet")}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                  {t("teacherProfile.noHistoryPlans")}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </LayoutShell>
  );
}
