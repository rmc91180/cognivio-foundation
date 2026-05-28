import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, EmptyState, ErrorState, Field, Input, LoadingState, PageContextHeader, Panel, SectionHeader } from "@/components/ui";
import { demoApi, teacherApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import {
  artifactActionItems,
  artifactGoldStar,
  artifactHighlights,
  artifactLatestSummary,
  artifactMomentCtaLabel,
  artifactNavigator,
  artifactNextBestAction,
  isArtifactAllowed,
  isArtifactBlocked,
  isNavigatorClickable,
  readArtifact,
} from "@/lib/teacherCoachingArtifact";

const formatDate = (value) => {
  if (!value) return "Soon";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(parsed));
};

const readinessLink = (blocker) => {
  if (!blocker) return "/my-profile";
  if (blocker.href) return blocker.href;
  if (blocker.code === "PRIVACY_CONSENT_REQUIRED") return "/consent";
  if (blocker.code === "REFERENCE_IMAGES_REQUIRED") return "/my-profile#privacy-reference-images";
  return "/my-profile";
};

function CardList({ items, emptyTitle }) {
  if (!items?.length) return <EmptyState title={emptyTitle} />;
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <Link key={item.id || `${item.title}-${index}`} to={item.href || "/my-workspace"} className="block rounded-lg border border-slate-200 bg-slate-50 p-4 hover:bg-white">
          <div className="font-semibold text-slate-900">{item.title}</div>
          {item.description ? <p className="mt-2 text-sm leading-6 text-slate-700">{item.description}</p> : null}
        </Link>
      ))}
    </div>
  );
}

