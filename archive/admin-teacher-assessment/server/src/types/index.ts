// ============================================
// CORE DOMAIN TYPES
// ============================================

export type UserRole = 'admin' | 'principal' | 'department_head' | 'teacher' | 'observer';
export type StatusColor = 'green' | 'yellow' | 'red';
export type AggregationMode = 'weighted' | 'worst' | 'majority';
export type VideoStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type AIObservationStatus = 'pending' | 'accepted' | 'rejected' | 'edited';
export type ReviewAction = 'accept' | 'reject' | 'edit';
export type AssessmentStatus = 'draft' | 'completed' | 'reviewed';
export type TeacherStatus = 'active' | 'inactive' | 'on_leave';
export type TrendDirection = 'up' | 'down' | 'stable';

// User & Authentication
export interface User {
  id: string;
  email: string;
  password_hash?: string;
  name: string;
  roles: UserRole[];
  active_role: UserRole | null;
  school_id: string | null;
  sso_provider?: string;
  sso_id?: string;
  last_login_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface UserPreferences {
  id: string;
  user_id: string;
  default_template_id: string | null;
  pinned_element_ids: string[];
  dashboard_layout: 'compact' | 'expanded';
  color_threshold_green: number;
  color_threshold_yellow: number;
  notification_settings: Record<string, unknown>;
}

export interface AuthPayload {
  userId: string;
  email: string;
  roles: UserRole[];
  activeRole: UserRole;
  schoolId: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    name: string;
    roles: UserRole[];
    activeRole: UserRole;
    schoolId: string | null;
    schoolName: string | null;
    defaultRoute: string;
    preferences: Partial<UserPreferences>;
  };
}

