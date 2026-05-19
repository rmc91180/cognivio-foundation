import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { EmptyState, ErrorState, LoadingState, PageContextHeader, Panel, SectionHeader } from "@/components/ui";
import { teacherApi } from "@/lib/api";

const formatDate = (value) => {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(parsed));
};

export function TeacherBadgesPage() {
  const recognitionQuery = useQuery({
    queryKey: ["teacher-recognition"],
    queryFn: () => teacherApi.myRecognition().then((res) => res.data),
    retry: 1,
  });
  const data = recognitionQuery.data || {};
  const summary = data.summary || {};
  const accolades = data.accolades || data.badges || [];
  const highlightedMoments = data.highlighted_moments || [];
  const spotlightLessons = data.spotlight_lessons || [];

  const copyShare = async (url) => {
    try {
      await navigator.clipboard?.writeText(url);
      toast.success("Share link copied.");
    } catch {
      toast.error("Share link could not be copied right now.");
    }
  };

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <PageContextHeader
          breadcrumbs={[{ label: "My Workspace", to: "/my-workspace" }, { label: "Recognition" }]}
          title="Your growth deserves to be seen."
          description="Return to Cognivio accolades, highlighted moments, and spotlight lessons from your reviewed recordings."
          badge="Recognition"
        />

        {recognitionQuery.isLoading ? <LoadingState message="Opening your recognition..." /> : null}
        {recognitionQuery.isError ? <ErrorState title="Recognition could not be opened" message="Try again in a moment. Your earned recognition is still saved." /> : null}

        {!recognitionQuery.isLoading && !recognitionQuery.isError ? (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Panel>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total earned</div>
                <div className="mt-2 text-3xl font-bold text-slate-950">{summary.total_earned || 0}</div>
              </Panel>
              <Panel>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">This month</div>
                <div className="mt-2 text-3xl font-bold text-slate-950">{summary.this_month || 0}</div>
              </Panel>
              <Panel>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest accolade</div>
                <div className="mt-2 text-lg font-semibold text-slate-950">{summary.latest_title || "Recognition will appear here"}</div>
              </Panel>
            </div>

            {accolades.length ? (
              <Panel className="space-y-4">
                <SectionHeader title="Cognivio accolades" description="Celebrations tied to real lesson feedback and highlighted teaching moves." />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {accolades.map((item) => (
                    <article key={item.id} className="rounded-xl border border-amber-100 bg-amber-50 p-5">
                      {item.image_url ? <img src={item.image_url} alt="" className="mb-4 h-28 w-full rounded-lg object-cover" /> : null}
                      <h2 className="text-lg font-semibold text-amber-950">{item.title || "Cognivio accolade"}</h2>
                      <p className="mt-2 text-sm leading-6 text-amber-900">{item.description}</p>
                      {item.earned_at ? <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-amber-800">Earned {formatDate(item.earned_at)}</p> : null}
                      <div className="mt-4 flex flex-wrap gap-3">
                        {item.video_id ? <Link to={`/videos/${item.video_id}`} className="text-sm font-semibold text-amber-950 underline">Open lesson</Link> : null}
                        {item.share_url ? <button type="button" onClick={() => copyShare(item.share_url)} className="text-sm font-semibold text-amber-950 underline">Copy share link</button> : null}
                      </div>
                    </article>
                  ))}
                </div>
              </Panel>
            ) : (
              <EmptyState
                title="Recognition you earn will appear here."
                message="When a reviewed lesson highlights a strong coaching move, you’ll be able to return to it from this page."
              />
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              <Panel className="space-y-4">
                <SectionHeader title="Highlighted Moments" description="Lesson moments worth revisiting and celebrating." />
                {highlightedMoments.length ? highlightedMoments.map((item) => (
                  <Link key={`${item.id}-moment`} to={item.href || `/videos/${item.video_id}`} className="block rounded-lg border border-slate-200 bg-slate-50 p-4 hover:bg-white">
                    <div className="font-semibold text-slate-900">{item.title}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{item.description}</p>
                  </Link>
                )) : <EmptyState title="Highlighted moments will appear after recognition is awarded." />}
              </Panel>
              <Panel className="space-y-4">
                <SectionHeader title="Spotlight Lessons" description="Reviewed lessons you may want to return to before a coaching conversation." />
                {spotlightLessons.length ? spotlightLessons.map((item) => (
                  <Link key={`${item.id}-spotlight`} to={item.href || `/videos/${item.video_id}`} className="block rounded-lg border border-slate-200 bg-slate-50 p-4 hover:bg-white">
                    <div className="font-semibold text-slate-900">{item.lesson_title || item.title}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{item.description}</p>
                  </Link>
                )) : <EmptyState title="Spotlight lessons will appear here as your reviewed lessons build up." />}
              </Panel>
            </div>
          </div>
        ) : null}
      </div>
    </LayoutShell>
  );
}

export default TeacherBadgesPage;
