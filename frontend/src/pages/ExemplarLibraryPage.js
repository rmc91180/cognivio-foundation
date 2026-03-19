import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { exemplarApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel } from "@/components/ui";

export function ExemplarLibraryPage() {
  const { t } = useTranslation();
  const [subjectFilter, setSubjectFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["exemplar-library", subjectFilter, tagFilter],
    queryFn: () =>
      exemplarApi
        .list({
          ...(subjectFilter ? { subject: subjectFilter } : {}),
          ...(tagFilter ? { tag: tagFilter } : {}),
        })
        .then((res) => res.data),
  });

  const items = useMemo(() => data?.items || [], [data]);

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title={t("exemplarLibrary.title")}
          description={t("exemplarLibrary.description")}
        />

        <Panel className="mb-6">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {t("exemplarLibrary.subject")}
              </label>
              <input
                type="text"
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                placeholder={t("exemplarLibrary.filterBySubject")}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {t("exemplarLibrary.tag")}
              </label>
              <input
                type="text"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                placeholder={t("exemplarLibrary.filterByTag")}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              />
            </div>
          </div>
        </Panel>

        {isLoading ? (
          <LoadingState message={t("exemplarLibrary.loading")} />
        ) : isError ? (
          <ErrorState
            title={t("exemplarLibrary.errorTitle")}
            message={t("exemplarLibrary.errorMessage")}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={t("exemplarLibrary.emptyTitle")}
            message={t("exemplarLibrary.emptyMessage")}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {items.map((item) => (
              <Panel key={item.id} className="overflow-hidden p-0">
                {item.playback_url ? (
                  <video
                    controls
                    className="aspect-video w-full bg-black"
                    poster={item.thumbnail_url || undefined}
                    src={item.playback_url}
                  />
                ) : (
                  <div className="aspect-video w-full bg-slate-100" />
                )}
                <div className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {item.teacher_display_name || "Teacher"} {item.subject ? `• ${item.subject}` : ""}
                      </div>
                    </div>
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                      {t("exemplarLibrary.fiveStarLesson")}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-slate-600">{item.summary}</p>
                  {item.tags?.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {item.tags.map((tag) => (
                        <span
                          key={`${item.id}-${tag}`}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-4">
                    <Link
                      to={`/videos/${item.video_id}`}
                      className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                    >
                      {t("exemplarLibrary.openLessonPage")}
                    </Link>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>
    </LayoutShell>
  );
}
