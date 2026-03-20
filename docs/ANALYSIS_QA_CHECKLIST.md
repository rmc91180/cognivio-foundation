# Analysis QA Checklist

## Pre-checks
- Video privacy completed successfully
- Analysis completed successfully
- Sampling manifest exists
- Moment manifest exists
- If audio is enabled, transcript and audio features exist or have a documented fallback reason

## Review Questions
- Does the summary clearly match the lesson shown?
- Do timestamps correspond to plausible moments in the lesson?
- Are the recommendations concrete rather than generic?
- Are at least two distinct lesson phases reflected in the output?
- If audio is absent, does the system avoid unsupported discourse claims?
- If audio is present, do transcript excerpts support the recommendations?
- Does the confidence/degradation metadata accurately reflect what was available?

## Fail Conditions
- Hallucinated classroom actions not supported by evidence
- Generic output repeated across materially different lessons
- Recommendations disconnected from timestamps or evidence
- Audio-derived claims when transcript is missing
