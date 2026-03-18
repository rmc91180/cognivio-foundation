# Cognivio

This repository currently contains multiple app stacks.  
For MVP delivery, the canonical production stack is:

- Frontend: `frontend/` (React + CRA)
- Backend: `backend/` (FastAPI)

Legacy stacks remain in-repo but are not the primary MVP target:

- `client/` + `server/`
- `admin-teacher-assessment/`

See the baseline lock and program plan:

- [Week 0 Baseline](./docs/WEEK0_BASELINE.md)
- [MVP Delivery Plan](./docs/MVP_DELIVERY_PLAN.md)
- [Brand Identity v1](./docs/BRAND_IDENTITY_V1.md)
- [Week 2 Design System](./docs/WEEK2_DESIGN_SYSTEM.md)
- [Week 3 Dashboard + Teachers UX](./docs/WEEK3_DASHBOARD_TEACHERS_UX.md)
- [Week 4 Videos + School Setup UX](./docs/WEEK4_VIDEOS_SCHOOL_SETUP_UX.md)
- [Week 5 Video Pipeline Foundation](./docs/WEEK5_VIDEO_PIPELINE_FOUNDATION.md)
- [Week 6 Processing + Playback Reliability](./docs/WEEK6_PROCESSING_PLAYBACK_RELIABILITY.md)
- [Week 7 MVP Integration Pass](./docs/WEEK7_MVP_INTEGRATION_PASS.md)
- [Week 8 QA, Security, and Performance](./docs/WEEK8_QA_SECURITY_PERFORMANCE.md)
- [Week 9 Pilot Readiness](./docs/WEEK9_PILOT_READINESS.md)
- [Week 10 Launch + Stabilization](./docs/WEEK10_LAUNCH_STABILIZATION.md)
- [Pilot UAT Checklist](./docs/PILOT_UAT_CHECKLIST.md)
- [Pilot Privacy Validation Pack](./docs/PILOT_PRIVACY_VALIDATION_PACK.md)
- [Privacy Go-Live Checklist](./docs/PRIVACY_GO_LIVE_CHECKLIST.md)
- [Production Phase Checklist](./docs/PRODUCTION_PHASE_CHECKLIST.md)
- [Staging Validation Report (2026-03-18)](./docs/STAGING_VALIDATION_REPORT_2026-03-18.md)
- [Recognition / Library Staging Validation Report (2026-03-18)](./docs/STAGING_VALIDATION_RECOGNITION_LIBRARY_2026-03-18.md)
- [Deployment + Rollback Runbook](./docs/DEPLOYMENT_ROLLBACK_RUNBOOK.md)
- [Post-Launch Triage](./docs/POST_LAUNCH_TRIAGE.md)
- [MVP Plan Audit (2026-02-25)](./docs/MVP_PLAN_AUDIT_2026-02-25.md)

## Quick Start (MVP Stack)

## 1) Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

## 2) Frontend

```bash
cd frontend
npm install
npm start
```

## 3) Environment

Frontend expects:

```env
REACT_APP_BACKEND_URL=http://localhost:8000
```

Backend environment variables are in:

- `backend/.env.example`

## Root Convenience Scripts

From repository root:

```bash
npm run dev:mvp
npm run dev:frontend:mvp
npm run dev:backend:mvp
npm run build:frontend:mvp
npm run test:backend:mvp
```
