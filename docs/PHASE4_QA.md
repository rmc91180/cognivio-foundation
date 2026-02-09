# Phase 4 — QA & Demo Readiness

## Smoke Test Checklist
1. Curriculum upload works
2. Lesson plan upload works
3. Adherence data appears
4. Domain evidence expansion works
5. Admin override adjusts score
6. Export report works
7. Demo data update (seed)

## Quick Checks
1. Seed demo data:
```bash
curl -X POST "$BACKEND_URL/api/seed-demo-data" \
  -H "Authorization: Bearer $TOKEN"
```

2. Smoke status endpoint:
```bash
curl "$BACKEND_URL/api/qa/smoke" \
  -H "Authorization: Bearer $TOKEN"
```

3. Export report:
```bash
curl -X POST "$BACKEND_URL/api/reports/export" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "format=pdf" \
  -o summary-report.pdf
```

## Demo Seed Expectations
- Curriculum upload records exist for each demo teacher.
- Lesson plan upload records exist and are tied to dates.
- Evidence segments are populated for demo assessments.
- Adherence scores are generated for each demo assessment.
