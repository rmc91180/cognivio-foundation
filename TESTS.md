# Test Documentation

This document describes the active testing path for the Cognivio production stack.

## Test Structure

```
Cognivio/
├── backend/
│   └── tests/              # FastAPI / analysis / pipeline tests
├── frontend/
│   └── src/                # Frontend app under active production path
└── e2e/
    └── tests/              # Playwright E2E tests
```

Archived legacy stacks are not part of the active CI path.

## Running Tests

### Backend Tests

```bash
python -m pytest backend/tests -q
```

### Frontend Build Verification

```bash
npm run build:frontend:mvp
```

### E2E Tests

```bash
cd e2e
npm install
npx playwright install
npm test
```

---

## Coverage Focus

The active test emphasis is:

- backend API contracts
- video/privacy/analysis flows
- localization and report generation
- critical Playwright admin flows

---

## E2E Test Scenarios

### Authentication (`auth.spec.ts`)

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Display login form | Navigate to /login | Form fields visible |
| Validation error | Submit empty form | Error message shown |
| Invalid credentials | Submit wrong password | Error message shown |
| Successful login | Submit demo credentials | Redirect to dashboard |
| Persist authentication | Login, reload page | Stay logged in |
| Protected routes | Access /dashboard without auth | Redirect to login |
| Logout | Click logout button | Redirect to login |

### Template Creation (`template-creation.spec.ts`)

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Navigate to frameworks | Click Frameworks link | Framework page loads |
| Display templates | Visit /frameworks | Danielson, Marshall visible |
| Template preview | Click on template | Element count shown |
| Continue to elements | Select template, click Continue | Element selection page |
| Display elements by domain | Visit /frameworks/elements | Domains organized |
| Assign elements | Interact with drag-drop | Elements assignable |
| Save configuration | Click Save | Success message |
| Create custom template | Click Create Custom | Name input shown |

### Roster Navigation (`roster-navigation.spec.ts`)

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Navigate to roster | Click Roster link | Roster page loads |
| Display teacher list | Visit /roster | Teacher rows visible |
| Color indicators | View roster | Status chips visible |
| Sort by column | Click column header | Sort indicator shown |
| Filter by status | Use filter dropdown | Filtered results |
| Navigate to teacher | Click teacher row | Teacher dashboard |
| Teacher dashboard | View teacher page | Details visible |
| AI observations | View teacher page | Observations section |
| Review observations | Click accept/reject | Review recorded |
| Performance charts | View teacher page | Charts visible |
| Gradebook status | View teacher page | Status indicator |

---

## CI Integration

The active CI path validates:

- `backend/` Python tests
- `frontend/` production build

See [.github/workflows/ci.yml](./.github/workflows/ci.yml).