// School
export interface School {
  id: string;
  name: string;
  district_id: string | null;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

// Teacher
export interface Teacher {
  id: string;
  user_id: string | null;
  name: string;
  email: string | null;
  school_id: string;
  subjects: string[];
  grades: string[];
  department: string | null;
  hire_date: Date | null;
  status: TeacherStatus;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

// Rubric & Elements
export interface RubricTemplate {
  id: string;
  name: string;
  source: 'danielson' | 'marshall' | 'custom';
  version: string;
  description: string | null;
  aggregation_mode: AggregationMode;
  school_id: string | null;
  created_by: string | null;
  is_system_template: boolean;
  is_active: boolean;
  config: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface RubricDomain {
  id: string;
  template_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: Date;
}

export interface RubricElement {
  id: string;
  domain_id: string;
  template_id: string;
  name: string;
  description: string | null;
  indicators: string[];
  default_weight: number;
  sort_order: number;
  created_at: Date;
}

export interface TemplateColumn {
  id: string;
  template_id: string;
  column_index: number;
  name: string;
  weight: number;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TemplateColumnAssignment {
  id: string;
  column_id: string;
  element_id: string;
  sort_order: number;
  created_at: Date;
}

// Assessment & Scores
export interface Assessment {
  id: string;
  teacher_id: string;
  template_id: string;
  observer_id: string | null;
  overall_score: number | null;
  status: AssessmentStatus;
  notes: string | null;
  observation_date: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AssessmentElement {
  id: string;
  assessment_id: string;
  element_id: string;
  score: number;
  notes: string | null;
  evidence_ids: string[];
  is_overridden: boolean;
  override_reason: string | null;
  overridden_by: string | null;
  overridden_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Video & AI
export interface VideoEvidence {
  id: string;
  teacher_id: string;
  class_id: string | null;
  original_filename: string | null;
  clip_url: string | null;
  thumbnail_url: string | null;
  storage_path: string | null;
  start_ts: Date | null;
  end_ts: Date | null;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  anonymized: boolean;
  processing_status: VideoStatus;
  processing_error: string | null;
  uploaded_by: string | null;
  processed_at: Date | null;
  created_at: Date;
}

export interface AIObservation {
  id: string;
  video_id: string;
  element_id: string;
  confidence: number;
  score_estimate: number | null;
  start_ts: Date | null;
  end_ts: Date | null;
  summary: string | null;
  key_moments: KeyMoment[];
  status: AIObservationStatus;
  model_version: string | null;
  raw_response: Record<string, unknown> | null;
  created_at: Date;
}

export interface KeyMoment {
  timestamp: string;
  description: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}

export interface AIObservationReview {
  id: string;
  observation_id: string;
  reviewer_id: string;
  action: ReviewAction;
  edited_score: number | null;
  notes: string | null;
  reviewed_at: Date;
}

// Gradebook
export interface GradebookStatus {
  id: string;
  teacher_id: string;
  is_healthy: boolean;
  missing_grades: boolean;
  classes_missing: string[];
  total_students: number | null;
  graded_students: number | null;
  last_grade_entry: Date | null;
  sync_source: string | null;
  last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Action Plans
export interface ActionPlan {
  id: string;
  teacher_id: string;
  created_by: string;
  status: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ActionPlanGoal {
  id: string;
  plan_id: string;
  element_id: string | null;
  description: string;
  target_score: number | null;
  target_date: Date | null;
  status: string;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Audit Log
export interface AuditLog {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface DashboardSummary {
  activeRubricId: string;
  activeRubricName: string;
  activeRubricVersion: string;
  lastEditedAt: string;
  lastEditedBy: string;
  totalTeachers: number;
  greenTeachers: number;
  yellowTeachers: number;
  redTeachers: number;
  missingGradesCount: number;
  recentReports: RecentReport[];
}

export interface RecentReport {
  id: string;
  title: string;
  lastSent: string;
  recipientCount: number;
}

export interface RosterRow {
  teacherId: string;
  teacherName: string;
  email: string | null;
  subjects: string[];
  grades: string[];
  metrics: MetricCell[];
  gradebookStatus: GradebookStatusSummary;
  lastObserved: string | null;
  overallScore: number;
  overallColor: StatusColor;
}

export interface MetricCell {
  columnId: string;
  columnName: string;
  color: StatusColor;
  numericScore: number;
  elementCount: number;
  lastObserved: string | null;
}

export interface GradebookStatusSummary {
  isHealthy: boolean;
  missingGrades: boolean;
  classesMissing: string[];
  lastUpdated: string | null;
}

export interface RosterTotals {
  total: number;
  green: number;
  yellow: number;
  red: number;
  missingGradebook: number;
}

export interface ElementScore {
  elementId: string;
  elementName: string;
  domain: string;
  numericScore: number;
  color: StatusColor;
  previousScore: number | null;
  trend: TrendDirection;
  lastObserved: string | null;
  observationCount: number;
  evidenceIds: string[];
  aiObservationIds: string[];
  isPinned: boolean;
  problemScore: number;
}

export interface TeacherDetail {
  teacher: Teacher;
  overallScore: number;
  overallColor: StatusColor;
  previousPeriodScore: number | null;
  schoolAverage: number;
  elementScores: ElementScore[];
  aiObservations: AIObservation[];
  videoEvidence: VideoEvidence[];
  gradebookStatus: GradebookStatusSummary;
  observationHistory: ObservationHistoryItem[];
}

export interface ObservationHistoryItem {
  id: string;
  type: 'human' | 'ai';
  observerId?: string;
  observerName?: string;
  date: string;
  elementsObserved: string[];
  summary: string;
  evidenceId?: string;
}

// API Request/Response
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
  meta?: {
    page?: number;
    pageSize?: number;
    totalPages?: number;
    totalItems?: number;
  };
}

export interface CreateTemplateRequest {
  name: string;
  source: 'custom';
  description?: string;
  aggregationMode: AggregationMode;
  columns: {
    name: string;
    weight: number;
    enabled: boolean;
    elementIds: string[];
  }[];
  versionNotes?: string;
}

export interface ColorThresholds {
  greenMin: number;
  yellowMin: number;
}
