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
