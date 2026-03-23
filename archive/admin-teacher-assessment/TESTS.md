# Test Documentation

This document describes the testing strategy and test coverage for the Admin Teacher Assessment Platform.

## Test Structure

```
admin-teacher-assessment/
├── server/
│   └── tests/
│       ├── unit/           # Unit tests for utilities and services
│       └── integration/    # API integration tests
├── client/
│   └── src/
│       └── **/__tests__/   # Component and store tests
└── e2e/
    └── tests/              # Playwright E2E tests
```

## Running Tests

### Unit Tests (Server)

```bash
cd server
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage report
```

### Unit Tests (Client)

```bash
cd client
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage report
```

### E2E Tests

```bash
cd e2e
npm install                 # Install Playwright
npx playwright install      # Install browsers
npm test                    # Run all E2E tests
npm run test:headed         # Run with visible browser
npm run test:ui             # Run with Playwright UI
npm run test:debug          # Debug mode
```

---

## Unit Test Coverage

### Server Tests

#### `aggregation.test.ts`

Tests for color mapping and score aggregation utilities.

| Test | Description |
|------|-------------|
| `colorFromScore returns green for scores >= 80` | Verifies green threshold |
| `colorFromScore returns yellow for scores >= 60` | Verifies yellow threshold |
| `colorFromScore returns red for scores < 60` | Verifies red threshold |
| `colorFromScore works with custom thresholds` | Custom threshold configuration |
| `aggregateScores weighted mode` | Weighted average calculation |
| `aggregateScores worst_score mode` | Returns lowest score |
| `aggregateScores majority_color mode` | Returns most common color |
| `aggregateScores handles empty array` | Edge case handling |
| `calculateProblemScore ranks by severity` | Problem scoring algorithm |
| `calculateProblemScore considers trends` | Declining trend boost |
| `calculateProblemScore includes gradebook flag` | Gradebook integration |

### Client Tests

#### `ColorChip.test.tsx`

Tests for the status indicator component.

| Test | Description |
|------|-------------|
| `renders with green color` | Green status styling |
| `renders with yellow color` | Yellow status styling |
| `renders with red color` | Red status styling |
| `renders with gray color` | Gray/neutral styling |
| `renders label when provided` | Score label display |
| `applies size classes` | Small/medium/large sizes |
| `includes accessibility label` | ARIA compliance |

#### `authStore.test.ts`

Tests for authentication state management.

| Test | Description |
|------|-------------|
| `login sets user and token` | State mutation |
| `login persists to localStorage` | Token persistence |
| `logout clears state` | State reset |
| `logout removes from localStorage` | Storage cleanup |
| `setActiveRole updates role` | Role switching |
| `isAuthenticated computed correctly` | Derived state |

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

## Acceptance Tests

Based on the specification, here are the 10 acceptance tests:

### AT-1: User can log in with email/password
```gherkin
Given I am on the login page
When I enter valid credentials
And click "Sign In"
Then I should be redirected to the dashboard
And see my name in the top navigation
```

### AT-2: User can select a framework template
```gherkin
Given I am logged in as an admin
When I navigate to Framework Selection
And click on "Danielson Framework"
Then I should see the framework details
And be able to proceed to element selection
```

### AT-3: User can assign elements to metric columns
```gherkin
Given I am on the Element Selection page
When I drag element "1a" to "Instruction" column
Then the element should appear in that column
And the change should persist after saving
```

### AT-4: Roster displays color-coded metrics
```gherkin
Given I am on the Teacher Roster page
Then I should see all teachers listed
And each teacher should have colored status chips
And colors should match their performance scores
```

### AT-5: User can sort roster by score
```gherkin
Given I am on the Teacher Roster page
When I click the "Score" column header
Then teachers should be sorted by score
And clicking again should reverse the order
```

### AT-6: User can filter roster by status
```gherkin
Given I am on the Teacher Roster page
When I select "Needs Attention" from the filter
Then only teachers with red status should be shown
```

### AT-7: Teacher dashboard shows element scores
```gherkin
Given I click on a teacher in the roster
Then I should see the Teacher Dashboard
And all element scores should be displayed
And each score should have the correct color
```

### AT-8: User can review AI observations
```gherkin
Given I am on a Teacher Dashboard
When I find a pending AI observation
And click "Accept"
Then the observation status should change to "Accepted"
And an audit log entry should be created
```

### AT-9: Problem score ranks elements correctly
```gherkin
Given a teacher has multiple element scores
When I view their dashboard
Then elements should be ranked by problem score
And the most critical elements should appear first
```

### AT-10: Color thresholds are configurable
```gherkin
Given I am an admin on the Settings page
When I change the green threshold from 80 to 85
And save the settings
Then roster colors should update accordingly
```

---

## Test Data

### Demo Users

| Email | Password | Roles |
|-------|----------|-------|
| admin@cognivio.demo | demo123 | admin, observer |
| observer@cognivio.demo | demo123 | observer |

### Seed Teachers

8 teachers with varied performance profiles:
- 2 teachers with green status (80+ scores)
- 3 teachers with yellow status (60-79 scores)
- 3 teachers with red status (<60 scores)

### Seed Rubrics

- Danielson Framework (22 elements, 4 domains)
- Marshall Framework (36 elements, 6 domains)

---

## Coverage Goals

| Category | Target | Current |
|----------|--------|---------|
| Server Unit Tests | 80% | - |
| Client Unit Tests | 70% | - |
| E2E Critical Paths | 100% | 100% |

## CI Integration

Tests run automatically on:
- Pull request creation
- Push to main branch
- Nightly builds

See `.github/workflows/ci.yml` for configuration.
