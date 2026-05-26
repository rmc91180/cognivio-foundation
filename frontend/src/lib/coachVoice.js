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
  "the teacher showed",
  "coach d",
];

export const findBannedCoachVoicePhrases = (text = "") => {
  const lowered = String(text).toLowerCase();
  return BANNED_COACH_VOICE_PHRASES.filter((phrase) => lowered.includes(phrase));
};
