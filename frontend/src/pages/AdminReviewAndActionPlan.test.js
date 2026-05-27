/**
 * PR C6 frontend tests for the artifact helpers used by the
 * VideoPlayerPage teacher view and the admin review workflow.
 *
 * The full VideoPlayerPage is too heavy to mount under jsdom (12+
 * useQuery calls, i18n, multiple chart components). Instead we exercise
 * the helper module + a tiny in-test component that follows the same
 * conditional rendering as the page. That keeps the tests fast and
 * targeted at the C6 invariants:
 *
 *   1. When the artifact is allowed, action items are rendered.
 *   2. When the artifact is blocked, the action-items card is hidden
 *      and the empty-state banner appears.
 *   3. The "Watch the moment" link only appears when video_href exists.
 *   4. No banned strings are rendered for either fixture.
 */

import React from "react";
import { render, screen } from "@testing-library/react";

import {
  artifactActionItems,
  artifactDeepDive,
  artifactLatestSummary,
  isArtifactAllowed,
  isArtifactBlocked,
  readArtifact,
} from "@/lib/teacherCoachingArtifact";
import { scanForBannedPhrases } from "@/lib/coachVoice";

const ALLOWED_ARTIFACT = {
  artifact_version: "teacher_lesson_coaching_artifact_v1",
  teacher_feedback_allowed: true,
  blocked_reason: null,
  lesson: { assessment_id: "a-good", video_id: "v-good" },
  summary: {
    opening: "You opened with a clear question.",
    what_worked: "You waited for a second voice.",
    growth_focus: "Try inviting a peer to build on the answer.",
    next_step: "After one student answers, pause and ask 'Who can build on that?'",
  },
  highlights: [],
  action_items: [
    {
      id: "act-1",
      title: "Try one quick partner check",
      body: "After one student answers, pause and ask 'Who can build on that?'",
      try_next_lesson: "After one student answers, pause and ask 'Who can build on that?'",
      why_it_matters: "Keeps the next practice move small.",
      video_href: "/videos/v-good?t=120",
      reflection_prompt: "Who joined the conversation differently?",
    },
    {
      id: "act-2",
      title: "Pause five quiet seconds",
      body: "Give students five seconds to think before rephrasing.",
      try_next_lesson: "Give students five seconds to think before rephrasing.",
      why_it_matters: "Pauses surface quieter students.",
      // No video_href — Watch link must NOT appear.
      reflection_prompt: "Who answered after the pause?",
    },
  ],
  deep_dive: {
    available: true,
    moments: [
      {
        id: "m-1",
        start_sec: 120,
        end_sec: 150,
        what_happened: "You waited after the prompt.",
        why_it_matters: "Choose what to repeat next lesson.",
        video_href: "/videos/v-good?t=120",
      },
    ],
    empty_state: null,
  },
  recognition: { gold_star: null, personal_highlights: [] },
  reflection: { private_by_default: true, prompts: ["Who joined the conversation differently?"] },
  next_best_action: null,
  empty_state: null,
  language: "en",
  guardrails: { teacher_visible: true, rubric_removed: true, scores_removed: true, evidence_grounded: true },
};

const BLOCKED_ARTIFACT = {
  artifact_version: "teacher_lesson_coaching_artifact_v1",
  teacher_feedback_allowed: false,
  blocked_reason: "admin_hidden",
  lesson: { assessment_id: "a-bad", video_id: "v-bad", status: "review_blocked" },
  summary: { opening: null, what_worked: null, growth_focus: null, next_step: null },
  highlights: [],
  action_items: [
    {
      id: "stale-act",
      title: "Plan a targeted coaching cycle",
      body: "coach d1b after 5.3 evidence",
    },
  ],
  deep_dive: { available: false, moments: [], empty_state: "Come back after the review is complete." },
  recognition: { gold_star: null, personal_highlights: [] },
  reflection: { private_by_default: true, prompts: [] },
  next_best_action: null,
  empty_state: {
    code: "admin_review_pending",
    title: "A coach is still reviewing this lesson.",
    message: "Come back here once the review is complete.",
  },
  language: "en",
  guardrails: { teacher_visible: false, rubric_removed: true, scores_removed: true, evidence_grounded: false },
};

