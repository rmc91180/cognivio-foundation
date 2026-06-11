# Work Package A0 — Runbook & Green Checklist
**Clone Setup, Infrastructure & CI Scaffold**

Goal: stand up `cognivio-foundation` — a fully isolated clone of the live app — with a 2-replica worker, disposable data stores, and a CI gate. **The defining constraint of A0 is isolation: the clone must never be able to read, write, or deploy to any live surface.** Do not paste A1 until every box in the Final Green Checklist is ticked.

## Division of labor
- **You (Rafi):** all logins / MFA, billing & plan tier, the git mirror-push, and pasting secret values into Railway env vars.
- **Me (Claude):** drive the console click-through via the Chrome extension, read back confirmations, and pause for your OK before any create/destructive step.

## Conventions used below
- Live repo assumed: `cognivio-teacher-assessment`. Clone repo: `cognivio-foundation`.
- Live Railway project: `cognivio-teacher-assessment-production`. Clone: `cognivio-foundation`.
- Replace `<github-user-or-org>` with your GitHub owner.
- ⚠️ = isolation-critical check. ⛔ = step only you can do.

---

## A0.1 — The clone repository

Cleanest path: create an empty repo in the UI, then mirror-push into it from your machine. A mirror is a true copy of all branches/tags at current `main` with **no upstream/fork link** — exactly what we want.

- [ ] **⛔ Create the empty target repo.** GitHub → New repository → name `cognivio-foundation`, visibility = Private, **do NOT** add README / .gitignore / license (the mirror must land in an empty repo). Click Create.
- [ ] **⛔ Mirror-push from your machine.** Run these four commands locally (needs your GitHub auth):
  ```bash
  git clone --bare https://github.com/<github-user-or-org>/cognivio-teacher-assessment.git
  cd cognivio-teacher-assessment.git
  git push --mirror https://github.com/<github-user-or-org>/cognivio-foundation.git
  cd .. && rm -rf cognivio-teacher-assessment.git
  ```
  This pushes full history at current `main`, no fork relationship. The last line removes the throwaway bare clone.
- [ ] **Confirm full code landed.** Open `cognivio-foundation` → verify `main` shows the same latest commit SHA as live `main`, and `frontend/` + `backend/` are present.
- [ ] **Protect `main`.** Settings → Branches → Add branch ruleset (or classic rule) for `main`:
  - Require a pull request before merging (≥0 approvals OK for solo, but PR required).
  - Require status checks to pass — *add the CI checks here after A0.6's first run* (checks only appear in the list once they've run at least once).
  - Block force pushes; **Do not allow bypassing the above settings**.
  - No direct push to `main`.
- [ ] **⚠️ Isolation — no live deploy connection.** On the clone repo: Settings → Integrations / GitHub Apps → confirm it is **not** linked to the live Railway project and **not** linked to the live Cloudflare Pages project. Then, from the Cloudflare side, confirm **no Pages project** has `cognivio-foundation` as its source. The clone must not be wired to any live surface.

---

## A0.2 — Railway (clone compute, two replicas)

- [ ] **Create a new Railway project** named `cognivio-foundation`, separate from `cognivio-teacher-assessment-production`. New Project → Deploy from GitHub repo → select `cognivio-foundation` → deploy from branch `main`.
- [ ] **API service.** This first deploy becomes the API service. Set its start command to the live API command (per CLAUDE.md): `uvicorn server:app --host 0.0.0.0 --port $PORT` with root/dir `backend`.
- [ ] **Worker service.** Add a second service from the **same repo/image** in the same project. Set its start command to the worker entrypoint: `python worker_entrypoint.py` (root/dir `backend`). This mirrors live's API + worker split.
- [ ] **⛔/⚠️ Worker replicas = 2.** Worker service → Settings → Deploy → set **Replicas = 2**. *Non-negotiable — the parity bar is meaningless at one replica.* If your plan caps replicas, resolve it now (you said Railway should be OK; confirm the count actually shows 2 after deploy).
- [ ] **Shared env vars.** Both services read the same Mongo / Redis / R2 connection vars (see the Env Var Master Table). Use a shared variable group or set identical values on each. We populate these as A0.3–A0.5 produce the values.
- [ ] **⚠️ Confirm separation.** The new project is distinct from the live project, deploys only from `cognivio-foundation`, and does not share services with live.

