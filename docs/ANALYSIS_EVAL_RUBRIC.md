# Analysis Evaluation Rubric

## Purpose
This rubric is used to compare baseline analysis, smart visual sampling, and multimodal analysis outputs.

## Dimensions
- Specificity: Does the feedback clearly reflect this lesson rather than generic teaching advice?
- Evidence grounding: Are timestamps, visual cues, and transcript cues used credibly?
- Usefulness: Would a teacher or coach know what to do next?
- Coverage: Does the analysis reflect different phases of the lesson?
- Modality discipline: Does the output avoid claiming audio-derived insight when audio is absent?
- Coach voice: Does teacher-facing feedback sound like a trusted coaching colleague instead of a scoring engine?

## Coach Voice

Coach voice scores 0.0 to 1.0 in the quality gate. Strong feedback:

- addresses the teacher directly as "you" and "your"
- names visible lesson moments and instructional moves
- starts with what worked before naming what to develop
- gives a next step that can be tried in the next lesson
- avoids rubric codes, numeric scoring language, and system phrases

Banned phrases lower the coach voice score before any other judgment:

- evidence was limited
- in the sampled frames
- analysis mode
- confidence score
- the teacher demonstrated
- the teacher used
- rubric element
- score of
- rated at
- data suggests
- based on the evidence
- this segment
- sampled moment
- no summary data available
- no data available

Good: "You gave students a clear model before they started. Next lesson, try one quick check for understanding before releasing the group."

Bad: "The teacher demonstrated rubric element 3c and received a score of 6.2 based on the evidence."

## Reviewer Scale
- 1 = weak
- 3 = acceptable
- 5 = strong

## Phase 1 Harness
- Gold set file: `backend/evals/analysis_gold_set.json`
- Quality gate runner: `python backend/scripts/run_quality_gate.py`
- Legacy runner: `python scripts/run-analysis-eval.py`
- JSON output: `python scripts/run-analysis-eval.py --json`

This Phase 1 harness is intentionally small and deterministic. It checks whether summary text, recommendation text, and packet-level confidence/alignment outputs continue to:
- reflect the configured observation focus
- stay grounded in visible evidence
- produce actionable coaching language
- avoid unsupported modality claims when audio is absent
- meet the coach voice threshold for teacher-visible text

## How To Use It
1. Run the harness before changing analysis prompts, ranking logic, or coaching packet generation.
2. Run it again after the change.
3. Review any failed dimensions before rollout.
4. If the product behavior should intentionally change, update the gold set expectations in `backend/evals/analysis_gold_set.json` and note why in the PR.

## Gold Set Notes
- Cases are stored as stable fixtures, not live recordings.
- Each case defines checks by rubric dimension.
- A dimension scores `5` when all checks pass, `3` when at least half pass, and `1` otherwise.
- Phase 1 uses this as an internal regression harness, not as a substitute for human coaching review.

## Required Notes
- Most convincing evidence snippet
- Least convincing claim
- Any obvious hallucination or unsupported inference
- Whether the output feels more useful than the previous pipeline