export function TeacherWorkspacePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState("semester");
  const [query, setQuery] = useState("");
  const dashboardQuery = useQuery({
    queryKey: ["teacher-dashboard", period],
    queryFn: () => teacherApi.myDashboard({ period }).then((res) => res.data),
    retry: 1,
  });
  const searchQuery = useQuery({
    queryKey: ["teacher-search", query],
    queryFn: () => teacherApi.mySearch({ q: query }).then((res) => res.data),
    enabled: query.trim().length > 1,
  });
  const seedMutation = useMutation({
    mutationFn: () => demoApi.seed({ persona: "teacher", scope: "current_teacher" }),
    onSuccess: (response) => {
      const counts = response?.data?.counts || {};
      toast.success(`Demo workspace filled with ${counts.videos || 0} lessons and ${counts.coaching_tasks || 0} goals.`);
      [
        "teacher-self-profile",
        "teacher-dashboard",
        "teacher-lessons",
        "teacher-coaching",
        "teacher-recognition",
        "dashboard-intelligence",
        "admin-workspace-dashboard",
        "admin-workspace-search",
        "teachers",
        "reports",
        "coaching",
        "recognition",
      ].forEach((key) =>
        queryClient.invalidateQueries({ queryKey: [key] })
      );
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Demo seeding is available only in demo workspaces.");
    },
  });
  const markTriedMutation = useMutation({
    mutationFn: (taskId) => teacherApi.updateCoachingTask(taskId, { status: "tried" }),
    onSuccess: () => {
      toast.success("Marked as tried.");
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-coaching"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-lessons"] });
    },
    onError: () => toast.error("That action could not be updated right now."),
  });

  const data = dashboardQuery.data || {};
  const readiness = data.readiness || {};
  const missingItem = readiness.setup_next_step || readiness.missing_items?.[0];
  const latestLesson = data.latest_lesson;
  // PR C5: prefer the canonical artifact when present. A blocked artifact
  // forbids falling back to legacy fields.
  const lessonArtifact = readArtifact(latestLesson);
  const dashboardArtifact = readArtifact(data);
  const artifactForReading = lessonArtifact || dashboardArtifact;
  const artifactAllowed = isArtifactAllowed(artifactForReading);
  const artifactBlocked = isArtifactBlocked(artifactForReading);
  const legacyTeacherFeedback = latestLesson?.teacher_feedback || {};
  const artifactSummary = artifactLatestSummary(artifactForReading);
  // When the artifact is BLOCKED we MUST NOT render legacy summary text. When
  // the artifact is absent (legacy response) we fall back to the projection.
  const latestSummary = artifactAllowed
    ? artifactSummary
    : artifactBlocked
      ? null
      : legacyTeacherFeedback.latest_summary || {};
  const recordingCompliance = legacyTeacherFeedback.recording_compliance || {
    ready_to_record: Boolean(readiness.upload_ready),
    blockers: readiness.blockers || readiness.missing_items || [],
    next_step: missingItem,
  };
  const gradebook = data.gradebook_reminders || [];
  const searchResults = searchQuery.data?.results || [];
  // Personal lesson highlights and Gold-Star recognition are different
  // surfaces. We pull personal highlights from the artifact when allowed,
  // and keep the existing recognition.items list for Gold-Star recognition.
  const artifactHighlightItems = artifactAllowed
    ? artifactHighlights(artifactForReading).map((highlight) => ({
        id: highlight.id,
        title: highlight.title,
        description: highlight.body,
        href: highlight.video_href || "/my-lessons",
      }))
    : null;
  const legacyHighlights = data.highlights || [];
  const personalHighlights = artifactBlocked
    ? []
    : artifactHighlightItems !== null && artifactHighlightItems.length
      ? artifactHighlightItems
      : legacyHighlights;
  const goldStar = artifactGoldStar(artifactForReading);
  const recognitionItemsLegacy = data.recognition?.items || [];
  const recognitionItems = goldStar
    ? [
        {
          id: goldStar.id,
          title: goldStar.title,
          description: goldStar.body,
          href: "/my-badges",
        },
        ...recognitionItemsLegacy,
      ]
    : recognitionItemsLegacy;
  const reflections = data.reflections || [];
  const artifactActions = artifactAllowed ? artifactActionItems(artifactForReading) : [];
  // Hide legacy data.action_items when artifact is blocked so we don't show
  // stale/orphaned action cards.
  const legacyActionItems = artifactBlocked ? [] : data.action_items || [];
  const renderedActionItems = artifactActions.length
    ? artifactActions.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.try_next_lesson || item.body,
        href: item.video_href || `/my-coaching?task_id=${item.id || ""}`,
      }))
    : legacyActionItems;
  const nextBestActionLegacy =
    data.next_best_action &&
    (!missingItem || data.next_best_action.id !== missingItem.id) &&
    (!missingItem?.code || data.next_best_action.code !== missingItem.code)
      ? data.next_best_action
      : null;
  const nextBestAction = artifactNextBestAction(artifactForReading, nextBestActionLegacy);
  // PR C8: typed navigator drives the "Your next step" panel. When the
  // navigator is review_pending / admin_hidden / revision_requested /
  // no_action it does not produce a CTA and the panel renders status
  // copy instead of a clickable button.
  const navigator = artifactNavigator(artifactForReading);
  const navigatorClickable = isNavigatorClickable(navigator);
  const primaryArtifactAction = artifactActions[0];
  const primaryAction = artifactBlocked
    ? null
    : primaryArtifactAction
      ? {
          id: primaryArtifactAction.id,
          title: primaryArtifactAction.title || "Try one coaching move",
          description: primaryArtifactAction.try_next_lesson || primaryArtifactAction.body,
          body: primaryArtifactAction.body,
          try_next_lesson: primaryArtifactAction.try_next_lesson,
          video_href: primaryArtifactAction.video_href,
          cta_label: primaryArtifactAction.cta_label,
          moment_cta_label: primaryArtifactAction.moment_cta_label || artifactMomentCtaLabel(primaryArtifactAction),
          href: `/my-coaching?task_id=${primaryArtifactAction.id || ""}`,
        }
      : legacyActionItems[0] || nextBestAction;

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <PageContextHeader
          breadcrumbs={[{ label: "My Workspace", to: "/my-workspace" }]}
          title={`Welcome back${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`}
          description="Start with your next best action, then move between lessons, coaching, recognition, and reminders."
          badge="Teacher workspace"
          actions={
            data.demo_eligible ? (
              <Button type="button" variant="secondary" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
                {seedMutation.isPending ? "Filling..." : "Fill my demo workspace"}
              </Button>
            ) : null
          }
        />

        {dashboardQuery.isLoading ? <LoadingState message="Opening your workspace..." /> : null}
        {dashboardQuery.isError ? <ErrorState title="Your workspace could not be opened" message="Try again in a moment. Your lessons and coaching notes are still saved." /> : null}

        {!dashboardQuery.isLoading && !dashboardQuery.isError ? (
          <div className="space-y-6">
            <Panel className={`grid gap-4 ${missingItem ? "lg:grid-cols-[1.2fr,0.8fr]" : ""}`}>
              <div>
                <Field label="Search your workspace">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                    <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search lessons, moments, goals, reflections, recognition..." className="pl-9" />
                  </div>
                </Field>
                {query.trim().length > 1 ? (
                  <div className="mt-3 max-h-80 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
                    {searchQuery.isLoading ? <div className="text-sm text-slate-500">Searching...</div> : null}
                    {!searchQuery.isLoading && searchResults.length ? searchResults.map((result, index) => (
                      <Link key={`${result.type}-${index}`} to={result.href} className="block rounded-md bg-white p-3 text-sm hover:bg-slate-100">
                        <div className="font-semibold text-slate-900">{result.title}</div>
                        <div className="mt-1 text-slate-600">{result.snippet}</div>
                        <div className="mt-1 text-xs font-medium text-slate-500">{result.source_label}</div>
                      </Link>
                    )) : null}
                    {!searchQuery.isLoading && !searchResults.length ? <div className="text-sm text-slate-500">Try a lesson title, coaching goal, or recognition name.</div> : null}
                  </div>
                ) : null}
              </div>
              {missingItem ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Setup next step</div>
                  <div className="mt-2 font-semibold text-amber-950">{missingItem.label}</div>
                  <p className="mt-2 text-sm leading-6 text-amber-900">This helps your recordings, feedback, and privacy settings stay connected.</p>
                  <Link to={missingItem.href} className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-amber-950 underline">Continue</Link>
                </div>
              ) : null}
            </Panel>

            <Panel className="border-primary/20 bg-primary/5" data-testid="teacher-workspace-navigator-panel">
              {/* PR C8: typed navigator label replaces the generic "Your next step". */}
              <div
                className="text-xs font-semibold uppercase tracking-wide text-primary"
                data-testid="teacher-navigator-label"
              >
                {navigator?.label || (primaryAction ? "Coaching focus" : "All set")}
              </div>
              {primaryAction ? (
                <>
                  <h2 className="mt-2 text-xl font-semibold text-slate-950">{navigator?.title || primaryAction.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{primaryAction.description || primaryAction.try_next_lesson || primaryAction.body}</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {primaryAction.id ? (
                      <Button type="button" size="sm" onClick={() => markTriedMutation.mutate(primaryAction.id)} disabled={markTriedMutation.isPending}>
                        {markTriedMutation.isPending ? "Saving..." : "I tried this"}
                      </Button>
                    ) : null}
                    <Link to={`/my-coaching${primaryAction.id ? `?task_id=${primaryAction.id}` : ""}`} className="inline-flex min-h-[36px] items-center rounded-md border border-primary/30 px-3 py-2 text-sm font-semibold text-primary hover:bg-white">
                      {primaryAction.cta_label || "Open coaching action"}
                    </Link>
                    {primaryAction.video_href ? (
                      <Link to={primaryAction.video_href} className="inline-flex min-h-[36px] items-center text-sm font-semibold text-primary hover:text-primary/80">
                        {primaryAction.moment_cta_label || "Watch this coaching moment"}
                      </Link>
                    ) : null}
                  </div>
                </>
              ) : navigator ? (
                // Review-pending / no-action / setup_required / upload_required.
                // CTA is rendered only when the navigator is clickable.
                <>
                  <h2 className="mt-2 text-xl font-semibold text-slate-950" data-testid="teacher-navigator-title">{navigator.title}</h2>
                  {navigator.body ? <p className="mt-2 text-sm leading-6 text-slate-700">{navigator.body}</p> : null}
                  {navigatorClickable ? (
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Link
                        to={navigator.href}
                        data-testid="teacher-navigator-cta"
                        className="inline-flex min-h-[36px] items-center rounded-md border border-primary/30 px-3 py-2 text-sm font-semibold text-primary hover:bg-white"
                      >
                        {navigator.cta_label}
                      </Link>
                    </div>
                  ) : null}
                </>
              ) : (
                <EmptyState title="Your next coaching action will appear after a reviewed lesson." />
              )}
            </Panel>

            <div className="grid gap-6 lg:grid-cols-[1.15fr,0.85fr]">
              <Panel className="space-y-4">
                <SectionHeader title="Your latest coaching summary" description="A warm, plain-language look at what to carry into the next lesson." />
                {artifactBlocked ? (
                  <EmptyState
                    title={artifactForReading?.empty_state?.title || "This lesson’s feedback isn’t ready yet."}
                    message={artifactForReading?.empty_state?.message || "Once a complete review is ready, you’ll see specific coaching moments and next steps here."}
                  />
                ) : latestLesson && latestSummary ? (
                  <Link to={latestLesson.href || "/my-lessons"} className="block rounded-lg border border-slate-200 bg-slate-50 p-4 hover:bg-white">
                    <div className="font-semibold text-slate-900">{latestLesson.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{[latestLesson.subject, formatDate(latestLesson.uploaded_at)].filter(Boolean).join(" • ")}</div>
                    <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                      {latestSummary.opening ? <p>{latestSummary.opening}</p> : null}
                      {latestSummary.strength ? <p><span className="font-semibold text-slate-900">What worked: </span>{latestSummary.strength}</p> : null}
                      {latestSummary.growth_focus ? <p><span className="font-semibold text-slate-900">Growth focus: </span>{latestSummary.growth_focus}</p> : null}
                      {latestSummary.next_step ? <p><span className="font-semibold text-slate-900">Try next: </span>{latestSummary.next_step}</p> : null}
                      {!latestSummary.opening && !latestSummary.strength ? <p>{latestLesson.summary || "Open this recording when you are ready to revisit it."}</p> : null}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold text-primary">
                      <span>Watch lesson</span>
                      <span>Open full feedback</span>
                    </div>
                  </Link>
                ) : <EmptyState title="Your first lesson summary will appear here once a recording has been reviewed." message="You’ll get specific, helpful feedback about what happened in that lesson." />}
              </Panel>
              <Panel className="space-y-4">
                <SectionHeader title="Moments worth revisiting" description="Personal highlights from lesson feedback, separate from recognition." />
                <CardList items={personalHighlights} emptyTitle="Highlights will appear as your reviewed lessons build up." />
              </Panel>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Panel className="space-y-4">
                <SectionHeader title="Gold-Star recognition" description="Recognition is separate from personal lesson highlights — personal highlights show automatically; Gold-Star is awarded." />
                <CardList items={recognitionItems.map((item) => ({ id: item.id, title: item.title, description: item.description, href: "/my-badges" }))} emptyTitle="Gold-Star and badge recognition will appear here when awarded." />
              </Panel>
              <Panel className="space-y-4">
                <SectionHeader title="Your reflections" description="Your notes stay private unless you choose to share them." />
                {reflections.length ? (
                  <div className="grid gap-3">
                    {reflections.slice(0, 4).map((reflection) => (
                      <div key={reflection.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-semibold text-slate-900">{reflection.tried || "Reflection"}</div>
                          <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600">{reflection.visibility === "shared_with_admin" ? "Shared with admin" : "Private"}</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{reflection.happened || reflection.text || reflection.body}</p>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState title="Your reflections will appear here after you save one." />}
              </Panel>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Panel className="space-y-4">
                <SectionHeader title="Action items" description="Goals, reflections, reminders, and meeting prep in one place." />
                <CardList items={renderedActionItems} emptyTitle="Action items will appear after your first reviewed lesson." />
              </Panel>
              <Panel className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionHeader title="Growth over time" description="Friendly patterns from your reviewed lessons and reflections." />
                  <select value={period} onChange={(event) => setPeriod(event.target.value)} className="min-h-[44px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                    <option value="month">Month</option>
                    <option value="quarter">Quarter</option>
                    <option value="semester">Semester</option>
                    <option value="year">Year</option>
                  </select>
                </div>
                <CardList items={(legacyTeacherFeedback.growth_over_time?.available ? legacyTeacherFeedback.growth_over_time.items : data.trends || []).map((trend) => ({ ...trend, description: trend.body || trend.description, href: "/my-coaching" }))} emptyTitle={legacyTeacherFeedback.growth_over_time?.empty_state || "Trends will appear after a few reviewed lessons."} />
              </Panel>
            </div>

            <Panel className="space-y-4">
              <SectionHeader title="Recording readiness" description="A compact check of what needs to be complete before recording or upload." />
              {recordingCompliance.ready_to_record ? (
                <p className="text-sm leading-6 text-emerald-700">You are ready to record or upload a classroom lesson.</p>
              ) : (
                <div className="space-y-3">
                  {(recordingCompliance.blockers || []).slice(0, 3).map((blocker) => (
                    <Link key={blocker.code || blocker.id || blocker.label} to={readinessLink(blocker)} className="block rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950 hover:bg-amber-100">
                      {blocker.message || blocker.label || "Finish this setup step"}
                    </Link>
                  ))}
                </div>
              )}
            </Panel>

            <div className="grid gap-6 lg:grid-cols-2">
              <Panel className="space-y-4">
                <SectionHeader title="Schedule and coaching conversations" description="Upcoming observations, meetings, and recording reminders." />
                <CardList items={(data.schedule || []).map((item) => ({ ...item, description: formatDate(item.scheduled_at) }))} emptyTitle="Upcoming coaching conversations will appear here." />
              </Panel>
              <Panel className="space-y-4">
                <SectionHeader title="Gradebook reminders" description="Demo-ready reminders for future gradebook sync." />
                {gradebook.length ? gradebook.map((item) => (
                  <Link key={item.id} to={item.href || "/my-workspace"} className="block rounded-lg border border-slate-200 bg-slate-50 p-4 hover:bg-white">
                    <div className="font-semibold text-slate-900">{item.title}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{item.description}</p>
                    <p className="mt-2 text-xs font-semibold text-slate-500">Demo reminder — LMS sync is not connected yet.</p>
                  </Link>
                )) : <EmptyState title="Gradebook reminders will appear here for demo workspaces." />}
              </Panel>
            </div>

            <Panel className="space-y-4">
              <SectionHeader title="Reports" description="Teacher-facing snapshots and progress notes." />
              <CardList items={data.reports || []} emptyTitle="Progress reports will appear after reviewed lessons." />
            </Panel>
          </div>
        ) : null}
      </div>
    </LayoutShell>
  );
}

export default TeacherWorkspacePage;
