export const BANNED_COACH_VOICE_PHRASES = [
  "evidence was limited",
  "in the sampled frames",
  "analysis mode",
  "confidence score",
  "the teacher demonstrated",
  "the teacher used",
  "rubric element",
  "score of",
  "rated at",
  "data suggests",
  "based on the evidence",
  "this segment",
  "sampled moment",
  "no summary data available",
  "no data available",
  "overall performance",
  "sampled frames",
  "rubric",
  "confidence",
  "proficient",
  "developing",
  "distinguished",
  "weighted average",
  "the teacher showed",
  "coach d",
  // PR C2/C4 production bad-string corpus
  "try this next lesson: rafi:",
  "rafi:",
  "after moment",
  "after 5.6 evidence",
  "based on the observed moment",
  "plan a targeted coaching cycle",
  "the clip gave us a brief window into your lesson",
  "brief window into your lesson",
  "demonstrating knowledge of students",
  "demonstrating knowledge of content and pedagogy",
  "creating an environment of respect and rapport",
  "using questioning and discussion techniques",
  "organizing physical space",
  "setting instructional outcomes",
  "establishing a culture for learning",
  "growing and developing professionally",
];

export const findBannedCoachVoicePhrases = (text = "") => {
  const lowered = String(text).toLowerCase();
  return BANNED_COACH_VOICE_PHRASES.filter((phrase) => lowered.includes(phrase));
};

/**
 * Recursive defense-in-depth scan for known bad strings inside a payload
 * (object, array, or string). Returns the list of bad phrases found. The
 * backend remains the primary guard; this is purely a frontend safety net.
 */
export const scanForBannedPhrases = (value) => {
  const hits = new Set();
  const visit = (item) => {
    if (item == null) return;
    if (typeof item === "string") {
      for (const phrase of findBannedCoachVoicePhrases(item)) hits.add(phrase);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (typeof item === "object") {
      Object.values(item).forEach(visit);
    }
  };
  visit(value);
  return [...hits];
};
