# Dashboard V2

## Summary

Dashboard V2 adds:

- Leadership Insights (AI-generated with deterministic fallback).
- Domain trend line chart (monthly buckets).
- Single-teacher compare mode against all teachers.
- Subject filtering.
- Feature flag rollout control for frontend UI.

## Feature Flag

Frontend flag in `frontend/.env.example`:

```env
REACT_APP_DASHBOARD_V2=true
```

- `true` (default): show Dashboard V2 sections.
- `false`: fall back to legacy "School focus areas" + "Key achievements".

## New API Endpoints

### `GET /api/dashboard/domain-trends`

Query params:

- `window_months` (int, default `3`, range `1..12`)
- `teacher_id` (optional)
- `subjects` (optional CSV: `Math,Science`)
- `framework_type` (optional: `danielson|marshall|custom`)

Response includes:

- `domains`: list of plotted domains
- `periods`: monthly buckets with:
- `all_teachers.overall_score`
- `all_teachers.domain_scores`
- `selected_teacher.overall_score` (when teacher selected)
- `selected_teacher.domain_scores` (when teacher selected)
- `teacher_attention_candidates` for downstream insight generation

### `GET /api/dashboard/leadership-insights`

Query params are the same as `domain-trends`.

Response includes:

- `generated_by`: `ai` or `rules`
- `bullets`: exactly 3 leadership bullets
- `positive_trends`
- `negative_trends`
- `teachers_needing_attention`
- `meta` (applied filters)
- `cache.hit` metadata

## AI Insight Caching

Cache key dimensions:

- `user_id`
- `window_months`
- `teacher_id`
- normalized+sorted `subjects`
- `framework_type`

Collection:

- `dashboard_leadership_insights_cache`

TTL:

- controlled by `LEADERSHIP_INSIGHTS_CACHE_TTL_SECONDS` (default `1800`).
- set to `0` to disable caching.

## QA Checklist (Manual/UAT)

1. Toggle `REACT_APP_DASHBOARD_V2=false` and verify legacy sections render.
2. Toggle `REACT_APP_DASHBOARD_V2=true` and verify Leadership Insights + Domain Trends render.
3. Select a teacher and confirm chart shows selected-teacher lines and all-teacher comparison lines.
4. Apply subject filters and verify insights + chart update.
5. Call `GET /api/dashboard/leadership-insights` twice with same params; second response should report `cache.hit=true`.
6. Confirm no regressions in Reports, Focus Domains, Compliance, and Gradebook sections.
