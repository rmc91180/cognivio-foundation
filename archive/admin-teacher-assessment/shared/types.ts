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
  red: number;    // below yellow is red (default: 0)
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
  isActive?: boolean;
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
  observationId: string;
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
  uploadUrl?: string;
  status: 'accepted';
  message: string;
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
  problemScore: number;
  reasons: string[];
  trend: TrendDirection;
  observationCount: number;
}

// ============ TRENDS ============

export interface TrendDataPoint {
  date: string;
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
  details: Record<string, unknown>;
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

export interface RosterResponse {
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

export interface TemplatesResponse {
  templates: RubricTemplate[];
}

export interface ElementsResponse {
  elements: RubricElement[];
  domains: { id: string; name: string; source: string }[];
}

export interface CreateTemplateRequest {
  id?: string;
  name: string;
  aggregationMode: AggregationMode;
  elementIds: string[];
  customElements?: {
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

export interface ThresholdsResponse {
  thresholds: Thresholds;
  aggregationMode: AggregationMode;
  updatedAt?: string;
}

export interface GradebookStatusResponse {
  statuses: GradebookStatus[];
}

// ============ ALGORITHM CONFIG ============

export interface ProblemScoreConfig {
  deltaMultiplier: number;    // default: 2
  deficitMultiplier: number;  // default: 1.2
  freqMultiplier: number;     // default: 5
  confidenceFactor: number;   // default: 0.2
}

export const DEFAULT_PROBLEM_SCORE_CONFIG: ProblemScoreConfig = {
  deltaMultiplier: 2,
  deficitMultiplier: 1.2,
  freqMultiplier: 5,
  confidenceFactor: 0.2,
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  green: 80,
  yellow: 60,
  red: 0,
};

// Score normalization mapping (4-level scale to 0-100)
export const SCORE_NORMALIZATION: Record<number, number> = {
  4: 100,  // Highly Effective / Distinguished
  3: 80,   // Effective / Proficient
  2: 60,   // Needs Improvement / Basic
  1: 40,   // Unsatisfactory
};
