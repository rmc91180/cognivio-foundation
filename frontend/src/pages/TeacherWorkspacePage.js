import React, { useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, PageHeader, Panel } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";

function WorkspaceSectionCard({
  id,
  title,
  description,
  tags,
  actions,
  items,
  isActive,
}) {
  return (
    <Panel
      id={id}
      className={[
        "space-y-4 border transition-colors",
        isActive ? "border-primary/40 bg-primary/5" : "border-slate-200 bg-white",
      ].join(" ")}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {tags.map((tag) => (
            <span
              key={`${id}-${tag}`}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600"
            >
              {tag}
            </span>
          ))}
        </div>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      <div className="space-y-2 text-sm text-slate-700">
        {items.map((item) => (
          <div key={`${id}-${item}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            {item}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) =>
          action.href ? (
            <Link
              key={`${id}-${action.label}`}
              to={action.href}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {action.label}
            </Link>
          ) : (
            <button
              key={`${id}-${action.label}`}
              type="button"
              onClick={action.onClick}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {action.label}
            </button>
          )
        )}
      </div>
    </Panel>
  );
}

export function TeacherWorkspacePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const activeSection = useMemo(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts[1] || "overview";
  }, [location.pathname]);

  const sections = useMemo(
    () => [
      {
        id: "overview",
        title: t("teacherWorkspace.currentTitle"),
        description: t("teacherWorkspace.currentDescription"),
        tags: [t("timeScope.latestClass"), t("timeScope.immediateFollowUp")],
        items: [
          t("teacherWorkspace.currentItemLatest"),
          t("teacherWorkspace.currentItemAttention"),
          t("teacherWorkspace.currentItemNext"),
        ],
        actions: [
          { label: t("teacherWorkspace.openVideos"), href: "/videos" },
          { label: t("teacherWorkspace.viewGoals"), href: "/my-workspace/goals" },
        ],
      },
      {
        id: "goals",
        title: t("teacherWorkspace.goalsTitle"),
        description: t("teacherWorkspace.goalsDescription"),
        tags: [t("timeScope.ongoingGoal"), t("timeScope.recurringPattern")],
        items: [
          t("teacherWorkspace.goalsItemPattern"),
          t("teacherWorkspace.goalsItemProgress"),
          t("teacherWorkspace.goalsItemImplementation"),
        ],
        actions: [
          { label: t("teacherWorkspace.returnHome"), href: "/my-workspace" },
          { label: t("teacherWorkspace.viewHistory"), href: "/my-workspace/history" },
        ],
      },
      {
        id: "materials",
        title: t("teacherWorkspace.materialsTitle"),
        description: t("teacherWorkspace.materialsDescription"),
        tags: [t("teacherWorkspace.workspaceTag")],
        items: [
          t("teacherWorkspace.materialsItemPrivacy"),
          t("teacherWorkspace.materialsItemVideo"),
          t("teacherWorkspace.materialsItemDocuments"),
        ],
        actions: [
          { label: t("teacherWorkspace.openVideos"), href: "/videos" },
          { label: t("teacherWorkspace.returnHome"), href: "/my-workspace" },
        ],
      },
      {
        id: "history",
        title: t("teacherWorkspace.historyTitle"),
        description: t("teacherWorkspace.historyDescription"),
        tags: [t("timeScope.acrossRecentObservations")],
        items: [
          t("teacherWorkspace.historyItemLessons"),
          t("teacherWorkspace.historyItemComments"),
          t("teacherWorkspace.historyItemGoals"),
        ],
        actions: [
          { label: t("teacherWorkspace.returnHome"), href: "/my-workspace" },
          { label: t("teacherWorkspace.viewGoals"), href: "/my-workspace/goals" },
        ],
      },
    ],
    [t]
  );

  const activeSectionCard =
    sections.find((section) => section.id === activeSection) || sections[0];

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title={t("teacherWorkspace.title")}
          description={t("teacherWorkspace.description")}
          meta={t("teacherWorkspace.roleMeta")}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => navigate("/videos")}>
                {t("teacherWorkspace.openVideos")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => navigate("/my-workspace/materials")}>
                {t("teacherWorkspace.openMaterials")}
              </Button>
            </div>
          }
        />

        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                {t("teacherWorkspace.roleBadge")}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {t("teacherWorkspace.welcomeTitle", {
                    name: user?.name || t("teacherWorkspace.fallbackName"),
                  })}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{t("teacherWorkspace.welcomeDescription")}</p>
              </div>
            </div>
            <div className="grid gap-2 text-right text-xs text-slate-500">
              <div>{t("teacherWorkspace.summaryLatest")}</div>
              <div>{t("teacherWorkspace.summaryGoals")}</div>
              <div>{t("teacherWorkspace.summaryUploads")}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Panel className="space-y-3 self-start lg:sticky lg:top-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">{t("teacherWorkspace.sectionsTitle")}</h2>
              <p className="mt-1 text-xs text-slate-500">{t("teacherWorkspace.sectionsDescription")}</p>
            </div>
            <div className="space-y-2">
              {sections.map((section) => (
                <Link
                  key={section.id}
                  to={section.id === "overview" ? "/my-workspace" : `/my-workspace/${section.id}`}
                  className={[
                    "block rounded-xl border px-3 py-3 text-sm transition-colors",
                    activeSectionCard.id === section.id
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
                  ].join(" ")}
                >
                  <div className="font-semibold">{section.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{section.description}</div>
                </Link>
              ))}
            </div>
          </Panel>

          <div className="space-y-6">
            {sections.map((section) => (
              <WorkspaceSectionCard
                key={section.id}
                {...section}
                isActive={activeSectionCard.id === section.id}
              />
            ))}
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}
