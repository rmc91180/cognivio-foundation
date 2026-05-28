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

/**
 * PR C8: Next-best-action prefers the backend navigator. Review-pending /
 * no-action navigators have ``disabled: true`` and no href — in that case
 * we return ``null`` so pages render the status copy instead of a
 * clickable "Open next step" button.
 *
 * Legacy fallback only applies when the artifact key is absent.
 */
export const artifactNextBestAction = (artifact, legacy) => {
  if (!artifact) return legacy || null;
  if (isArtifactBlocked(artifact)) {
    const nav = artifact.navigator;
    if (nav && nav.href && nav.cta_label && !nav.disabled) {
      return {
        id: nav.action_item_id || nav.type,
        title: nav.title,
        description: nav.body,
        href: nav.href,
        cta_label: nav.cta_label,
        type: nav.type,
        label: nav.label,
        reason: nav.reason,
      };
    }
    // PR C8: blocked artifact with no navigator CTA -> no clickable
    // action. Pages render the empty_state copy directly instead.
    return null;
  }
  // Allowed artifact: prefer the backend-derived next_best_action (which
  // is now built from the navigator), fall back to the artifact's
  // navigator, then the legacy field.
  if (artifact.next_best_action) return artifact.next_best_action;
  const nav = artifact.navigator;
  if (nav && nav.href && nav.cta_label && !nav.disabled) {
    return {
      id: nav.action_item_id || nav.type,
      title: nav.title,
      description: nav.body,
      href: nav.href,
      cta_label: nav.cta_label,
      type: nav.type,
      label: nav.label,
      reason: nav.reason,
    };
  }
  return legacy || null;
};

/** PR C8: typed navigator accessor. */
export const artifactNavigator = (artifact) => {
  if (!artifact || typeof artifact !== "object") return null;
  return artifact.navigator || null;
};

/** True iff the navigator currently carries a clickable CTA. */
export const isNavigatorClickable = (navigator) => {
  if (!navigator || typeof navigator !== "object") return false;
  if (navigator.disabled) return false;
  return Boolean(navigator.cta_label && navigator.href);
};

/**
 * Derive a specific moment CTA label for a moment or action item. Mirrors
 * the backend ``specific_moment_cta_label`` so the frontend can use it for
 * legacy (artifact-less) moment cards that still carry phase/title.
 */
export const artifactMomentCtaLabel = (momentOrAction, { language } = {}) => {
  const isHe = String(language || "en").toLowerCase().startsWith("he");
  if (!momentOrAction || typeof momentOrAction !== "object") {
    return isHe ? "צפו ברגע הזה" : "Watch this coaching moment";
  }
  if (momentOrAction.moment_cta_label) return momentOrAction.moment_cta_label;
  if (momentOrAction.moment_label) return momentOrAction.moment_label;
  const text = [
    momentOrAction.title,
    momentOrAction.what_happened,
    momentOrAction.body,
    momentOrAction.description,
    momentOrAction.try_next_lesson,
    momentOrAction.summary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const KEYWORDS = isHe
    ? [
        [/(שאלה|שאל )/, "צפו בחילופי השאלה"],
        [/(תשובה|הסביר|extend)/, "צפו ברגע התגובה של התלמידים"],
        [/(בדיקת הבנה|check)/, "צפו ברגע הבדיקה להבנה"],
        [/(מעבר|transition)/, "צפו ברגע המעבר"],
        [/(מרחב|סידור|space|room)/, "צפו ברגע סידור החלל"],
      ]
    : [
        [/(question|prompt|asked)/, "Watch the question exchange"],
        [/(student response|student answer|extended)/, "Watch the student-response moment"],
        [/(check for understanding|restate|in your own words)/, "Watch the check-for-understanding moment"],
        [/(transition|move to|next activity)/, "Watch the transition moment"],
        [/(room|space|setup|circulate)/, "Watch the room-setup moment"],
      ];
  for (const [pattern, label] of KEYWORDS) {
    if (pattern.test(text)) return label;
  }
  const PHASE = isHe
    ? {
        check_for_understanding: "צפו ברגע הבדיקה להבנה",
        guided_practice: "צפו ברגע התרגול המודרך",
        modeling: "צפו ברגע ההדגמה",
        student_work: "צפו ברגע עבודת התלמידים",
        discussion: "צפו ברגע הדיון",
        transition: "צפו במעבר",
        lesson_launch: "צפו בפתיחת השיעור",
        closure: "צפו בסיכום השיעור",
      }
    : {
        check_for_understanding: "Watch the check-for-understanding moment",
        guided_practice: "Watch the guided practice moment",
        modeling: "Watch the modeling moment",
        student_work: "Watch the student work moment",
        discussion: "Watch the discussion moment",
        transition: "Watch the transition moment",
        lesson_launch: "Watch the lesson opening",
        closure: "Watch the lesson closure",
      };
  const phase = (momentOrAction.phase || "").toLowerCase();
  if (phase && PHASE[phase]) return PHASE[phase];
  return isHe ? "צפו ברגע הזה" : "Watch this coaching moment";
};

/** Primary action item with C8 taxonomy (category/action_kind/cta_label/href/disabled). */
export const artifactPrimaryAction = (artifact) => {
  if (!artifact || isArtifactBlocked(artifact)) return null;
  const items = artifactActionItems(artifact);
  return items[0] || null;
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
