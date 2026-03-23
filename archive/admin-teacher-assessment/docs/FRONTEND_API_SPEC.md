# Administrative Teacher Assessment Platform
## Front End Component Map & API Contract Specification

**Version:** 1.0.0-MVP
**Last Updated:** January 2025
**Stack:** React + TypeScript, Material UI v5, Vite, Express, PostgreSQL, Knex

---

## Table of Contents

1. [Front End Component Map (Screens 1-6)](#1-front-end-component-map)
2. [Routing Map](#2-routing-map)
3. [TypeScript Interfaces](#3-typescript-interfaces)
4. [API Contract (REST)](#4-api-contract)
5. [Data Mapping](#5-data-mapping)
6. [Pseudocode & Algorithms](#6-pseudocode--algorithms)
7. [Acceptance Tests](#7-acceptance-tests)
8. [Implementation Checklist](#8-implementation-checklist)
9. [Seed Data](#9-seed-data)
10. [Integration Notes & TODOs](#10-integration-notes--todos)

---

## 1. Front End Component Map

### Screen 1: Login Page

**Purpose:** Authenticate principals and observers to access the assessment platform.

**Primary User Goals:**
- Enter credentials and sign in
- Receive clear feedback on authentication errors

#### Component Tree

| Component | Purpose | Props Interface | Local State | Events | API Calls |
|-----------|---------|-----------------|-------------|--------|-----------|
| `LoginPage` | Page container | `{}` | `LoginPageState` | - | - |
| `LoginForm` | Credential input form | `LoginFormProps` | `LoginFormState` | `onSubmit` | `POST /api/auth/login` |
| `EmailInput` | Email field | `TextFieldProps` | - | `onChange` | - |
| `PasswordInput` | Password field with visibility toggle | `PasswordInputProps` | `{ visible: boolean }` | `onChange`, `onToggle` | - |
| `SubmitButton` | Login action button | `ButtonProps` | - | `onClick` | - |
| `ErrorAlert` | Authentication error display | `{ message: string }` | - | `onClose` | - |

```typescript
// LoginForm Props & State
interface LoginFormProps {
  onSuccess: (user: User, token: string) => void;
  onError: (error: string) => void;
}

interface LoginFormState {
  email: string;
  password: string;
  isLoading: boolean;
  error: string | null;
}

// Usage
<LoginPage>
  <Box sx={{ maxWidth: 400, mx: 'auto', mt: 8 }}>
    <Typography variant="h4">Teacher Assessment Platform</Typography>
    <LoginForm
      onSuccess={(user, token) => {
        authContext.login(user, token);
        navigate('/dashboard');
      }}
      onError={(msg) => setError(msg)}
    />
  </Box>
</LoginPage>
```

**Accessibility Notes:**
- Form inputs have `aria-label` and `aria-describedby` for error states
- Enter key submits form
- Focus moves to first error field on validation failure
- Password visibility toggle has `aria-pressed` state

**UI Copy:**
- Title: "Teacher Assessment Platform"
- Email label: "Email Address"
- Password label: "Password"
- Submit button: "Sign In"
- Error: "Invalid email or password. Please try again."
- Loading: "Signing in..."

---

### Screen 2: Dashboard (Home)

**Purpose:** Provide at-a-glance overview of teacher performance distribution and quick navigation.

**Primary User Goals:**
- View summary statistics (total teachers, observations, pending reviews)
- See performance distribution (green/yellow/red counts)
- Navigate to roster or specific teacher views

#### Component Tree

| Component | Purpose | Props Interface | Local State | Events | API Calls |
|-----------|---------|-----------------|-------------|--------|-----------|
| `DashboardPage` | Page container | `{}` | `DashboardState` | - | `GET /api/dashboard/summary` |
| `AppShell` | Layout with sidebar | `AppShellProps` | `{ drawerOpen: boolean }` | - | - |
| `StatsCardGrid` | Summary metrics row | `{ stats: DashboardStats }` | - | - | - |
| `StatsCard` | Individual stat display | `StatsCardProps` | - | `onClick` | - |
| `DistributionChart` | Pie/bar chart of status | `{ distribution: StatusDistribution }` | - | `onSegmentClick` | - |
| `RecentActivityList` | Recent observations | `{ activities: Activity[] }` | - | `onItemClick` | - |
| `QuickActions` | Action buttons | `{}` | - | `onAction` | - |

```typescript
interface StatsCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  color?: 'primary' | 'success' | 'warning' | 'error';
  onClick?: () => void;
  tooltip?: string;
}

interface DashboardStats {
  teacherCount: number;
  observationCount: number;
  pendingReviews: number;
  averageScore: number;
  statusDistribution: StatusDistribution;
}

interface StatusDistribution {
  green: number;
  yellow: number;
  red: number;
}

// Usage
<DashboardPage>
  <AppShell>
    <Typography variant="h4">Dashboard</Typography>
    <StatsCardGrid stats={dashboardStats} />
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <DistributionChart distribution={stats.statusDistribution} />
      </Grid>
      <Grid item xs={12} md={6}>
        <RecentActivityList activities={recentActivities} />
      </Grid>
    </Grid>
    <QuickActions />
  </AppShell>
</DashboardPage>
```

**Accessibility Notes:**
- Stats cards are focusable and announce value changes
- Chart has `role="img"` with `aria-label` describing distribution
- Keyboard navigation between cards with arrow keys

**UI Copy:**
- Title: "Dashboard"
- Stats: "Total Teachers", "Observations This Month", "Pending AI Reviews"
- Distribution: "Performance Distribution"
- Quick actions: "View Roster", "Select Framework", "Upload Video"

---

### Screen 3: Framework Selection

**Purpose:** Allow principal to select or customize the evaluation rubric template.

**Primary User Goals:**
- Choose between Marshall, Danielson, or Customize
- Preview selected framework's domains and elements
- Proceed to element assignment (Screen 4)

#### Component Tree

| Component | Purpose | Props Interface | Local State | Events | API Calls |
|-----------|---------|-----------------|-------------|--------|-----------|
| `FrameworkSelectionPage` | Page container | `{}` | `FrameworkState` | - | `GET /api/rubrics/templates` |
| `FrameworkOptionCard` | Clickable framework card | `FrameworkOptionProps` | - | `onSelect` | - |
| `FrameworkPreview` | Domain/element preview | `{ template: RubricTemplate }` | `{ expandedDomain: string }` | - | - |
| `DomainAccordion` | Expandable domain | `DomainAccordionProps` | - | `onExpand` | - |
| `ElementList` | Elements within domain | `{ elements: RubricElement[] }` | - | - | - |
| `CustomizeDialog` | Custom template builder | `CustomizeDialogProps` | `CustomizeState` | `onSave`, `onCancel` | `POST /api/rubrics/templates` |
| `ElementLibrary` | Full element picker | `ElementLibraryProps` | `{ search: string }` | `onSelect` | `GET /api/rubrics/elements` |
| `AddCustomElementForm` | New element form | `{}` | `CustomElementState` | `onAdd` | - |

```typescript
interface FrameworkOptionProps {
  id: string;
  name: string;
  description: string;
  elementCount: number;
  domainCount: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

interface CustomizeDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (template: RubricTemplate) => void;
  allElements: RubricElement[]; // Combined Marshall + Danielson
}

interface CustomizeState {
  name: string;
  selectedElements: RubricElement[];
  customElements: RubricElement[];
  columns: TemplateColumn[];
}

// Usage
<FrameworkSelectionPage>
  <Typography variant="h4">Select Evaluation Framework</Typography>
  <Grid container spacing={3}>
    <Grid item xs={12} md={4}>
      <FrameworkOptionCard
        id="marshall_v2010"
        name="Marshall Rubric"
        description="Kim Marshall's 6-domain framework with 59 elements"
        elementCount={59}
        domainCount={6}
        isSelected={selected === 'marshall_v2010'}
        onSelect={handleSelect}
      />
    </Grid>
    <Grid item xs={12} md={4}>
      <FrameworkOptionCard
        id="danielson_v2026"
        name="Danielson Framework"
        description="Charlotte Danielson's 4-domain framework with 22 elements"
        elementCount={22}
        domainCount={4}
        isSelected={selected === 'danielson_v2026'}
        onSelect={handleSelect}
      />
    </Grid>
    <Grid item xs={12} md={4}>
      <FrameworkOptionCard
        id="customize"
        name="Customize"
        description="Build your own framework from the element library"
        elementCount={0}
        domainCount={0}
        isSelected={selected === 'customize'}
        onSelect={() => setCustomizeOpen(true)}
      />
    </Grid>
  </Grid>
  {selectedTemplate && <FrameworkPreview template={selectedTemplate} />}
  <CustomizeDialog
    open={customizeOpen}
    onClose={() => setCustomizeOpen(false)}
    onSave={handleCustomSave}
    allElements={allElements}
  />
</FrameworkSelectionPage>
```

**Accessibility Notes:**
- Framework cards are buttons with `role="radio"` in a `role="radiogroup"`
- Arrow keys navigate between options
- Accordion uses `aria-expanded` and `aria-controls`
- Element library has search with `aria-live="polite"` for results

**UI Copy:**
- Title: "Select Evaluation Framework"
- Marshall: "Marshall Rubric (Kim Marshall, 2010)" / "Comprehensive 6-domain framework covering planning, management, instruction, assessment, family outreach, and professionalism."
- Danielson: "Danielson Framework (Standard)" / "Research-based 4-domain framework focusing on planning, environment, instruction, and professional responsibilities."
- Customize: "Customize Framework" / "Build a custom framework by selecting elements from Marshall and Danielson, or add your own."
- Continue button: "Continue to Element Assignment"
- Add element: "Add Custom Element"
- Custom element form: "Element Name", "Description", "Weight (1-3)"

---

### Screen 4: Element Selection/Assignment Pane

**Purpose:** Assign rubric elements to metric columns (B-E) for roster display.

**Primary User Goals:**
- View all elements from selected framework
- Drag/drop or keyboard-assign elements to columns
- Save column configuration

#### Component Tree

| Component | Purpose | Props Interface | Local State | Events | API Calls |
|-----------|---------|-----------------|-------------|--------|-----------|
| `ElementAssignmentPage` | Page container | `{}` | `AssignmentState` | - | `GET /api/rubrics/elements`, `POST /api/rubrics/templates` |
| `ElementSourcePanel` | Unassigned elements | `{ elements: RubricElement[] }` | `{ search: string }` | - | - |
| `DraggableElement` | Draggable element chip | `DraggableElementProps` | - | `onDragStart`, `onDragEnd` | - |
| `ColumnGrid` | 4 metric columns | `{ columns: TemplateColumn[] }` | - | - | - |
| `DroppableColumn` | Single drop target | `DroppableColumnProps` | `{ isOver: boolean }` | `onDrop`, `onRemove` | - |
| `ColumnHeader` | Column name editor | `{ name: string, onChange: fn }` | `{ editing: boolean }` | `onRename` | - |
| `AssignedElementChip` | Element in column | `AssignedElementProps` | - | `onRemove`, `onReorder` | - |
| `KeyboardAssignDialog` | A11y keyboard flow | `KeyboardAssignProps` | - | `onAssign` | - |
| `SaveConfigButton` | Save action | `{ onSave: fn, disabled: boolean }` | - | `onClick` | - |

```typescript
interface DraggableElementProps {
  element: RubricElement;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onKeyboardAssign: () => void; // Opens keyboard dialog
}

interface DroppableColumnProps {
  column: TemplateColumn;
  elements: RubricElement[];
  onDrop: (elementId: string) => void;
  onRemove: (elementId: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

interface TemplateColumn {
  id: string;
  name: string; // Default: "Metric B", "Metric C", "Metric D", "Metric E"
  position: number; // 0-3 (B-E)
  elementIds: string[];
}

interface AssignmentState {
  template: RubricTemplate;
  columns: TemplateColumn[];
  unassignedElements: RubricElement[];
  isDirty: boolean;
}

// Usage
<ElementAssignmentPage>
  <Typography variant="h4">Assign Elements to Metric Columns</Typography>
  <Typography variant="body2" color="textSecondary">
    Drag elements to columns, or select an element and press Enter to choose a column.
  </Typography>

  <Grid container spacing={2}>
    <Grid item xs={12} md={3}>
      <ElementSourcePanel
        elements={unassignedElements}
        onKeyboardAssign={openKeyboardDialog}
      />
    </Grid>
    <Grid item xs={12} md={9}>
      <ColumnGrid columns={columns}>
        {columns.map(col => (
          <DroppableColumn
            key={col.id}
            column={col}
            elements={getElementsForColumn(col.id)}
            onDrop={handleDrop}
            onRemove={handleRemove}
            onReorder={handleReorder}
          />
        ))}
      </ColumnGrid>
    </Grid>
  </Grid>

  <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
    <Button variant="outlined" onClick={handleReset}>Reset</Button>
    <Button variant="contained" onClick={handleSave} disabled={!isDirty}>
      Save Configuration
    </Button>
  </Box>

  <KeyboardAssignDialog
    open={keyboardDialogOpen}
    element={selectedElement}
    columns={columns}
    onAssign={handleKeyboardAssign}
    onClose={() => setKeyboardDialogOpen(false)}
  />
</ElementAssignmentPage>
```

**Accessibility Notes:**
- Drag-and-drop has keyboard alternative: focus element, press Enter, select column from dialog
- Columns have `role="list"`, elements have `role="listitem"`
- `aria-grabbed` and `aria-dropeffect` for drag states
- Screen reader announces: "Element [name] assigned to [column]"
- Tab order: Source panel → Column B → Column C → Column D → Column E → Save

**UI Copy:**
- Title: "Assign Elements to Metric Columns"
- Instructions: "Drag elements from the left panel to the columns below. Each column can contain multiple elements that will be aggregated into a single score."
- Column defaults: "Metric B", "Metric C", "Metric D", "Metric E"
- Keyboard hint: "Press Enter on an element to assign via keyboard"
- Save: "Save Configuration"
- Reset: "Reset to Default"
- Success: "Configuration saved successfully"
- Empty column: "Drop elements here"

---

### Screen 5: Color-Coded Teacher Roster

**Purpose:** Display all teachers with aggregated performance metrics as color chips.

**Primary User Goals:**
- View all teachers at a glance
- Identify teachers needing attention (yellow/red)
- Filter and sort by various criteria
- Click to navigate to teacher detail

#### Component Tree

| Component | Purpose | Props Interface | Local State | Events | API Calls |
|-----------|---------|-----------------|-------------|--------|-----------|
| `RosterPage` | Page container | `{}` | `RosterState` | - | `GET /api/roster`, `GET /api/gradebook/status` |
| `RosterFilters` | Filter controls | `RosterFiltersProps` | `FilterState` | `onFilterChange` | - |
| `StatusFilter` | Green/yellow/red filter | `{ value: string[], onChange: fn }` | - | - | - |
| `SubjectFilter` | Subject dropdown | `{ value: string[], onChange: fn }` | - | - | - |
| `SearchInput` | Name search | `{ value: string, onChange: fn }` | - | - | - |
| `RosterTable` | Data table | `{ rows: RosterRow[], columns: TemplateColumn[] }` | `{ sortBy, sortDir }` | `onSort`, `onRowClick` | - |
| `RosterHeader` | Sortable headers | `RosterHeaderProps` | - | `onSort` | - |
| `RosterRow` | Single teacher row | `{ row: RosterRow }` | - | `onClick` | - |
| `ColorChip` | Status indicator | `ColorChipProps` | - | - | - |
| `ChipTooltip` | Score tooltip | `ChipTooltipProps` | - | - | - |
| `GradebookFlag` | Missing grades indicator | `{ hasMissingGrades: boolean }` | - | - | - |
| `Pagination` | Page controls | `PaginationProps` | - | `onPageChange` | - |

```typescript
interface RosterRow {
  teacherId: string;
  teacherName: string;
  email: string;
  subjects: string[];
  overallStatus: 'green' | 'yellow' | 'red';
  overallScore: number;
  columns: ColumnScore[];
  lastObservation: string | null; // ISO date
  hasMissingGrades: boolean;
}

interface ColumnScore {
  columnId: string;
  columnName: string;
  status: 'green' | 'yellow' | 'red' | 'gray';
  score: number | null;
  elementCount: number;
}

interface ColorChipProps {
  status: 'green' | 'yellow' | 'red' | 'gray';
  size?: 'small' | 'medium';
  'aria-label': string; // Required for accessibility
}

interface ChipTooltipProps {
  score: number;
  lastObservation: string | null;
  teacherId: string;
  columnName: string;
}

// Usage
<RosterPage>
  <Typography variant="h4">Teacher Roster</Typography>

  <RosterFilters
    filters={filters}
    onFilterChange={setFilters}
  />

  <TableContainer component={Paper}>
    <Table>
      <RosterHeader
        columns={[
          { id: 'name', label: 'Teacher', sortable: true },
          { id: 'subjects', label: 'Subjects', sortable: false },
          ...templateColumns.map(c => ({ id: c.id, label: c.name, sortable: true })),
          { id: 'overall', label: 'Overall', sortable: true },
          { id: 'flags', label: '', sortable: false },
        ]}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={handleSort}
      />
      <TableBody>
        {rosterRows.map(row => (
          <RosterRow
            key={row.teacherId}
            row={row}
            onClick={() => navigate(`/teachers/${row.teacherId}`)}
          />
        ))}
      </TableBody>
    </Table>
  </TableContainer>

  <Pagination
    page={page}
    pageSize={pageSize}
    total={total}
    onPageChange={setPage}
  />
</RosterPage>
```

**ColorChip Component:**
```typescript
const ColorChip: React.FC<ColorChipProps> = ({ status, size = 'medium', 'aria-label': ariaLabel }) => {
  const colors = {
    green: '#4CAF50',
    yellow: '#FFC107',
    red: '#F44336',
    gray: '#9E9E9E',
  };

  return (
    <Tooltip title={<ChipTooltipContent />}>
      <Box
        role="status"
        aria-label={ariaLabel}
        sx={{
          width: size === 'small' ? 16 : 24,
          height: size === 'small' ? 16 : 24,
          borderRadius: '50%',
          backgroundColor: colors[status],
          cursor: 'pointer',
        }}
      />
    </Tooltip>
  );
};
```

**Accessibility Notes:**
- Table has `role="grid"` with proper `aria-sort` on sortable columns
- Color chips have `aria-label` like "Metric B: Green (82%)"
- Row click also triggered by Enter key
- Filter changes announced via `aria-live="polite"`
- Gradebook flag has `aria-label="Missing grades"`

**UI Copy:**
- Title: "Teacher Roster"
- Search placeholder: "Search by name..."
- Status filter: "Status", "All", "Green", "Yellow", "Red"
- Subject filter: "Subjects", "All Subjects"
- Empty state: "No teachers match your filters"
- Gradebook flag tooltip: "Missing grades in gradebook"
- Chip tooltip format: "[Column Name]: [Score]% | Last observed: [Date]"

---

### Screen 6: Teacher Detailed Analysis Dashboard

**Purpose:** Deep-dive into individual teacher's performance with element-level scores, AI observations, and trends.

**Primary User Goals:**
- View all element scores with numeric values
- Review AI-generated observations
- Accept, reject, or edit AI observations
- View performance trends over time
- Access video evidence

#### Component Tree

| Component | Purpose | Props Interface | Local State | Events | API Calls |
|-----------|---------|-----------------|-------------|--------|-----------|
| `TeacherDashboardPage` | Page container | `{ teacherId: string }` | `TeacherDashboardState` | - | `GET /api/teachers/:id/detail` |
| `TeacherHeader` | Name, summary stats | `{ teacher: TeacherDetail }` | - | - | - |
| `OverallScoreCard` | Aggregate score display | `{ score: number, status: string }` | - | - | - |
| `Top4ProblematicElements` | Priority elements | `{ elements: ProblemElement[] }` | - | `onElementClick` | - |
| `ProblemElementCard` | Single problem element | `ProblemElementProps` | - | `onClick` | - |
| `ElementScoresTable` | Full element breakdown | `{ elements: AssessmentElement[] }` | `{ sortBy, expanded }` | `onSort`, `onExpand` | - |
| `ElementScoreRow` | Single element row | `ElementScoreRowProps` | - | `onExpand` | - |
| `AIObservationsPanel` | AI observation list | `{ observations: AIObservation[] }` | `{ filter: string }` | - | - |
| `ObservationCard` | Single observation | `ObservationCardProps` | `{ expanded: boolean }` | `onAccept`, `onReject`, `onEdit` | `POST /api/ai/review` |
| `ObservationEditDialog` | Edit observation modal | `ObservationEditProps` | `EditState` | `onSave`, `onCancel` | - |
| `TrendChart` | Performance over time | `{ data: TrendDataPoint[] }` | - | - | - |
| `VideoEvidenceList` | Video links | `{ videos: VideoEvidence[] }` | - | `onVideoClick` | - |
| `GradebookStatusCard` | Gradebook integration | `{ status: GradebookStatus }` | - | - | - |
| `AuditLogPanel` | Change history | `{ logs: AuditEntry[] }` | - | - | `GET /api/audit` |

```typescript
interface TeacherDetail {
  id: string;
  name: string;
  email: string;
  subjects: string[];
  hireDate: string;
  overallScore: number;
  overallStatus: 'green' | 'yellow' | 'red';
  elements: AssessmentElement[];
  top4Problems: ProblemElement[];
  observations: AIObservation[];
  trends: TrendDataPoint[];
  videos: VideoEvidence[];
  gradebookStatus: GradebookStatus;
}

interface AssessmentElement {
  elementId: string;
  elementCode: string;
  elementName: string;
  domain: string;
  score: number;
  status: 'green' | 'yellow' | 'red' | 'gray';
  observationCount: number;
  lastObserved: string | null;
  trend: 'improving' | 'stable' | 'declining' | null;
  confidence: number; // 0-1
}

interface ProblemElement {
  elementId: string;
  elementName: string;
  score: number;
  status: 'yellow' | 'red';
  problemScore: number; // Computed priority score
  reason: string; // "Low score", "Declining trend", "Frequent issues"
}

interface AIObservation {
  id: string;
  elementId: string;
  elementName: string;
  videoId: string;
  timestamp: string; // "00:05:32"
  startTime: number; // seconds
  endTime: number; // seconds
  score: number;
  confidence: number;
  summary: string;
  evidence: string;
  reviewStatus: 'pending' | 'accepted' | 'rejected' | 'edited';
  reviewedAt: string | null;
  reviewedBy: string | null;
  originalScore?: number; // If edited
  createdAt: string;
}

interface ObservationCardProps {
  observation: AIObservation;
  onAccept: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  onEdit: (id: string, newScore: number, newEvidence: string) => void;
}

// Usage
<TeacherDashboardPage>
  <TeacherHeader teacher={teacher} />

  <Grid container spacing={3}>
    <Grid item xs={12} md={4}>
      <OverallScoreCard score={teacher.overallScore} status={teacher.overallStatus} />
    </Grid>
    <Grid item xs={12} md={8}>
      <Top4ProblematicElements elements={teacher.top4Problems} />
    </Grid>
  </Grid>

  <Tabs value={activeTab} onChange={setActiveTab}>
    <Tab label="Element Scores" />
    <Tab label="AI Observations" />
    <Tab label="Trends" />
    <Tab label="Videos" />
    <Tab label="Audit Log" />
  </Tabs>

  <TabPanel value={activeTab} index={0}>
    <ElementScoresTable elements={teacher.elements} />
  </TabPanel>

  <TabPanel value={activeTab} index={1}>
    <AIObservationsPanel
      observations={teacher.observations}
      onAccept={handleAccept}
      onReject={handleReject}
      onEdit={handleEdit}
    />
  </TabPanel>

  <TabPanel value={activeTab} index={2}>
    <TrendChart data={teacher.trends} />
  </TabPanel>

  <TabPanel value={activeTab} index={3}>
    <VideoEvidenceList videos={teacher.videos} />
  </TabPanel>

  <TabPanel value={activeTab} index={4}>
    <AuditLogPanel teacherId={teacher.id} />
  </TabPanel>

  <GradebookStatusCard status={teacher.gradebookStatus} />
</TeacherDashboardPage>
```

**Accessibility Notes:**
- Tabs use proper `role="tablist"`, `role="tab"`, `role="tabpanel"` with `aria-selected`
- Observation actions have confirmation dialogs with focus trap
- Trend chart has data table fallback for screen readers
- Element scores table sortable with `aria-sort`
- Video links open in new tab with `aria-label="Opens in new tab"`

**UI Copy:**
- Title: "[Teacher Name] - Performance Dashboard"
- Overall card: "Overall Score", "Based on [N] observations"
- Top 4 section: "Priority Areas for Improvement"
- Problem reasons: "Low score", "Declining performance", "Frequently flagged"
- Element table headers: "Element", "Domain", "Score", "Status", "Trend", "Last Observed"
- Observation actions: "Accept", "Reject", "Edit Score"
- Reject dialog: "Reason for rejection", "This observation will be excluded from scoring"
- Edit dialog: "Edit Observation Score", "New Score (1-100)", "Updated Evidence"
- Confidence label: "AI Confidence: [N]%"
- Trend labels: "↑ Improving", "→ Stable", "↓ Declining"
- Gradebook: "Gradebook Status", "Missing Grades", "[N] classes missing grades"

---

## 2. Routing Map

### React Router v6 Routes

```typescript
// src/routes/index.tsx

import { createBrowserRouter, Navigate } from 'react-router-dom';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <ProtectedRoute><AppShell /></ProtectedRoute>,
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'dashboard',
        element: <DashboardPage />,
      },
      {
        path: 'frameworks',
        element: <FrameworkSelectionPage />,
      },
      {
        path: 'frameworks/elements',
        element: <ElementAssignmentPage />,
      },
      {
        path: 'roster',
        element: <RosterPage />,
      },
      {
        path: 'teachers/:teacherId',
        element: <TeacherDashboardPage />,
      },
      {
        path: 'settings',
        element: <SettingsPage />,
      },
    ],
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);
```

### Route Guards

```typescript
// src/components/ProtectedRoute.tsx

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles = ['principal', 'observer', 'admin']
}) => {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
};
```

### Route Access by Role

| Route | Path | principal | observer | teacher | admin |
|-------|------|-----------|----------|---------|-------|
| Login | `/login` | ✓ (redirect) | ✓ (redirect) | ✓ (redirect) | ✓ (redirect) |
| Dashboard | `/dashboard` | ✓ | ✓ | ✗ | ✓ |
| Framework Selection | `/frameworks` | ✓ | ✗ | ✗ | ✓ |
| Element Assignment | `/frameworks/elements` | ✓ | ✗ | ✗ | ✓ |
| Roster | `/roster` | ✓ | ✓ | ✗ | ✓ |
| Teacher Detail | `/teachers/:id` | ✓ | ✓ | own only | ✓ |
| Settings | `/settings` | ✓ | ✗ | ✗ | ✓ |

---

## 3. TypeScript Interfaces

### Core Domain Types

```typescript
// src/types/index.ts

// ============ USER & AUTH ============

export type UserRole = 'principal' | 'observer' | 'teacher' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  token: string;
  expiresAt: string;
}

// ============ RUBRIC & TEMPLATES ============

export type AggregationMode = 'weighted' | 'worst_score' | 'majority_color';

export interface Thresholds {
  green: number;  // >= this is green (default: 80)
  yellow: number; // >= this is yellow (default: 60)
  red: number;    // below yellow is red (default: 0, not used directly)
}

export interface RubricElement {
  id: string;
  name: string;
  desc: string;
  weight: number;
  domainId: string;
  domainName: string;
  source: 'marshall' | 'danielson' | 'custom';
}

export interface RubricDomain {
  id: string;
  name: string;
  weight: number;
  elements: RubricElement[];
}

export interface RubricTemplate {
  id: string;
  name: string;
  source: 'Marshall' | 'Danielson' | 'Custom';
  version: string;
  aggregationMode: AggregationMode;
  defaultThresholds: Thresholds;
  domains: RubricDomain[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface TemplateColumn {
  id: string;
  name: string;
  position: number; // 0=B, 1=C, 2=D, 3=E
  elementIds: string[];
}

export interface TemplateAssignment {
  id: string;
  templateId: string;
  columns: TemplateColumn[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============ TEACHER & ASSESSMENT ============

export interface Teacher {
  id: string;
  name: string;
  email: string;
  subjects: string[];
  hireDate: string;
  createdAt: string;
}

export type StatusColor = 'green' | 'yellow' | 'red' | 'gray';
export type TrendDirection = 'improving' | 'stable' | 'declining' | null;

export interface Assessment {
  id: string;
  teacherId: string;
  templateId: string;
  observerId: string;
  observedAt: string;
  elements: AssessmentElement[];
  createdAt: string;
}

export interface AssessmentElement {
  elementId: string;
  elementCode: string;
  elementName: string;
  domain: string;
  score: number;          // 0-100 normalized
  rawScore: number;       // 1-4 original scale
  status: StatusColor;
  observationCount: number;
  lastObserved: string | null;
  trend: TrendDirection;
  confidence: number;     // 0-1
}

export interface ColumnScore {
  columnId: string;
  columnName: string;
  status: StatusColor;
  score: number | null;
  elementCount: number;
}

export interface RosterRow {
  teacherId: string;
  teacherName: string;
  email: string;
  subjects: string[];
  overallStatus: StatusColor;
  overallScore: number;
  columns: ColumnScore[];
  lastObservation: string | null;
  hasMissingGrades: boolean;
}

// ============ AI OBSERVATIONS ============

export type ReviewStatus = 'pending' | 'accepted' | 'rejected' | 'edited';

export interface AIObservation {
  id: string;
  teacherId: string;
  elementId: string;
  elementName: string;
  videoId: string;
  timestamp: string;      // "HH:MM:SS"
  startTime: number;      // seconds
  endTime: number;        // seconds
  score: number;          // 0-100 normalized
  confidence: number;     // 0-1
  summary: string;
  evidence: string;
  reviewStatus: ReviewStatus;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason?: string;
  originalScore?: number; // If edited
  createdAt: string;
}

export interface AIReviewRequest {
  action: 'accept' | 'reject' | 'edit';
  reason?: string;        // Required for reject
  newScore?: number;      // Required for edit
  newEvidence?: string;   // Optional for edit
}

// ============ VIDEO ============

export interface VideoEvidence {
  id: string;
  teacherId: string;
  filename: string;
  uploadedAt: string;
  uploadedBy: string;
  duration: number;       // seconds
  status: 'pending' | 'processing' | 'completed' | 'failed';
  observationCount: number;
  thumbnailUrl?: string;
}

export interface VideoUploadResponse {
  videoId: string;
  uploadUrl?: string;     // Presigned URL for direct upload (future)
  status: 'accepted';
}

// ============ GRADEBOOK ============

export interface GradebookStatus {
  teacherId: string;
  connected: boolean;
  lastSync: string | null;
  hasMissingGrades: boolean;
  missingClasses: string[];
}

// ============ PROBLEM ELEMENTS ============

export interface ProblemElement {
  elementId: string;
  elementName: string;
  domain: string;
  score: number;
  status: StatusColor;
  problemScore: number;   // Computed priority
  reasons: string[];      // ["Low score", "Declining trend"]
  trend: TrendDirection;
  observationCount: number;
}

// ============ TRENDS ============

export interface TrendDataPoint {
  date: string;           // ISO date
  score: number;
  observationCount: number;
}

// ============ AUDIT ============

export type AuditAction =
  | 'observation_accepted'
  | 'observation_rejected'
  | 'observation_edited'
  | 'template_created'
  | 'template_updated'
  | 'thresholds_updated'
  | 'video_uploaded';

export interface AuditEntry {
  id: string;
  userId: string;
  userName: string;
  action: AuditAction;
  targetType: 'observation' | 'template' | 'settings' | 'video';
  targetId: string;
  details: Record<string, any>;
  createdAt: string;
}

// ============ API RESPONSES ============

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface DashboardSummary {
  teacherCount: number;
  observationCount: number;
  pendingReviews: number;
  averageScore: number;
  statusDistribution: {
    green: number;
    yellow: number;
    red: number;
  };
}

export interface TeacherDetailResponse {
  teacher: Teacher;
  overallScore: number;
  overallStatus: StatusColor;
  elements: AssessmentElement[];
  top4Problems: ProblemElement[];
  observations: AIObservation[];
  trends: TrendDataPoint[];
  videos: VideoEvidence[];
  gradebookStatus: GradebookStatus;
}
```

### Example JSON Objects

#### Marshall Template (Shortened)

```json
{
  "id": "marshall_v2010",
  "name": "Marshall Rubric (Kim Marshall, 2010)",
  "source": "Marshall",
  "version": "2010-01-18",
  "aggregationMode": "weighted",
  "defaultThresholds": { "green": 80, "yellow": 60, "red": 0 },
  "domains": [
    {
      "id": "planning_preparation",
      "name": "Planning and Preparation for Learning",
      "weight": 1.0,
      "elements": [
        { "id": "mp_a_knowledge", "name": "Knowledge", "desc": "Expertise in subject and child development", "weight": 1 },
        { "id": "mp_a_strategy", "name": "Strategy", "desc": "Year plan aligned with standards and assessments", "weight": 1 }
      ]
    },
    {
      "id": "classroom_management",
      "name": "Classroom Management",
      "weight": 1.0,
      "elements": [
        { "id": "mp_b_expectations", "name": "Expectations", "desc": "Communicates and enforces high behavior expectations", "weight": 1 }
      ]
    }
  ],
  "createdAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-01T00:00:00Z",
  "createdBy": "system"
}
```

#### Danielson Template (Shortened)

```json
{
  "id": "danielson_v2026",
  "name": "Danielson Framework (standard)",
  "source": "Danielson",
  "version": "2026-01",
  "aggregationMode": "weighted",
  "defaultThresholds": { "green": 80, "yellow": 60, "red": 0 },
  "domains": [
    {
      "id": "dn_planning_preparation",
      "name": "Planning and Preparation",
      "weight": 1.0,
      "elements": [
        { "id": "dn_pp_content_pedagogy", "name": "Demonstrating Knowledge of Content and Pedagogy", "desc": "Deep content knowledge and pedagogy", "weight": 1 },
        { "id": "dn_pp_knowledge_students", "name": "Demonstrating Knowledge of Students", "desc": "Knows students' backgrounds and needs", "weight": 1 }
      ]
    },
    {
      "id": "dn_instruction",
      "name": "Instruction",
      "weight": 1.0,
      "elements": [
        { "id": "dn_i_communicate", "name": "Communicating with Students", "desc": "Clear communication and directions", "weight": 1 }
      ]
    }
  ],
  "createdAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-01T00:00:00Z",
  "createdBy": "system"
}
```

#### Roster Row Example

```json
{
  "teacherId": "t_001",
  "teacherName": "Sarah Johnson",
  "email": "sjohnson@school.test",
  "subjects": ["Mathematics", "Algebra"],
  "overallStatus": "green",
  "overallScore": 85,
  "columns": [
    { "columnId": "col_b", "columnName": "Instruction", "status": "green", "score": 88, "elementCount": 5 },
    { "columnId": "col_c", "columnName": "Assessment", "status": "yellow", "score": 72, "elementCount": 4 },
    { "columnId": "col_d", "columnName": "Environment", "status": "green", "score": 90, "elementCount": 3 },
    { "columnId": "col_e", "columnName": "Professional", "status": "green", "score": 85, "elementCount": 4 }
  ],
  "lastObservation": "2025-01-15T14:30:00Z",
  "hasMissingGrades": false
}
```

#### Teacher Detail Response Example

```json
{
  "teacher": {
    "id": "t_003",
    "name": "Michael Chen",
    "email": "mchen@school.test",
    "subjects": ["Science", "Physics"],
    "hireDate": "2019-08-15",
    "createdAt": "2019-08-15T00:00:00Z"
  },
  "overallScore": 68,
  "overallStatus": "yellow",
  "elements": [
    {
      "elementId": "dn_i_questioning",
      "elementCode": "3b",
      "elementName": "Using Questioning and Discussion Techniques",
      "domain": "Instruction",
      "score": 55,
      "rawScore": 2,
      "status": "red",
      "observationCount": 4,
      "lastObserved": "2025-01-10T10:00:00Z",
      "trend": "declining",
      "confidence": 0.85
    }
  ],
  "top4Problems": [
    {
      "elementId": "dn_i_questioning",
      "elementName": "Using Questioning and Discussion Techniques",
      "domain": "Instruction",
      "score": 55,
      "status": "red",
      "problemScore": 142.5,
      "reasons": ["Low score", "Declining trend"],
      "trend": "declining",
      "observationCount": 4
    }
  ],
  "observations": [
    {
      "id": "obs_001",
      "teacherId": "t_003",
      "elementId": "dn_i_questioning",
      "elementName": "Using Questioning and Discussion Techniques",
      "videoId": "vid_001",
      "timestamp": "00:12:45",
      "startTime": 765,
      "endTime": 810,
      "score": 50,
      "confidence": 0.82,
      "summary": "Teacher asked primarily closed-ended questions with limited wait time.",
      "evidence": "At 12:45, teacher posed a recall question and called on the first student to raise hand within 2 seconds.",
      "reviewStatus": "pending",
      "reviewedAt": null,
      "reviewedBy": null,
      "createdAt": "2025-01-10T10:30:00Z"
    }
  ],
  "trends": [
    { "date": "2024-09-01", "score": 72, "observationCount": 2 },
    { "date": "2024-10-01", "score": 70, "observationCount": 3 },
    { "date": "2024-11-01", "score": 68, "observationCount": 2 },
    { "date": "2024-12-01", "score": 65, "observationCount": 3 },
    { "date": "2025-01-01", "score": 68, "observationCount": 4 }
  ],
  "videos": [
    {
      "id": "vid_001",
      "teacherId": "t_003",
      "filename": "physics_101_jan10.mp4",
      "uploadedAt": "2025-01-10T08:00:00Z",
      "uploadedBy": "principal@school.test",
      "duration": 2700,
      "status": "completed",
      "observationCount": 8,
      "thumbnailUrl": "/thumbnails/vid_001.jpg"
    }
  ],
  "gradebookStatus": {
    "teacherId": "t_003",
    "connected": true,
    "lastSync": "2025-01-15T06:00:00Z",
    "hasMissingGrades": false,
    "missingClasses": []
  }
}
```

---

## 4. API Contract

### Authentication

#### POST /api/auth/login

Authenticate user and receive JWT token.

**Auth:** None (public)

**Request:**
```typescript
interface LoginRequest {
  email: string;
  password: string;
}
```

```json
{
  "email": "principal@school.test",
  "password": "P@ssw0rd!"
}
```

**Response (200):**
```typescript
interface LoginResponse {
  user: User;
  token: string;
  expiresAt: string;
}
```

```json
{
  "user": {
    "id": "u_001",
    "email": "principal@school.test",
    "name": "Principal Smith",
    "role": "principal",
    "createdAt": "2024-01-01T00:00:00Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2025-01-16T12:00:00Z"
}
```

**Errors:**
- `400 Bad Request` - Missing email or password
- `401 Unauthorized` - Invalid credentials
- `429 Too Many Requests` - Rate limited

```json
{
  "error": "INVALID_CREDENTIALS",
  "message": "Invalid email or password"
}
```

---

### Rubrics

#### GET /api/rubrics/templates

List all available rubric templates.

**Auth:** `principal`, `admin`

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `source` | string | - | Filter by source: `marshall`, `danielson`, `custom` |

**Response (200):**
```typescript
interface TemplatesResponse {
  templates: RubricTemplate[];
}
```

```json
{
  "templates": [
    {
      "id": "marshall_v2010",
      "name": "Marshall Rubric (Kim Marshall, 2010)",
      "source": "Marshall",
      "version": "2010-01-18",
      "aggregationMode": "weighted",
      "defaultThresholds": { "green": 80, "yellow": 60, "red": 0 },
      "domains": [...],
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z",
      "createdBy": "system"
    },
    {
      "id": "danielson_v2026",
      "name": "Danielson Framework (standard)",
      "source": "Danielson",
      ...
    }
  ]
}
```

---

#### GET /api/rubrics/elements

Get all elements, optionally filtered by template.

**Auth:** `principal`, `admin`

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `templateId` | string | - | Filter elements to specific template |
| `includeAll` | boolean | false | Include all Marshall + Danielson elements (for Customize) |

**Response (200):**
```typescript
interface ElementsResponse {
  elements: RubricElement[];
  domains: { id: string; name: string; source: string }[];
}
```

```json
{
  "elements": [
    {
      "id": "mp_a_knowledge",
      "name": "Knowledge",
      "desc": "Expertise in subject and child development",
      "weight": 1,
      "domainId": "planning_preparation",
      "domainName": "Planning and Preparation for Learning",
      "source": "marshall"
    },
    {
      "id": "dn_pp_content_pedagogy",
      "name": "Demonstrating Knowledge of Content and Pedagogy",
      "desc": "Deep content knowledge and pedagogy",
      "weight": 1,
      "domainId": "dn_planning_preparation",
      "domainName": "Planning and Preparation",
      "source": "danielson"
    }
  ],
  "domains": [
    { "id": "planning_preparation", "name": "Planning and Preparation for Learning", "source": "marshall" },
    { "id": "dn_planning_preparation", "name": "Planning and Preparation", "source": "danielson" }
  ]
}
```

---

#### POST /api/rubrics/templates

Create or update a custom rubric template.

**Auth:** `principal`, `admin`

**Request:**
```typescript
interface CreateTemplateRequest {
  id?: string;              // If updating existing
  name: string;
  aggregationMode: AggregationMode;
  elementIds: string[];     // Selected element IDs
  customElements?: {        // New custom elements
    name: string;
    desc: string;
    weight: number;
  }[];
  columns: {
    name: string;
    position: number;
    elementIds: string[];
  }[];
}
```

```json
{
  "name": "Custom Framework 2025",
  "aggregationMode": "weighted",
  "elementIds": ["mp_a_knowledge", "mp_c_clarity", "dn_i_questioning"],
  "customElements": [
    {
      "name": "Technology Integration",
      "desc": "Effective use of educational technology",
      "weight": 1
    }
  ],
  "columns": [
    { "name": "Instruction", "position": 0, "elementIds": ["mp_c_clarity", "dn_i_questioning"] },
    { "name": "Planning", "position": 1, "elementIds": ["mp_a_knowledge"] },
    { "name": "Technology", "position": 2, "elementIds": ["custom_tech_001"] },
    { "name": "Professional", "position": 3, "elementIds": [] }
  ]
}
```

**Response (201):**
```json
{
  "template": {
    "id": "custom_2025_001",
    "name": "Custom Framework 2025",
    "source": "Custom",
    ...
  }
}
```

**Errors:**
- `400 Bad Request` - Invalid element IDs or missing required fields
- `409 Conflict` - Template name already exists

---

### Roster

#### GET /api/roster

Get teacher roster with aggregated scores.

**Auth:** `principal`, `observer`, `admin`

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `templateId` | string | active | Template ID or "active" for current |
| `status` | string | - | Filter: `green`, `yellow`, `red` (comma-separated) |
| `subjects` | string | - | Filter by subjects (comma-separated) |
| `search` | string | - | Search by teacher name |
| `sortBy` | string | `name` | Sort field: `name`, `overall`, `col_b`, `col_c`, `col_d`, `col_e` |
| `sortDir` | string | `asc` | Sort direction: `asc`, `desc` |
| `page` | number | 1 | Page number |
| `pageSize` | number | 20 | Items per page |

**Example Request:**
```
GET /api/roster?templateId=active&status=yellow,red&sortBy=overall&sortDir=asc&page=1
```

**Response (200):**
```typescript
interface RosterResponse {
  rows: RosterRow[];
  columns: TemplateColumn[];
  thresholds: Thresholds;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
```

```json
{
  "rows": [
    {
      "teacherId": "t_003",
      "teacherName": "Michael Chen",
      "email": "mchen@school.test",
      "subjects": ["Science", "Physics"],
      "overallStatus": "yellow",
      "overallScore": 68,
      "columns": [
        { "columnId": "col_b", "columnName": "Instruction", "status": "red", "score": 55, "elementCount": 5 },
        { "columnId": "col_c", "columnName": "Assessment", "status": "yellow", "score": 70, "elementCount": 4 },
        { "columnId": "col_d", "columnName": "Environment", "status": "green", "score": 82, "elementCount": 3 },
        { "columnId": "col_e", "columnName": "Professional", "status": "yellow", "score": 65, "elementCount": 4 }
      ],
      "lastObservation": "2025-01-10T10:00:00Z",
      "hasMissingGrades": false
    }
  ],
  "columns": [
    { "id": "col_b", "name": "Instruction", "position": 0, "elementIds": [...] },
    { "id": "col_c", "name": "Assessment", "position": 1, "elementIds": [...] },
    { "id": "col_d", "name": "Environment", "position": 2, "elementIds": [...] },
    { "id": "col_e", "name": "Professional", "position": 3, "elementIds": [...] }
  ],
  "thresholds": { "green": 80, "yellow": 60, "red": 0 },
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 8,
    "totalPages": 1
  }
}
```

---

### Teacher Detail

#### GET /api/teachers/:id/detail

Get comprehensive teacher detail with elements, observations, and trends.

**Auth:** `principal`, `observer`, `admin`, `teacher` (own record only)

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Teacher ID |

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `templateId` | string | active | Template for element mapping |
| `start` | string | 6 months ago | Trend start date (ISO) |
| `end` | string | today | Trend end date (ISO) |
| `detailMode` | string | `priority` | `priority` (top 4) or `auto` (AI selected) |

**Example Request:**
```
GET /api/teachers/t_003/detail?templateId=active&start=2024-07-01&end=2025-01-15
```

**Response (200):**
```typescript
interface TeacherDetailResponse {
  teacher: Teacher;
  overallScore: number;
  overallStatus: StatusColor;
  elements: AssessmentElement[];
  top4Problems: ProblemElement[];
  observations: AIObservation[];
  trends: TrendDataPoint[];
  videos: VideoEvidence[];
  gradebookStatus: GradebookStatus;
}
```

*(See full example in Section 3)*

**Errors:**
- `404 Not Found` - Teacher not found
- `403 Forbidden` - Teacher accessing another teacher's record

---

### Gradebook

#### GET /api/gradebook/status

Get gradebook status for teachers.

**Auth:** `principal`, `observer`, `admin`

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `teacherIds` | string | Comma-separated teacher IDs |

**Example Request:**
```
GET /api/gradebook/status?teacherIds=t_001,t_002,t_003,t_006
```

**Response (200):**
```typescript
interface GradebookStatusResponse {
  statuses: GradebookStatus[];
}
```

```json
{
  "statuses": [
    {
      "teacherId": "t_001",
      "connected": true,
      "lastSync": "2025-01-15T06:00:00Z",
      "hasMissingGrades": false,
      "missingClasses": []
    },
    {
      "teacherId": "t_006",
      "connected": true,
      "lastSync": "2025-01-15T06:00:00Z",
      "hasMissingGrades": true,
      "missingClasses": ["English 101 - Period 2", "English 101 - Period 5"]
    }
  ]
}
```

---

### Video Upload

#### POST /api/video/upload

Upload video for AI analysis (stub).

**Auth:** `principal`, `observer`, `admin`

**Request:** `multipart/form-data`
| Field | Type | Description |
|-------|------|-------------|
| `file` | File | Video file (mp4, mov, webm) |
| `teacherId` | string | Teacher ID |

**Response (202):**
```json
{
  "videoId": "vid_new_001",
  "status": "accepted",
  "message": "Video queued for AI analysis"
}
```

**Errors:**
- `400 Bad Request` - Invalid file type or missing teacherId
- `413 Payload Too Large` - File exceeds limit (500MB)

---

### AI Review

#### POST /api/ai/review

Accept, reject, or edit an AI observation.

**Auth:** `principal`, `admin`

**Request:**
```typescript
interface AIReviewRequest {
  observationId: string;
  action: 'accept' | 'reject' | 'edit';
  reason?: string;        // Required for reject
  newScore?: number;      // Required for edit (0-100)
  newEvidence?: string;   // Optional for edit
}
```

```json
{
  "observationId": "obs_001",
  "action": "edit",
  "newScore": 60,
  "newEvidence": "Teacher asked mostly closed questions but showed some improvement with wait time."
}
```

**Response (200):**
```json
{
  "observation": {
    "id": "obs_001",
    "reviewStatus": "edited",
    "score": 60,
    "originalScore": 50,
    "evidence": "Teacher asked mostly closed questions but showed some improvement with wait time.",
    "reviewedAt": "2025-01-15T14:00:00Z",
    "reviewedBy": "u_001"
  }
}
```

**Errors:**
- `400 Bad Request` - Missing required fields for action
- `404 Not Found` - Observation not found
- `409 Conflict` - Observation already reviewed

---

### Audit

#### GET /api/audit

Get audit log entries.

**Auth:** `principal`, `admin`

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `targetType` | string | - | Filter: `observation`, `template`, `settings`, `video` |
| `targetId` | string | - | Filter by specific target ID |
| `userId` | string | - | Filter by user who made change |
| `start` | string | 30 days ago | Start date |
| `end` | string | today | End date |
| `page` | number | 1 | Page number |
| `pageSize` | number | 50 | Items per page |

**Response (200):**
```json
{
  "entries": [
    {
      "id": "audit_001",
      "userId": "u_001",
      "userName": "Principal Smith",
      "action": "observation_edited",
      "targetType": "observation",
      "targetId": "obs_001",
      "details": {
        "previousScore": 50,
        "newScore": 60,
        "teacherId": "t_003"
      },
      "createdAt": "2025-01-15T14:00:00Z"
    }
  ],
  "pagination": { ... }
}
```

---

### Settings

#### GET /api/settings/thresholds

Get current color thresholds.

**Auth:** `principal`, `admin`

**Response (200):**
```json
{
  "thresholds": {
    "green": 80,
    "yellow": 60,
    "red": 0
  },
  "aggregationMode": "weighted"
}
```

#### PUT /api/settings/thresholds

Update color thresholds.

**Auth:** `principal`, `admin`

**Request:**
```json
{
  "thresholds": {
    "green": 85,
    "yellow": 65
  },
  "aggregationMode": "weighted"
}
```

**Response (200):**
```json
{
  "thresholds": {
    "green": 85,
    "yellow": 65,
    "red": 0
  },
  "aggregationMode": "weighted",
  "updatedAt": "2025-01-15T14:30:00Z"
}
```

**Errors:**
- `400 Bad Request` - Invalid threshold values (green must be > yellow)

---

## 5. Data Mapping

### API to Component Mapping

| API Endpoint | Response Type | Consuming Components |
|-------------|---------------|---------------------|
| `POST /api/auth/login` | `LoginResponse` | `LoginForm` → `AuthContext` |
| `GET /api/dashboard/summary` | `DashboardSummary` | `DashboardPage`, `StatsCardGrid`, `DistributionChart` |
| `GET /api/rubrics/templates` | `TemplatesResponse` | `FrameworkSelectionPage`, `FrameworkOptionCard` |
| `GET /api/rubrics/elements` | `ElementsResponse` | `ElementAssignmentPage`, `ElementSourcePanel`, `ElementLibrary` |
| `POST /api/rubrics/templates` | `{ template }` | `CustomizeDialog`, `ElementAssignmentPage` |
| `GET /api/roster` | `RosterResponse` | `RosterPage`, `RosterTable`, `RosterRow`, `ColorChip` |
| `GET /api/teachers/:id/detail` | `TeacherDetailResponse` | `TeacherDashboardPage`, all sub-components |
| `GET /api/gradebook/status` | `GradebookStatusResponse` | `RosterPage` (merges with rows), `GradebookStatusCard` |
| `POST /api/video/upload` | `VideoUploadResponse` | `VideoUploadDialog` |
| `POST /api/ai/review` | `{ observation }` | `ObservationCard` |
| `GET /api/audit` | `PaginatedResponse<AuditEntry>` | `AuditLogPanel` |
| `GET /api/settings/thresholds` | `ThresholdsResponse` | `SettingsPage`, `RosterPage` (context) |

### State Flow

```
AuthContext
  └── user, token, login(), logout()
       └── Used by: ProtectedRoute, AppShell, all authenticated components

ThresholdsContext
  └── thresholds, aggregationMode, updateThresholds()
       └── Used by: RosterPage, TeacherDashboardPage, SettingsPage

TemplateContext
  └── activeTemplate, columns, setActiveTemplate()
       └── Used by: FrameworkSelectionPage, ElementAssignmentPage, RosterPage
```

---

## 6. Pseudocode & Algorithms

### Score Normalization

Marshall and Danielson rubrics use a 4-level scale. Normalize to 0-100:

```typescript
// Normalization mapping (applied at ingest/seed time)
const SCORE_NORMALIZATION: Record<number, number> = {
  4: 100,  // Highly Effective / Distinguished
  3: 80,   // Effective / Proficient
  2: 60,   // Needs Improvement / Basic
  1: 40,   // Unsatisfactory / Unsatisfactory
};

function normalizeScore(rawScore: number): number {
  if (rawScore < 1 || rawScore > 4) {
    throw new Error(`Invalid raw score: ${rawScore}`);
  }
  // Linear interpolation for decimal scores
  const lower = Math.floor(rawScore);
  const upper = Math.ceil(rawScore);
  const fraction = rawScore - lower;

  return SCORE_NORMALIZATION[lower] +
    fraction * (SCORE_NORMALIZATION[upper] - SCORE_NORMALIZATION[lower]);
}

function denormalizeScore(normalizedScore: number): number {
  // Reverse mapping for display
  if (normalizedScore >= 90) return 4;
  if (normalizedScore >= 70) return 3;
  if (normalizedScore >= 50) return 2;
  return 1;
}
```

### Color Mapping

```typescript
function scoreToColor(
  score: number,
  thresholds: Thresholds
): StatusColor {
  if (score >= thresholds.green) return 'green';
  if (score >= thresholds.yellow) return 'yellow';
  return 'red';
}

// Default thresholds
const DEFAULT_THRESHOLDS: Thresholds = {
  green: 80,
  yellow: 60,
  red: 0,
};
```

### Aggregation Algorithms

```typescript
type AggregationMode = 'weighted' | 'worst_score' | 'majority_color';

interface ElementScore {
  score: number;
  weight: number;
}

function aggregateScores(
  elementScores: ElementScore[],
  mode: AggregationMode,
  thresholds: Thresholds
): { score: number; status: StatusColor } {

  if (elementScores.length === 0) {
    return { score: 0, status: 'gray' };
  }

  let aggregatedScore: number;

  switch (mode) {
    case 'weighted': {
      // Weighted average (default)
      const totalWeight = elementScores.reduce((sum, e) => sum + e.weight, 0);
      const weightedSum = elementScores.reduce(
        (sum, e) => sum + e.score * e.weight,
        0
      );
      aggregatedScore = weightedSum / totalWeight;
      break;
    }

    case 'worst_score': {
      // Return lowest score in the set
      aggregatedScore = Math.min(...elementScores.map(e => e.score));
      break;
    }

    case 'majority_color': {
      // Count colors, return color with most elements
      const colorCounts: Record<StatusColor, number> = {
        green: 0, yellow: 0, red: 0, gray: 0
      };

      for (const e of elementScores) {
        const color = scoreToColor(e.score, thresholds);
        colorCounts[color]++;
      }

      // Find majority (ties go to worse color)
      if (colorCounts.red >= colorCounts.yellow && colorCounts.red >= colorCounts.green) {
        return { score: 50, status: 'red' };  // Representative score
      }
      if (colorCounts.yellow >= colorCounts.green) {
        return { score: 70, status: 'yellow' };
      }
      return { score: 85, status: 'green' };
    }

    default:
      throw new Error(`Unknown aggregation mode: ${mode}`);
  }

  return {
    score: Math.round(aggregatedScore * 10) / 10,
    status: scoreToColor(aggregatedScore, thresholds),
  };
}
```

### Top 4 Problematic Elements Algorithm

**Configuration Knobs:**
```typescript
interface ProblemScoreConfig {
  deltaMultiplier: number;    // Weight for score decline (default: 2)
  deficitMultiplier: number;  // Weight for distance from green (default: 1.2)
  freqMultiplier: number;     // Weight for observation frequency (default: 5)
  confidenceFactor: number;   // AI confidence weight (default: 0.2)
}

const DEFAULT_CONFIG: ProblemScoreConfig = {
  deltaMultiplier: 2,
  deficitMultiplier: 1.2,
  freqMultiplier: 5,
  confidenceFactor: 0.2,
};
```

**Algorithm:**
```typescript
interface ElementWithHistory {
  elementId: string;
  elementName: string;
  domain: string;
  currentScore: number;
  previousScore: number | null;  // Score from previous period
  observationCount: number;
  averageConfidence: number;
  trend: TrendDirection;
}

function computeProblemScore(
  element: ElementWithHistory,
  thresholds: Thresholds,
  config: ProblemScoreConfig = DEFAULT_CONFIG
): number {
  const { currentScore, previousScore, observationCount, averageConfidence } = element;

  // 1. Base deficit score: how far below green threshold
  const deficit = Math.max(0, thresholds.green - currentScore);
  const deficitScore = deficit * config.deficitMultiplier;

  // 2. Delta score: decline from previous period
  let deltaScore = 0;
  if (previousScore !== null && previousScore > currentScore) {
    const decline = previousScore - currentScore;
    deltaScore = decline * config.deltaMultiplier;
  }

  // 3. Frequency score: more observations = more reliable signal
  // Capped at 10 observations
  const freqScore = Math.min(observationCount, 10) * config.freqMultiplier;

  // 4. Confidence adjustment: higher confidence = more weight
  const confidenceBoost = averageConfidence * config.confidenceFactor * 100;

  // 5. Status multiplier: red elements get priority
  const status = scoreToColor(currentScore, thresholds);
  const statusMultiplier = status === 'red' ? 1.5 : status === 'yellow' ? 1.0 : 0.5;

  // Final problem score
  const rawScore = (deficitScore + deltaScore + freqScore + confidenceBoost) * statusMultiplier;

  return Math.round(rawScore * 10) / 10;
}

function getTop4ProblematicElements(
  elements: ElementWithHistory[],
  thresholds: Thresholds,
  mode: 'priority' | 'auto' = 'priority',
  config: ProblemScoreConfig = DEFAULT_CONFIG
): ProblemElement[] {

  // Calculate problem scores for all elements
  const scored = elements.map(e => ({
    ...e,
    problemScore: computeProblemScore(e, thresholds, config),
    status: scoreToColor(e.currentScore, thresholds),
    reasons: buildReasons(e, thresholds),
  }));

  // Filter to only yellow/red elements
  const problematic = scored.filter(e => e.status !== 'green');

  // Sort by problem score descending
  problematic.sort((a, b) => b.problemScore - a.problemScore);

  if (mode === 'priority') {
    // Priority mode: top 4 by problem score
    return problematic.slice(0, 4).map(e => ({
      elementId: e.elementId,
      elementName: e.elementName,
      domain: e.domain,
      score: e.currentScore,
      status: e.status as 'yellow' | 'red',
      problemScore: e.problemScore,
      reasons: e.reasons,
      trend: e.trend,
      observationCount: e.observationCount,
    }));
  } else {
    // Auto mode: AI-selected based on confidence and recency
    // Prioritize elements with recent high-confidence observations
    const withRecency = problematic.map(e => ({
      ...e,
      autoScore: e.problemScore * (e.averageConfidence + 0.5),
    }));
    withRecency.sort((a, b) => b.autoScore - a.autoScore);
    return withRecency.slice(0, 4).map(e => ({
      elementId: e.elementId,
      elementName: e.elementName,
      domain: e.domain,
      score: e.currentScore,
      status: e.status as 'yellow' | 'red',
      problemScore: e.problemScore,
      reasons: e.reasons,
      trend: e.trend,
      observationCount: e.observationCount,
    }));
  }
}

function buildReasons(
  element: ElementWithHistory,
  thresholds: Thresholds
): string[] {
  const reasons: string[] = [];

  if (element.currentScore < thresholds.yellow) {
    reasons.push('Low score');
  }

  if (element.previousScore !== null && element.currentScore < element.previousScore) {
    reasons.push('Declining performance');
  }

  if (element.observationCount >= 3 && element.currentScore < thresholds.green) {
    reasons.push('Consistently below target');
  }

  return reasons;
}
```

### AI Stub Worker

```typescript
// server/src/workers/aiStubWorker.ts

interface VideoMetadata {
  id: string;
  teacherId: string;
  duration: number;
  tags?: string[];  // Metadata tags for deterministic mapping
}

interface GeneratedObservation {
  elementId: string;
  startTime: number;
  endTime: number;
  score: number;
  confidence: number;
  summary: string;
  evidence: string;
}

// Deterministic element mapping based on video segment
const ELEMENT_MAPPING: Record<string, string[]> = {
  'introduction': ['dn_i_communicate', 'mp_c_goals'],
  'lecture': ['dn_pp_content_pedagogy', 'mp_c_clarity'],
  'questioning': ['dn_i_questioning', 'mp_d_on_the_spot'],
  'group_work': ['dn_i_engaging', 'mp_c_engagement'],
  'assessment': ['dn_i_assessment', 'mp_d_diagnosis'],
  'closure': ['dn_i_communicate', 'mp_c_application'],
};

// Deterministic scoring based on segment position and teacher seed
function generateDeterministicScore(
  teacherId: string,
  segmentIndex: number,
  elementId: string
): number {
  // Hash-based deterministic score
  const hash = simpleHash(`${teacherId}-${segmentIndex}-${elementId}`);
  const baseScore = 50 + (hash % 50);  // 50-100 range

  // Apply teacher-specific modifier from seed data
  const teacherModifier = getTeacherModifier(teacherId);

  return Math.min(100, Math.max(40, baseScore + teacherModifier));
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

async function processVideo(video: VideoMetadata): Promise<GeneratedObservation[]> {
  const observations: GeneratedObservation[] = [];

  // Divide video into 5-minute segments
  const segmentDuration = 300;  // 5 minutes
  const segmentCount = Math.ceil(video.duration / segmentDuration);

  // Segment type pattern (deterministic based on video ID)
  const segmentTypes = ['introduction', 'lecture', 'questioning', 'group_work', 'assessment', 'closure'];

  for (let i = 0; i < Math.min(segmentCount, 6); i++) {
    const segmentType = segmentTypes[i % segmentTypes.length];
    const elementIds = ELEMENT_MAPPING[segmentType] || ['dn_i_communicate'];

    for (const elementId of elementIds) {
      const score = generateDeterministicScore(video.teacherId, i, elementId);
      const confidence = 0.7 + (simpleHash(`${video.id}-${i}-conf`) % 25) / 100;

      observations.push({
        elementId,
        startTime: i * segmentDuration,
        endTime: Math.min((i + 1) * segmentDuration, video.duration),
        score,
        confidence: Math.round(confidence * 100) / 100,
        summary: generateSummary(elementId, score, segmentType),
        evidence: generateEvidence(elementId, i * segmentDuration, score),
      });
    }
  }

  return observations;
}

function generateSummary(elementId: string, score: number, segmentType: string): string {
  const quality = score >= 80 ? 'effectively' : score >= 60 ? 'adequately' : 'ineffectively';

  const templates: Record<string, string> = {
    'dn_i_questioning': `Teacher ${quality} used questioning techniques during ${segmentType}.`,
    'dn_i_communicate': `Teacher ${quality} communicated instructions during ${segmentType}.`,
    'dn_i_engaging': `Teacher ${quality} engaged students during ${segmentType}.`,
    // ... more templates
  };

  return templates[elementId] || `Element ${elementId} observed with score ${score}.`;
}

function generateEvidence(elementId: string, timestamp: number, score: number): string {
  const time = formatTimestamp(timestamp);
  return `At ${time}, observed behavior related to ${elementId}. Score: ${score}/100.`;
}

// Worker entry point
async function runWorker() {
  console.log('AI Stub Worker started');

  // Poll for unprocessed videos
  const pendingVideos = await db('videos')
    .where('status', 'pending')
    .select('*');

  for (const video of pendingVideos) {
    console.log(`Processing video: ${video.id}`);

    await db('videos').where('id', video.id).update({ status: 'processing' });

    try {
      const observations = await processVideo(video);

      // Insert observations
      for (const obs of observations) {
        await db('ai_observations').insert({
          id: generateId(),
          video_id: video.id,
          teacher_id: video.teacher_id,
          element_id: obs.elementId,
          start_time: obs.startTime,
          end_time: obs.endTime,
          score: obs.score,
          confidence: obs.confidence,
          summary: obs.summary,
          evidence: obs.evidence,
          review_status: 'pending',
          created_at: new Date().toISOString(),
        });
      }

      await db('videos').where('id', video.id).update({
        status: 'completed',
        observation_count: observations.length,
      });

      console.log(`Completed video: ${video.id}, generated ${observations.length} observations`);
    } catch (error) {
      await db('videos').where('id', video.id).update({ status: 'failed' });
      console.error(`Failed to process video: ${video.id}`, error);
    }
  }

  console.log('AI Stub Worker completed');
}
```

---

## 7. Acceptance Tests

### AT-1: Principal Login

```gherkin
Given I am on the login page
When I enter "principal@school.test" as email
And I enter "P@ssw0rd!" as password
And I click the "Sign In" button
Then I should be redirected to the dashboard
And I should see "Principal Smith" in the top navigation
And I should see the dashboard statistics
```

### AT-2: Framework Selection

```gherkin
Given I am logged in as principal
And I am on the framework selection page
When I click on the "Danielson Framework" option
Then the Danielson card should be highlighted as selected
And I should see a preview showing 4 domains and 22 elements
When I click "Continue to Element Assignment"
Then I should be on the element assignment page
```

### AT-3: Custom Framework Creation

```gherkin
Given I am logged in as principal
And I am on the framework selection page
When I click on the "Customize" option
Then a dialog should open showing all Marshall and Danielson elements
When I select "Knowledge" from Marshall
And I select "Using Questioning and Discussion Techniques" from Danielson
And I click "Add Custom Element"
And I enter "Technology Integration" as name
And I enter "Effective use of educational technology" as description
And I click "Add"
And I click "Save Template"
Then my custom template should be created
And I should see a success message
```

### AT-4: Element Assignment via Keyboard

```gherkin
Given I am logged in as principal
And I am on the element assignment page with Danielson template
When I focus on element "Communicating with Students"
And I press Enter
Then a column selection dialog should appear
When I select "Metric B (Instruction)" and press Enter
Then the element should appear in the "Instruction" column
And a screen reader should announce "Element assigned to Instruction"
```

### AT-5: Roster Color Display

```gherkin
Given I am logged in as principal
And there are 8 teachers with varied performance
When I navigate to the roster page
Then I should see 8 teacher rows
And each row should display color chips (green, yellow, or red) for each metric column
And I should NOT see numeric scores directly in the cells
When I hover over a green chip
Then I should see a tooltip showing the numeric score and last observation date
```

### AT-6: Roster Filtering

```gherkin
Given I am logged in as principal
And I am on the roster page
When I click the status filter
And I select "Yellow" and "Red"
Then only teachers with yellow or red overall status should be displayed
And the URL should reflect the filter parameters
When I clear the filters
Then all 8 teachers should be displayed
```

### AT-7: Teacher Dashboard View

```gherkin
Given I am logged in as principal
And I am on the roster page
When I click on teacher "Michael Chen" with yellow status
Then I should be redirected to Michael Chen's dashboard
And I should see an overall score of 68 displayed numerically
And I should see the "Priority Areas for Improvement" section
And I should see at least one element in the top 4 problems list
And I should see numeric scores for all elements in the Elements tab
```

### AT-8: AI Observation Review

```gherkin
Given I am logged in as principal
And I am viewing teacher "Michael Chen" dashboard
And there is a pending AI observation
When I click on the "AI Observations" tab
Then I should see observations with "pending" status
When I click "Accept" on an observation
Then the observation status should change to "accepted"
And an audit log entry should be created
When I click "Edit" on another observation
And I change the score to 65
And I update the evidence text
And I click "Save"
Then the observation should show status "edited"
And the original score should be preserved for audit
```

### AT-9: Gradebook Missing Grades Flag

```gherkin
Given I am logged in as principal
And teacher "nogrades@school.test" has missing grades
When I view the roster page
Then I should see a "missing grades" flag icon on that teacher's row
When I hover over the flag
Then I should see "Missing grades in gradebook"
When I click on that teacher to view their dashboard
Then I should see a "Gradebook Status" card
And it should show "Missing Grades: 2 classes"
```

### AT-10: Threshold Configuration

```gherkin
Given I am logged in as principal
And I am on the settings page
When I change the green threshold from 80 to 85
And I change the yellow threshold from 60 to 70
And I click "Save"
Then I should see a success message
When I navigate to the roster page
Then teachers with scores 80-84 should now show yellow instead of green
And teachers with scores 60-69 should now show red instead of yellow
```

---

## 8. Implementation Checklist

### Phase 1: MVP Core (Sprint 1-2)

**Sprint 1:**
- [ ] **Project Setup**
  - [ ] Initialize monorepo with client/server workspaces
  - [ ] Configure Vite, TypeScript, Material UI
  - [ ] Configure Express, TypeScript, Knex
  - [ ] Set up PostgreSQL with Docker Compose
  - [ ] Create database migrations
  - [ ] Seed rubric templates (Marshall, Danielson)
  - [ ] Seed teachers (8) and principal account

- [ ] **Authentication**
  - [ ] `POST /api/auth/login` endpoint
  - [ ] JWT middleware
  - [ ] `LoginPage` component
  - [ ] `AuthContext` provider
  - [ ] `ProtectedRoute` component

- [ ] **Dashboard**
  - [ ] `GET /api/dashboard/summary` endpoint
  - [ ] `DashboardPage` component
  - [ ] `StatsCardGrid` component
  - [ ] Basic `AppShell` with navigation

**Sprint 2:**
- [ ] **Roster**
  - [ ] `GET /api/roster` endpoint with aggregation
  - [ ] `RosterPage` component
  - [ ] `RosterTable` with sorting
  - [ ] `ColorChip` component with tooltips
  - [ ] Pagination

- [ ] **Teacher Detail (Basic)**
  - [ ] `GET /api/teachers/:id/detail` endpoint
  - [ ] `TeacherDashboardPage` component
  - [ ] `ElementScoresTable` component
  - [ ] `OverallScoreCard` component

### Phase 2: Framework & AI (Sprint 3-4)

**Sprint 3:**
- [ ] **Framework Selection**
  - [ ] `GET /api/rubrics/templates` endpoint
  - [ ] `FrameworkSelectionPage` component
  - [ ] `FrameworkOptionCard` component
  - [ ] `FrameworkPreview` component

- [ ] **Element Assignment**
  - [ ] `GET /api/rubrics/elements` endpoint
  - [ ] `POST /api/rubrics/templates` endpoint
  - [ ] `ElementAssignmentPage` component
  - [ ] Drag-and-drop functionality
  - [ ] Keyboard accessibility (dialog flow)

**Sprint 4:**
- [ ] **Customize Framework**
  - [ ] `CustomizeDialog` component
  - [ ] `ElementLibrary` component
  - [ ] `AddCustomElementForm` component
  - [ ] Combined Marshall + Danielson library

- [ ] **AI Observations**
  - [ ] `AIObservationsPanel` component
  - [ ] `ObservationCard` component
  - [ ] `POST /api/ai/review` endpoint
  - [ ] Accept/Reject/Edit flow
  - [ ] AI Stub Worker (`npm run worker`)

### Phase 3: Polish & Integration (Sprint 5-6)

**Sprint 5:**
- [ ] **Top 4 Problems**
  - [ ] Problem score algorithm implementation
  - [ ] `Top4ProblematicElements` component
  - [ ] Priority vs Auto detail modes

- [ ] **Trends & Charts**
  - [ ] `TrendChart` component (recharts)
  - [ ] Trend calculation in detail endpoint

- [ ] **Video Upload**
  - [ ] `POST /api/video/upload` stub
  - [ ] `VideoUploadDialog` component
  - [ ] `VideoEvidenceList` component

**Sprint 6:**
- [ ] **Gradebook Integration**
  - [ ] `GET /api/gradebook/status` stub
  - [ ] `GradebookFlag` component
  - [ ] `GradebookStatusCard` component

- [ ] **Settings & Audit**
  - [ ] `GET/PUT /api/settings/thresholds` endpoints
  - [ ] `SettingsPage` component
  - [ ] `GET /api/audit` endpoint
  - [ ] `AuditLogPanel` component

- [ ] **Testing & Polish**
  - [ ] Playwright E2E tests (10 acceptance tests)
  - [ ] Accessibility audit (WCAG 2.1 AA)
  - [ ] Performance optimization
  - [ ] Documentation

### Post-MVP Enhancements

- [ ] SSO integration (OAuth 2.0)
- [ ] Real AI model integration (replace stub)
- [ ] Real gradebook API integration
- [ ] Video storage (S3/Cloud Storage)
- [ ] Email notifications
- [ ] Export reports (PDF/CSV)
- [ ] Multi-school support
- [ ] Advanced analytics dashboard

---

## 9. Seed Data

### Database Tables

```sql
-- Users
CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Teachers
CREATE TABLE teachers (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  subjects TEXT[] NOT NULL,
  hire_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rubric Templates
CREATE TABLE rubric_templates (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  source VARCHAR(50) NOT NULL,
  version VARCHAR(50),
  aggregation_mode VARCHAR(50) DEFAULT 'weighted',
  default_thresholds JSONB NOT NULL,
  domains JSONB NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_by VARCHAR(36) REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Template Assignments (column configuration)
CREATE TABLE template_assignments (
  id VARCHAR(36) PRIMARY KEY,
  template_id VARCHAR(36) REFERENCES rubric_templates(id),
  columns JSONB NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Assessments (observation sessions)
CREATE TABLE assessments (
  id VARCHAR(36) PRIMARY KEY,
  teacher_id VARCHAR(36) REFERENCES teachers(id),
  template_id VARCHAR(36) REFERENCES rubric_templates(id),
  observer_id VARCHAR(36) REFERENCES users(id),
  observed_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Assessment Elements (individual element scores)
CREATE TABLE assessment_elements (
  id VARCHAR(36) PRIMARY KEY,
  assessment_id VARCHAR(36) REFERENCES assessments(id),
  element_id VARCHAR(100) NOT NULL,
  raw_score INTEGER NOT NULL,
  normalized_score INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Videos
CREATE TABLE videos (
  id VARCHAR(36) PRIMARY KEY,
  teacher_id VARCHAR(36) REFERENCES teachers(id),
  filename VARCHAR(255) NOT NULL,
  duration INTEGER NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  observation_count INTEGER DEFAULT 0,
  uploaded_by VARCHAR(36) REFERENCES users(id),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI Observations
CREATE TABLE ai_observations (
  id VARCHAR(36) PRIMARY KEY,
  video_id VARCHAR(36) REFERENCES videos(id),
  teacher_id VARCHAR(36) REFERENCES teachers(id),
  element_id VARCHAR(100) NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  score INTEGER NOT NULL,
  confidence DECIMAL(3,2) NOT NULL,
  summary TEXT NOT NULL,
  evidence TEXT NOT NULL,
  review_status VARCHAR(50) DEFAULT 'pending',
  reviewed_by VARCHAR(36) REFERENCES users(id),
  reviewed_at TIMESTAMP,
  rejection_reason TEXT,
  original_score INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit Log
CREATE TABLE audit_log (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id VARCHAR(36) NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Settings
CREATE TABLE settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Seed Data: Principal Account

```typescript
// seeds/001_users.ts
export async function seed(knex: Knex): Promise<void> {
  await knex('users').insert({
    id: 'u_001',
    email: 'principal@school.test',
    password_hash: await bcrypt.hash('P@ssw0rd!', 10),
    name: 'Principal Smith',
    role: 'principal',
    created_at: new Date().toISOString(),
  });
}
```

### Seed Data: Teachers

```typescript
// seeds/002_teachers.ts
const teachers = [
  {
    id: 't_001',
    name: 'Sarah Johnson',
    email: 'sjohnson@school.test',
    subjects: ['Mathematics', 'Algebra'],
    hire_date: '2018-08-15',
    // Seeded with GREEN overall (85+ scores)
  },
  {
    id: 't_002',
    name: 'James Williams',
    email: 'jwilliams@school.test',
    subjects: ['English', 'Literature'],
    hire_date: '2017-08-15',
    // Seeded with GREEN overall (80-85 scores)
  },
  {
    id: 't_003',
    name: 'Michael Chen',
    email: 'mchen@school.test',
    subjects: ['Science', 'Physics'],
    hire_date: '2019-08-15',
    // Seeded with YELLOW overall (68 score)
  },
  {
    id: 't_004',
    name: 'Emily Davis',
    email: 'edavis@school.test',
    subjects: ['History', 'Social Studies'],
    hire_date: '2020-08-15',
    // Seeded with YELLOW overall (72 score)
  },
  {
    id: 't_005',
    name: 'Robert Martinez',
    email: 'rmartinez@school.test',
    subjects: ['Art', 'Design'],
    hire_date: '2021-08-15',
    // Seeded with YELLOW overall (65 score)
  },
  {
    id: 't_006',
    name: 'Jennifer Thompson',
    email: 'nogrades@school.test',
    subjects: ['English', 'Writing'],
    hire_date: '2019-08-15',
    // Seeded with RED overall (55 score) + missing grades flag
  },
  {
    id: 't_007',
    name: 'David Kim',
    email: 'dkim@school.test',
    subjects: ['Computer Science', 'Programming'],
    hire_date: '2022-08-15',
    // Seeded with RED overall (52 score)
  },
  {
    id: 't_008',
    name: 'Amanda Wilson',
    email: 'awilson@school.test',
    subjects: ['Music', 'Band'],
    hire_date: '2016-08-15',
    // Seeded with GREEN overall (90+ scores)
  },
];
```

### Seed Data: Rubric Templates

*(Full Marshall and Danielson JSON blocks from requirements are inserted here)*

```typescript
// seeds/003_rubric_templates.ts
const marshallTemplate = {
  id: 'marshall_v2010',
  name: 'Marshall Rubric (Kim Marshall, 2010)',
  source: 'Marshall',
  version: '2010-01-18',
  aggregation_mode: 'weighted',
  default_thresholds: { green: 80, yellow: 60, red: 0 },
  domains: [
    // ... full 6 domains with 59 total elements as specified
  ],
  is_active: false,
  created_by: 'system',
};

const danielsonTemplate = {
  id: 'danielson_v2026',
  name: 'Danielson Framework (standard)',
  source: 'Danielson',
  version: '2026-01',
  aggregation_mode: 'weighted',
  default_thresholds: { green: 80, yellow: 60, red: 0 },
  domains: [
    // ... full 4 domains with 22 total elements as specified
  ],
  is_active: true,  // Default active template
  created_by: 'system',
};
```

### Seed Data: Default Thresholds

```typescript
// seeds/004_settings.ts
export async function seed(knex: Knex): Promise<void> {
  await knex('settings').insert({
    key: 'thresholds',
    value: JSON.stringify({
      green: 80,
      yellow: 60,
      red: 0,
    }),
  });

  await knex('settings').insert({
    key: 'aggregation_mode',
    value: JSON.stringify('weighted'),
  });
}
```

### Seed Data: Sample Assessments

```typescript
// seeds/005_assessments.ts
// Generate varied assessment scores for each teacher to produce:
// - 2 green teachers (t_001, t_002, t_008)
// - 3 yellow teachers (t_003, t_004, t_005)
// - 3 red teachers (t_006, t_007)

// For each teacher, generate 3-5 assessments over the past 6 months
// with element scores that produce the target overall color

const teacherScoreProfiles = {
  't_001': { min: 80, max: 95, trend: 'stable' },
  't_002': { min: 75, max: 90, trend: 'improving' },
  't_003': { min: 55, max: 80, trend: 'declining' },
  't_004': { min: 60, max: 85, trend: 'stable' },
  't_005': { min: 55, max: 75, trend: 'stable' },
  't_006': { min: 40, max: 65, trend: 'declining' },
  't_007': { min: 45, max: 60, trend: 'stable' },
  't_008': { min: 85, max: 100, trend: 'improving' },
};
```

---

## 10. Integration Notes & TODOs

### AI Model Integration

**Current:** Stub worker generates deterministic observations based on video metadata.

**Production TODO:**
```typescript
// Replace aiStubWorker.ts with:

// 1. Video frame extraction
import { extractFrames } from './videoProcessor';

// 2. AI model API call
async function analyzeWithAI(frames: Buffer[], elementLibrary: RubricElement[]) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4-vision-preview',
      messages: [
        {
          role: 'system',
          content: 'You are an expert teacher evaluator...',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this classroom video segment...' },
            ...frames.map(f => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${f.toString('base64')}` } })),
          ],
        },
      ],
    }),
  });
  // Parse and structure response...
}
```

**Security Considerations:**
- Store API key in environment variable
- Rate limit API calls
- Implement retry with exponential backoff
- Log all AI API calls for audit

### Gradebook Integration

**Current:** Stub returns hardcoded missing grades for `nogrades@school.test`.

**Production TODO:**
```typescript
// 1. OAuth 2.0 flow for gradebook provider (e.g., PowerSchool, Canvas)
// 2. API client for gradebook data

interface GradebookProvider {
  name: string;
  authUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
  scopes: string[];
}

async function fetchGradebookStatus(
  teacherId: string,
  accessToken: string
): Promise<GradebookStatus> {
  // Call gradebook API
  const response = await gradebookClient.get('/teachers/:id/missing-grades', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return {
    teacherId,
    connected: true,
    lastSync: new Date().toISOString(),
    hasMissingGrades: response.data.missingCount > 0,
    missingClasses: response.data.classes,
  };
}
```

**Security Considerations:**
- Secure OAuth token storage
- Refresh token rotation
- Scope limitation (read-only gradebook access)
- Data minimization (only fetch needed fields)

### Video Storage

**Current:** Videos stored locally in `uploads/` directory.

**Production TODO:**
```typescript
// 1. Use presigned URLs for direct upload to S3/GCS

async function getUploadUrl(filename: string, teacherId: string) {
  const key = `videos/${teacherId}/${Date.now()}-${filename}`;

  const command = new PutObjectCommand({
    Bucket: process.env.VIDEO_BUCKET,
    Key: key,
    ContentType: 'video/mp4',
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  return { uploadUrl, videoKey: key };
}

// 2. Trigger AI processing via queue (SQS/Cloud Tasks)
async function queueVideoProcessing(videoId: string) {
  await sqs.sendMessage({
    QueueUrl: process.env.VIDEO_QUEUE_URL,
    MessageBody: JSON.stringify({ videoId }),
  });
}
```

**Security Considerations:**
- Presigned URL expiration
- File type validation
- Virus scanning before processing
- Access control on S3 bucket
- Encryption at rest

### SSO Integration

**Current:** Email/password authentication only.

**Production TODO:**
```typescript
// 1. Add OAuth 2.0 providers (Google, Microsoft)

// routes/auth.ts
router.get('/auth/google', passport.authenticate('google', {
  scope: ['email', 'profile'],
}));

router.get('/auth/google/callback',
  passport.authenticate('google', { session: false }),
  (req, res) => {
    const token = generateJWT(req.user);
    res.redirect(`/auth/callback?token=${token}`);
  }
);

// 2. SAML for enterprise SSO
// Configure with passport-saml for district SSO
```

**Security Considerations:**
- Validate OAuth state parameter
- Verify email domain for auto-provisioning
- Map external roles to internal roles
- Session invalidation on logout

### Environment Variables

```bash
# .env.production

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Authentication
JWT_SECRET=<random-256-bit-secret>
JWT_EXPIRES_IN=24h

# AI Integration (TODO: Replace stub)
OPENAI_API_KEY=sk-...
AI_MODEL=gpt-4-vision-preview

# Gradebook Integration (TODO: Replace stub)
GRADEBOOK_PROVIDER=powerschool
GRADEBOOK_CLIENT_ID=...
GRADEBOOK_CLIENT_SECRET=...

# Video Storage (TODO: Replace local)
AWS_REGION=us-east-1
VIDEO_BUCKET=teacher-assessment-videos
VIDEO_QUEUE_URL=https://sqs...

# SSO (TODO: Add OAuth)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
```

---

## Appendix: Full Rubric Seeds

### Marshall Rubric (Complete)

```json
{
  "id": "marshall_v2010",
  "name": "Marshall Rubric (Kim Marshall, 2010)",
  "source": "Marshall",
  "version": "2010-01-18",
  "aggregation_mode": "weighted",
  "default_thresholds": { "green": 80, "yellow": 60, "red": 0 },
  "domains": [
    {
      "id": "planning_preparation",
      "name": "Planning and Preparation for Learning",
      "weight": 1.0,
      "elements": [
        { "id": "mp_a_knowledge", "name": "Knowledge", "desc": "Expertise in subject and child development", "weight": 1 },
        { "id": "mp_a_strategy", "name": "Strategy", "desc": "Year plan aligned with standards and assessments", "weight": 1 },
        { "id": "mp_a_alignment", "name": "Alignment", "desc": "Backward planning aligned to standards and Bloom", "weight": 1 },
        { "id": "mp_a_assessments", "name": "Assessments", "desc": "Diagnostic, interim, summative assessments planned", "weight": 1 },
        { "id": "mp_a_anticipation", "name": "Anticipation", "desc": "Anticipates misconceptions and plans responses", "weight": 1 },
        { "id": "mp_a_lessons", "name": "Lessons", "desc": "Clear measurable lesson goals aligned to standards", "weight": 1 },
        { "id": "mp_a_engagement", "name": "Engagement", "desc": "Designs lessons to motivate and engage all students", "weight": 1 },
        { "id": "mp_a_materials", "name": "Materials", "desc": "Uses high-quality, multicultural materials", "weight": 1 },
        { "id": "mp_a_differentiation", "name": "Differentiation", "desc": "Addresses diverse learning needs and styles", "weight": 1 },
        { "id": "mp_a_environment", "name": "Environment", "desc": "Uses room arrangement and displays to support learning", "weight": 1 }
      ]
    },
    {
      "id": "classroom_management",
      "name": "Classroom Management",
      "weight": 1.0,
      "elements": [
        { "id": "mp_b_expectations", "name": "Expectations", "desc": "Communicates and enforces high behavior expectations", "weight": 1 },
        { "id": "mp_b_relationships", "name": "Relationships", "desc": "Builds warm, respectful relationships with students", "weight": 1 },
        { "id": "mp_b_respect", "name": "Respect", "desc": "Commands respect and minimizes disruption", "weight": 1 },
        { "id": "mp_b_social_emotional", "name": "Social Emotional", "desc": "Develops positive interactions and social skills", "weight": 1 },
        { "id": "mp_b_routines", "name": "Routines", "desc": "Teaches and maintains classroom routines", "weight": 1 },
        { "id": "mp_b_responsibility", "name": "Responsibility", "desc": "Develops student self-discipline and responsibility", "weight": 1 },
        { "id": "mp_b_repertoire", "name": "Repertoire", "desc": "Has a wide repertoire of discipline and engagement moves", "weight": 1 },
        { "id": "mp_b_efficiency", "name": "Efficiency", "desc": "Maximizes instructional time and transitions", "weight": 1 },
        { "id": "mp_b_prevention", "name": "Prevention", "desc": "Anticipates and nips discipline problems in the bud", "weight": 1 },
        { "id": "mp_b_incentives", "name": "Incentives", "desc": "Uses incentives linked to intrinsic motivation", "weight": 1 }
      ]
    },
    {
      "id": "delivery_instruction",
      "name": "Delivery of Instruction",
      "weight": 1.0,
      "elements": [
        { "id": "mp_c_expectations", "name": "Expectations", "desc": "Sets and communicates high expectations", "weight": 1 },
        { "id": "mp_c_effort", "name": "Effort-Based", "desc": "Encourages effort and learning from mistakes", "weight": 1 },
        { "id": "mp_c_goals", "name": "Goals", "desc": "Posts essential questions, goals, and exemplars", "weight": 1 },
        { "id": "mp_c_connections", "name": "Connections", "desc": "Makes connections to prior knowledge", "weight": 1 },
        { "id": "mp_c_clarity", "name": "Clarity", "desc": "Presents material clearly with good examples", "weight": 1 },
        { "id": "mp_c_repertoire", "name": "Repertoire", "desc": "Uses varied strategies and groupings", "weight": 1 },
        { "id": "mp_c_engagement", "name": "Engagement", "desc": "Gets students actively involved", "weight": 1 },
        { "id": "mp_c_differentiation", "name": "Differentiation", "desc": "Differentiates and scaffolds for diverse learners", "weight": 1 },
        { "id": "mp_c_nimbleness", "name": "Nimbleness", "desc": "Adapts lessons to teachable moments", "weight": 1 },
        { "id": "mp_c_application", "name": "Application", "desc": "Has students apply learning to real life", "weight": 1 }
      ]
    },
    {
      "id": "monitoring_assessment",
      "name": "Monitoring Assessment and Follow-Up",
      "weight": 1.0,
      "elements": [
        { "id": "mp_d_criteria", "name": "Criteria", "desc": "Posts and reviews criteria for proficient work", "weight": 1 },
        { "id": "mp_d_diagnosis", "name": "Diagnosis", "desc": "Uses diagnostic assessments to fine-tune instruction", "weight": 1 },
        { "id": "mp_d_on_the_spot", "name": "On-the-Spot", "desc": "Checks for understanding and clarifies", "weight": 1 },
        { "id": "mp_d_self_assessment", "name": "Self-Assessment", "desc": "Has students set goals and self-assess", "weight": 1 },
        { "id": "mp_d_recognition", "name": "Recognition", "desc": "Posts student work and uses it to motivate", "weight": 1 },
        { "id": "mp_d_interims", "name": "Interims", "desc": "Uses interim data to adjust instruction", "weight": 1 },
        { "id": "mp_d_tenacity", "name": "Tenacity", "desc": "Relentlessly follows up with struggling students", "weight": 1 },
        { "id": "mp_d_support", "name": "Support", "desc": "Ensures students receive specialized services", "weight": 1 },
        { "id": "mp_d_analysis", "name": "Analysis", "desc": "Analyzes assessment data with colleagues", "weight": 1 },
        { "id": "mp_d_reflection", "name": "Reflection", "desc": "Reflects and improves instruction with colleagues", "weight": 1 }
      ]
    },
    {
      "id": "family_community",
      "name": "Family and Community Outreach",
      "weight": 1.0,
      "elements": [
        { "id": "mp_e_respect", "name": "Respect", "desc": "Respects family culture and values", "weight": 1 },
        { "id": "mp_e_belief", "name": "Belief", "desc": "Shows parents in-depth knowledge and belief in child", "weight": 1 },
        { "id": "mp_e_expectations", "name": "Expectations", "desc": "Gives parents clear learning and behavior expectations", "weight": 1 },
        { "id": "mp_e_communication", "name": "Communication", "desc": "Communicates promptly about problems and positives", "weight": 1 },
        { "id": "mp_e_involving", "name": "Involving", "desc": "Involves parents in supporting curriculum", "weight": 1 },
        { "id": "mp_e_homework", "name": "Homework", "desc": "Assigns engaging homework and provides feedback", "weight": 1 },
        { "id": "mp_e_responsiveness", "name": "Responsiveness", "desc": "Responds promptly to parent concerns", "weight": 1 },
        { "id": "mp_e_reporting", "name": "Reporting", "desc": "Gives detailed feedback in conferences and reports", "weight": 1 },
        { "id": "mp_e_outreach", "name": "Outreach", "desc": "Contacts and works with hard-to-reach parents", "weight": 1 },
        { "id": "mp_e_resources", "name": "Resources", "desc": "Enlists volunteers and community resources", "weight": 1 }
      ]
    },
    {
      "id": "professional_responsibilities",
      "name": "Professional Responsibilities",
      "weight": 1.0,
      "elements": [
        { "id": "mp_f_attendance", "name": "Attendance", "desc": "Maintains excellent attendance", "weight": 1 },
        { "id": "mp_f_reliability", "name": "Reliability", "desc": "Completes duties and keeps accurate records", "weight": 1 },
        { "id": "mp_f_professionalism", "name": "Professionalism", "desc": "Maintains professional demeanor and boundaries", "weight": 1 },
        { "id": "mp_f_judgment", "name": "Judgment", "desc": "Uses ethical, sound judgment and confidentiality", "weight": 1 },
        { "id": "mp_f_teamwork", "name": "Teamwork", "desc": "Contributes to teams and school activities", "weight": 1 },
        { "id": "mp_f_contributions", "name": "Contributions", "desc": "Contributes ideas and expertise to school mission", "weight": 1 },
        { "id": "mp_f_communication", "name": "Communication", "desc": "Keeps administration informed and asks for help", "weight": 1 },
        { "id": "mp_f_openness", "name": "Openness", "desc": "Seeks feedback and uses it to improve", "weight": 1 },
        { "id": "mp_f_collaboration", "name": "Collaboration", "desc": "Meets regularly with colleagues to plan and analyze", "weight": 1 }
      ]
    }
  ]
}
```

### Danielson Framework (Complete)

```json
{
  "id": "danielson_v2026",
  "name": "Danielson Framework (standard)",
  "source": "Danielson",
  "version": "2026-01",
  "aggregation_mode": "weighted",
  "default_thresholds": { "green": 80, "yellow": 60, "red": 0 },
  "domains": [
    {
      "id": "dn_planning_preparation",
      "name": "Planning and Preparation",
      "weight": 1.0,
      "elements": [
        { "id": "dn_pp_content_pedagogy", "name": "Demonstrating Knowledge of Content and Pedagogy", "desc": "Deep content knowledge and pedagogy", "weight": 1 },
        { "id": "dn_pp_knowledge_students", "name": "Demonstrating Knowledge of Students", "desc": "Knows students' backgrounds and needs", "weight": 1 },
        { "id": "dn_pp_outcomes", "name": "Setting Instructional Outcomes", "desc": "Clear measurable outcomes", "weight": 1 },
        { "id": "dn_pp_resources", "name": "Demonstrating Knowledge of Resources", "desc": "Uses resources to support learning", "weight": 1 },
        { "id": "dn_pp_coherent_instruction", "name": "Designing Coherent Instruction", "desc": "Plans coherent instruction sequences", "weight": 1 },
        { "id": "dn_pp_assessments", "name": "Designing Student Assessments", "desc": "Designs assessments aligned to outcomes", "weight": 1 }
      ]
    },
    {
      "id": "dn_classroom_environment",
      "name": "Classroom Environment",
      "weight": 1.0,
      "elements": [
        { "id": "dn_ce_respect_rapport", "name": "Creating an Environment of Respect and Rapport", "desc": "Builds respectful relationships", "weight": 1 },
        { "id": "dn_ce_culture_learning", "name": "Establishing a Culture for Learning", "desc": "Fosters a culture that values learning", "weight": 1 },
        { "id": "dn_ce_manage_procedures", "name": "Managing Classroom Procedures", "desc": "Efficient classroom procedures", "weight": 1 },
        { "id": "dn_ce_manage_behavior", "name": "Managing Student Behavior", "desc": "Maintains high standards of behavior", "weight": 1 },
        { "id": "dn_ce_physical_space", "name": "Organizing Physical Space", "desc": "Organizes space to support learning", "weight": 1 }
      ]
    },
    {
      "id": "dn_instruction",
      "name": "Instruction",
      "weight": 1.0,
      "elements": [
        { "id": "dn_i_communicate", "name": "Communicating with Students", "desc": "Clear communication and directions", "weight": 1 },
        { "id": "dn_i_questioning", "name": "Using Questioning and Discussion Techniques", "desc": "Effective questioning and discussion", "weight": 1 },
        { "id": "dn_i_engaging", "name": "Engaging Students in Learning", "desc": "Engages students in meaningful learning", "weight": 1 },
        { "id": "dn_i_assessment", "name": "Using Assessment in Instruction", "desc": "Uses assessment to guide instruction", "weight": 1 },
        { "id": "dn_i_flexibility", "name": "Demonstrating Flexibility and Responsiveness", "desc": "Adapts instruction responsively", "weight": 1 }
      ]
    },
    {
      "id": "dn_professional_responsibilities",
      "name": "Professional Responsibilities",
      "weight": 1.0,
      "elements": [
        { "id": "dn_pr_reflect", "name": "Reflecting on Teaching", "desc": "Reflects and improves practice", "weight": 1 },
        { "id": "dn_pr_records", "name": "Maintaining Accurate Records", "desc": "Keeps accurate records", "weight": 1 },
        { "id": "dn_pr_families", "name": "Communicating with Families", "desc": "Communicates effectively with families", "weight": 1 },
        { "id": "dn_pr_prof_community", "name": "Participating in the Professional Community", "desc": "Engages with professional community", "weight": 1 },
        { "id": "dn_pr_growth", "name": "Growing and Developing Professionally", "desc": "Pursues professional growth", "weight": 1 },
        { "id": "dn_pr_professionalism", "name": "Showing Professionalism", "desc": "Demonstrates professional behavior", "weight": 1 }
      ]
    }
  ]
}
```

---

**End of Specification Document**

*This document provides the complete front-end component map, API contract, and implementation guidance for building the Administrative Teacher Assessment Platform MVP. Engineering teams should use this as the primary reference for all Screens 1-6 implementation work.*
