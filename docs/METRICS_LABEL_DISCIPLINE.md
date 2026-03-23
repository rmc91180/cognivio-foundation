# Metrics Label Discipline

This guide exists to protect Cognivio from a common monitoring failure mode:
high-cardinality labels that make metrics expensive, noisy, and hard to query.

## Rule of Thumb

A metric label should describe a small bounded category, not a specific record.

Good labels:
- `analysis_mode`
- `language`
- `status`
- `job_type`
- `dependency`
- `model`

Bad labels:
- `video_id`
- `teacher_id`
- `teacher_name`
- `email`
- `school_name`
- `filename`
- `error_message`
- free-form rubric text

## Why This Matters

High-cardinality labels:
- increase storage cost
- slow down dashboards
- make alerts unreliable
- can leak sensitive information into monitoring systems

## Cognivio-Specific Guidance

### Never label by entity identity

Do not use labels for:
- specific teachers
- specific users
- specific videos
- specific schools

Those belong in logs, not metrics.

### Use logs for detailed diagnostics

If you need to know:
- which video failed
- which teacher was affected
- which exact OpenAI error happened

Use:
- structured logs
- admin debug endpoints
- database inspection

Do not put those values into Prometheus labels.

### Normalize labels before emission

All emitted labels should be normalized into small vocabularies.

Examples:
- `he`, `en`, `unknown`
- `openai`, `openai_multimodal`, `fallback`
- `success`, `failure`, `processing`, `queued`

## Review Checklist For New Metrics

Before adding a metric, ask:

1. Is the label set bounded?
2. Could any label value grow with customer count?
3. Could any label expose sensitive user or school data?
4. Could the same question be answered with logs instead?

If any answer is risky, do not add the label.

## Current Approved Label Families

See:
- [METRICS_CONTRACT.md](C:/Projects/Cognivio/docs/METRICS_CONTRACT.md)

That file is the source of truth for approved metric names and label values.