/** A miniature version of the VideoPlayerPage teacher artifact card.
 *
 *  Mirrors the conditional rendering in VideoPlayerPage.js but without
 *  the surrounding heavy components. Any change to the page's rendering
 *  rule should also be reflected here.
 */
function TeacherArtifactPanel({ assessmentResponse }) {
  const artifact = readArtifact(assessmentResponse);
  const allowed = isArtifactAllowed(artifact);
  const blocked = isArtifactBlocked(artifact);
  const actionItems = allowed ? artifactActionItems(artifact) : [];
  const deep = artifactDeepDive(artifact);
  const summary = artifactLatestSummary(artifact);

  return (
    <div>
      {blocked ? (
        <div data-testid="teacher-artifact-blocked-state">
          {artifact?.empty_state?.title ? <div>{artifact.empty_state.title}</div> : null}
          <div>{artifact?.empty_state?.message || "This lesson's feedback isn't ready yet."}</div>
        </div>
      ) : null}
      {allowed ? (
        <div data-testid="teacher-artifact-summary">
          {summary?.opening ? <p>{summary.opening}</p> : null}
          {summary?.next_step ? <p>{summary.next_step}</p> : null}
        </div>
      ) : null}
      {allowed && actionItems.length ? (
        <ul data-testid="teacher-artifact-action-items">
          {actionItems.map((item) => (
            <li key={item.id}>
              <div>{item.title}</div>
              <div>{item.try_next_lesson || item.body}</div>
              {item.why_it_matters ? <div>{item.why_it_matters}</div> : null}
              {item.reflection_prompt ? <div>{item.reflection_prompt}</div> : null}
              {item.video_href ? <a href={item.video_href}>Watch the moment</a> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {allowed && deep.available && deep.moments.length ? (
        <ul data-testid="teacher-artifact-deep-dive">
          {deep.moments.map((moment) => (
            <li key={moment.id}>
              <span>{moment.what_happened}</span>
              {moment.video_href ? <a href={moment.video_href}>Watch the moment</a> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

describe("PR C6 teacher artifact rendering", () => {
  it("renders artifact action items + deep-dive when artifact allowed", () => {
    render(<TeacherArtifactPanel assessmentResponse={{ coaching_artifact: ALLOWED_ARTIFACT }} />);
    expect(screen.getByTestId("teacher-artifact-action-items")).toBeInTheDocument();
    expect(screen.getByTestId("teacher-artifact-deep-dive")).toBeInTheDocument();
    expect(screen.queryByTestId("teacher-artifact-blocked-state")).not.toBeInTheDocument();
    expect(screen.getByText(/Try one quick partner check/i)).toBeInTheDocument();
    expect(screen.getByText(/Keeps the next practice move small\./i)).toBeInTheDocument();
    expect(scanForBannedPhrases(document.body.textContent)).toEqual([]);
  });

  it("hides Watch-the-moment link on action items without video_href", () => {
    render(<TeacherArtifactPanel assessmentResponse={{ coaching_artifact: ALLOWED_ARTIFACT }} />);
    const watchLinks = screen.queryAllByText("Watch the moment");
    // Allowed artifact has 2 action items but only 1 with a video_href.
    // The deep-dive moment also exposes one Watch link.
    expect(watchLinks.length).toBe(2);
  });

  it("renders the blocked-state empty banner when artifact is blocked", () => {
    render(<TeacherArtifactPanel assessmentResponse={{ coaching_artifact: BLOCKED_ARTIFACT }} />);
    expect(screen.getByTestId("teacher-artifact-blocked-state")).toBeInTheDocument();
    expect(screen.queryByTestId("teacher-artifact-action-items")).not.toBeInTheDocument();
    expect(screen.queryByTestId("teacher-artifact-deep-dive")).not.toBeInTheDocument();
    // No legacy stale strings should leak. The blocked artifact's stale
    // action_items entry contains the bad string but is never rendered.
    expect(scanForBannedPhrases(document.body.textContent)).toEqual([]);
  });

  it("legacy fallback path stays empty when no coaching_artifact key is present", () => {
    render(<TeacherArtifactPanel assessmentResponse={{ teacher_feedback: {} }} />);
    expect(screen.queryByTestId("teacher-artifact-action-items")).not.toBeInTheDocument();
    expect(screen.queryByTestId("teacher-artifact-blocked-state")).not.toBeInTheDocument();
  });
});