---

## A0.3 — Mongo Atlas (disposable, fully isolated)

Physical separation preferred — a separate Atlas **project/cluster**, not just a new db name on the live cluster — so the aggressive `update_many`/drop/rebuild work in A2–A3 can never touch live data.

- [ ] **⛔ Create a separate Atlas project.** Atlas → Projects → New Project → name `cognivio-foundation` (or new cluster, at minimum). Keeping it a separate project makes cross-contamination impossible.
- [ ] **Build a cluster.** Free M0 is fine for the clone (upgrade later only if perf parity needs it).
- [ ] **⛔ Create a DB user** (scoped to this project) and capture username/password.
- [ ] **Network access.** Add Railway egress / `0.0.0.0/0` (throwaway cluster, so this is acceptable) so both worker replicas + API can connect.
- [ ] **Name the DB unmistakably:** `cognivio_foundation_throwaway` — so no one ever confuses it for `cognivio`.
- [ ] **Seed nothing.** The clone starts empty; A3's tenancy-complete factories generate all test data.
- [ ] **⛔ Capture connection string** → `MONGO_URL`, and `DB_NAME=cognivio_foundation_throwaway`.

---

## A0.4 — R2 (throwaway bucket, never the live bucket)

- [ ] **Create a new R2 bucket** named `cognivio-foundation-assets`. Cloudflare dashboard → R2 → Create bucket.
- [ ] **⛔ Create scoped API credentials.** R2 → Manage R2 API Tokens → Create token → permission **Object Read & Write**, **scoped to only `cognivio-foundation-assets`** (use the bucket-specify option; if scoping isn't available, create a standalone token you can revoke independently). Capture Access Key ID + Secret.
- [ ] **⛔ Capture the S3 endpoint:** `https://<account-id>.r2.cloudflarestorage.com`.
- [ ] **⚠️ Isolation:** the credentials grant access to **only** this bucket — never the live asset bucket. A1 wires the StorageGateway to `cognivio-foundation-assets`.
- [ ] Capture → `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

---

## A0.5 — Redis (new everywhere; first used in A4)

Provision now so the env is complete from the start (recommended — A4 becomes pure code, no infra scramble).

- [ ] **Add Redis to the clone's Railway project.** Railway → New → Database → **Add Redis**. Railway provisions it and exposes a connection URL automatically.
- [ ] **⛔ Capture connection URL** → `REDIS_URL`. (Prefer the private/internal URL for service-to-service; public only if needed.)
- [ ] Note: A1–A3 don't use Redis; it just sits ready for A4.

---

## A0.6 — CI scaffold (defines the required checks)

> The pasted package referenced A0.6 but didn't include its spec. This scaffold defines sensible required checks from the documented stack (FastAPI/pytest backend, React/Craco frontend). Adjust if your A0.6 spec differs.

- [ ] **Add the workflow.** Create `.github/workflows/ci.yml` in `cognivio-foundation` (content below). Open a PR for it (branch protection now blocks direct push).
- [ ] **Let it run once** so the check names register, then go back to A0.1's branch protection and mark `backend-tests` and `frontend-build` as **required status checks**.
- [ ] **Confirm PR-to-main is enforced:** a direct push to `main` is rejected; a PR cannot merge with red checks.

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  backend-tests:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -r requirements.txt
      - run: pytest -q

  frontend-build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: CI=true npm test -- --watchAll=false --passWithNoTests
      - run: npm run build
```

---

## Env Var Master Table (both Railway services)

| Variable | Source | Notes |
|---|---|---|
| `MONGO_URL` | A0.3 | Atlas connection string (clone project) |
| `DB_NAME` | A0.3 | `cognivio_foundation_throwaway` |
| `JWT_SECRET` | generate | new secret, **not** live's |
| `EMERGENT_LLM_KEY` | your key | clone may reuse, or use a separate key |
| `CORS_ORIGINS` | clone frontend URL | the clone's Pages/preview URL, not live |
| `R2_BUCKET` | A0.4 | `cognivio-foundation-assets` |
| `R2_ENDPOINT` | A0.4 | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | A0.4 | scoped to clone bucket |
| `R2_SECRET_ACCESS_KEY` | A0.4 | scoped to clone bucket |
| `REDIS_URL` | A0.5 | Railway Redis, unused until A4 |
| `REACT_APP_BACKEND_URL` | A0.2 | clone API service URL |

---

## ✅ Final Green Checklist (all must be true before pasting A1)

- [ ] `cognivio-foundation` repo exists, contains full code at current live `main` SHA, with **no fork/upstream link**.
- [ ] Clone `main` is protected: PR required, no direct push, force-push blocked, no bypass.
- [ ] **⚠️ Clone repo has zero deploy connection to live Cloudflare Pages and live Railway.** (single most important check)
- [ ] Railway project `cognivio-foundation` exists, separate from live, deploys from clone `main`.
- [ ] Two services live: **API** (`uvicorn server:app`) and **worker** (`worker_entrypoint.py`).
- [ ] **Worker shows Replicas = 2** (verified in the running deploy, not just configured).
- [ ] Both replicas read identical shared env vars.
- [ ] Atlas: separate project/cluster, db `cognivio_foundation_throwaway`, empty, connection string captured.
- [ ] R2 bucket `cognivio-foundation-assets` exists; credentials scoped to it only; never touches live bucket.
- [ ] Redis provisioned on the clone Railway project; `REDIS_URL` captured.
- [ ] CI workflow merged; `backend-tests` + `frontend-build` set as required checks; red checks block merge.
- [ ] Env Var Master Table fully populated on both services.

## ✅ A0.7 — Isolation verification (added; do BEFORE A1)
Booting green proves vars are *valid*, not *isolated*.

- [ ] Connect to the clone's Mongo via its actual `MONGO_URL` → confirm DB is `cognivio_foundation_throwaway` and **empty**.
- [ ] Test upload on the clone → object lands in `cognivio-foundation-assets`, not the live bucket.

When every box is green, A0 is complete — proceed to A1.

---

## Execution log & corrections (from live run, 2026-06-04)
- **Live reference project is `cozy-endurance`** (not `cognivio-teacher-assessment-production`). Its 3 services: backend `cognivio-teacher-assessment`, `MongoDB`, `cognivio-frontend`. Live runs a single combined backend (no separate worker) — the api/worker split is introduced on the clone.
- **Builder is Dockerfile** (`backend/Dockerfile`), root dir `backend`, branch `main`, healthcheck `/health`, restart `ON_FAILURE` — all from `backend/railway.toml`, which also defines the exact `api` and `worker` start commands (real entrypoint is `server:app`, not `app.main:app`).
- **Env vars:** full 43-key set captured from live and sorted into 3 buckets — see `A0-env-var-map.md`.
- **Status:** A0.1 ✅ complete. A0.2 ✅ **structure complete** — clone Railway project `cognivio-foundation` with two services off the same repo: **api** (root `backend`, Dockerfile build ✅ green, start command set) and **worker** (root `backend`, worker start command, **replicas = 2** ✅). Both currently fail at runtime because env vars aren't wired yet (expected pre-A0.3): api fails the `/health` healthcheck, worker can't reach Mongo.
- **A0.2 circle-back items (do during the env step, after A0.3–A0.5):** paste the bucketed env set onto **both** services (`A0-env-var-map.md`); add `GIT_SHA = ${{ RAILWAY_GIT_COMMIT_SHA }}` on each; override/remove the `/health` healthcheck on **worker** (no HTTP server); then verify api online + both worker replicas running.
- **Note:** Railway's "Suggested Variables" on the new services infer values from source code that DIFFER from live (e.g. `OPENAI_VISION_MODEL=gpt-4.1-mini` vs live `gpt-4o`). Do **not** accept those — use the bucketed live set.
