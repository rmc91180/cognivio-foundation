/**
 * PR C5: teacher-side accessor for the canonical TeacherLessonCoachingArtifact.
 *
 * The C4 backend now returns `coaching_artifact` on every teacher endpoint.
 * Pages should read from the artifact whenever it is present and
 * `teacher_feedback_allowed === true`. When the artifact is present and
 * blocked, the page must NOT fall back to the legacy `teacher_feedback`
 * fields — the block is the truth. Legacy fallback is only allowed when the
 * artifact key is entirely absent (older endpoint responses).
 *
 * These helpers centralize that fallback logic so every page applies the
 * same rule.
 */

/** Return the artifact attached to a backend payload, or null. */
export const readArtifact = (payload) => {
  if (!payload || typeof payload !== "object") return null;
  if (payload.coaching_artifact && typeof payload.coaching_artifact === "object") {
    return payload.coaching_artifact;
  }
  // Some payloads (latest-lesson, lesson row) nest the artifact under `lesson`.
  if (payload.lesson?.coaching_artifact && typeof payload.lesson.coaching_artifact === "object") {
    return payload.lesson.coaching_artifact;
  }
  // Latest-lesson "blocked" envelope: { lesson: null, artifact: <blocked> }
  if (payload.artifact && typeof payload.artifact === "object") {
    return payload.artifact;
  }
  return null;
};

/**
 * True when the artifact is present AND explicitly blocks teacher feedback.
 * Pages must hide content but may show the empty_state when this is true.
 */
export const isArtifactBlocked = (artifact) => {
  if (!artifact) return false;
  return artifact.teacher_feedback_allowed === false;
};

/**
 * True when the artifact is present AND allows teacher feedback.
 */
export const isArtifactAllowed = (artifact) => {
  if (!artifact) return false;
  return artifact.teacher_feedback_allowed === true;
};

/**
 * Pick a value from the artifact when allowed; otherwise fall back to the
 * legacy value — but ONLY if the artifact is absent. A blocked artifact
 * always wins over legacy.
 */
export const pickFromArtifact = (artifact, getter, legacy) => {
  if (artifact === null || artifact === undefined) return legacy;
  if (isArtifactBlocked(artifact)) return undefined;
  const value = typeof getter === "function" ? getter(artifact) : artifact?.[getter];
  return value === undefined || value === null ? legacy : value;
};

/** Latest-lesson summary (string) safe for teacher rendering. */
export const artifactSummaryText = (artifact) => {
  if (!artifact || isArtifactBlocked(artifact)) return "";
  const summary = artifact.summary || {};
  return [summary.opening, summary.what_worked, summary.growth_focus, summary.next_step]
    .filter(Boolean)
    .join(" ")
    .trim();
};

/** Latest-summary fields keyed by legacy names so existing pages keep working. */
export const artifactLatestSummary = (artifact) => {
  if (!artifact || isArtifactBlocked(artifact)) return null;
  const summary = artifact.summary || {};
  return {
    opening: summary.opening || "",
    strength: summary.what_worked || "",
    growth_focus: summary.growth_focus || "",
    next_step: summary.next_step || "",
  };
};

/** Action items array, capped, teacher-safe. */
export const artifactActionItems = (artifact) => {
  if (!artifact || isArtifactBlocked(artifact)) return [];
  return Array.isArray(artifact.action_items) ? artifact.action_items : [];
};

/** Highlights (personal moments, never Gold-Star). */
export const artifactHighlights = (artifact) => {
  if (!artifact || isArtifactBlocked(artifact)) return [];
  return Array.isArray(artifact.highlights) ? artifact.highlights : [];
};

/** Gold-Star recognition (null if none earned). */
export const artifactGoldStar = (artifact) => {
  if (!artifact || isArtifactBlocked(artifact)) return null;
  return artifact.recognition?.gold_star || null;
};

/** Deep-dive moments + availability flag + honest empty-state copy. */
export const artifactDeepDive = (artifact) => {
  if (!artifact) return { available: false, moments: [], empty_state: "" };
  if (isArtifactBlocked(artifact)) {
    return {
      available: false,
      moments: [],
      empty_state: artifact.empty_state?.message || "",
    };
  }
  const deep = artifact.deep_dive || {};
  return {
    available: Boolean(deep.available),
    moments: Array.isArray(deep.moments) ? deep.moments : [],
    empty_state: deep.empty_state || "",
  };
};

/** Reflection prompts (strings). */
export const artifactReflectionPrompts = (artifact) => {
  if (!artifact || isArtifactBlocked(artifact)) return [];
  const prompts = artifact.reflection?.prompts;
  return Array.isArray(prompts) ? prompts.filter(Boolean) : [];
};

/** Next-best-action (honest empty state when blocked, action when allowed). */
export const artifactNextBestAction = (artifact, legacy) => {
  if (!artifact) return legacy || null;
  if (isArtifactBlocked(artifact)) {
    const es = artifact.empty_state;
    return es
      ? {
          id: es.code || "review_pending",
          title: es.title,
          description: es.message,
          href: "/record",
          cta_label: "Record or upload a lesson",
        }
      : null;
  }
  return artifact.next_best_action || legacy || null;
};

/** Empty-state copy when the artifact is blocked. */
export const artifactEmptyState = (artifact) => {
  if (!artifact || !isArtifactBlocked(artifact)) return null;
  return artifact.empty_state || null;
};

/** Status string for lesson cards / status pills. */
export const artifactLessonStatus = (artifact, legacyStatus) => {
  if (!artifact) return legacyStatus;
  if (isArtifactBlocked(artifact)) {
    // Demote: a blocked artifact MUST NOT be rendered as a reviewed lesson.
    return legacyStatus === "reviewed" ? "processing" : legacyStatus;
  }
  return legacyStatus;
};
