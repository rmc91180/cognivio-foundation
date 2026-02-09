// ============================================
// CORE TYPES
// ============================================

export type UserRole = 'admin' | 'principal' | 'department_head' | 'teacher' | 'observer';
export type StatusColor = 'green' | 'yellow' | 'red' | 'gray';
export type AggregationMode = 'weighted' | 'worst' | 'majority';
export type VideoStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type AIObservationStatus = 'pending' | 'accepted' | 'rejected' | 'edited';
export type TrendDirection = 'up' | 'down' | 'stable';

// User & Authentication
export interface User {
  id: string;
  email: string;
  name: string;
  roles: UserRole[];
  activeRole: UserRole;
  schoolId: string | null;
  schoolName: string | null;
  defaultRoute: string;
  preferences: UserPreferences;
}

export interface UserPreferences {
  defaultTemplateId?: string;
  pinnedElementIds?: string[];
  dashboardLayout?: 'compact' | 'expanded';
  colorThresholdGreen?: number;
  colorThresholdYellow?: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}

// Teacher
export interface Teacher {
  id: string;
  name: string;
  email: string | null;
  subjects: string[];
  grades: string[];
  department: string | null;
  status: string;
}

// Rubric & Elements
export interface RubricTemplate {
  id: string;
  name: string;
  source: 'danielson' | 'marshall' | 'custom';
  version: string;
  description: string | null;
  aggregationMode: AggregationMode;
  domainsCount: number;
  elementsCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
}

export interface Domain {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  elements: Element[];
}

export interface Element {
  id: string;
  name: string;
  description: string | null;
  indicators: string[];
  defaultWeight: number;
  sortOrder: number;
}

export interface TemplateColumn {
  id: string;
  columnIndex: number;
  name: string;
  weight: number;
  enabled: boolean;
  elementIds: string[];
}

// Dashboard
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

// Roster
export interface RosterRow {
  teacherId: string;
  teacherName: string;
  email: string | null;
  subjects: string[];
  grades: string[];
  metrics: MetricCell[];
  gradebookStatus: GradebookStatus;
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

export interface GradebookStatus {
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

// Teacher Detail
export interface TeacherDetail {
  teacher: Teacher;
  overallScore: number;
  overallColor: StatusColor;
  previousPeriodScore: number | null;
  schoolAverage: number;
  elementScores: ElementScore[];
  aiObservations: AIObservation[];
  videoEvidence: VideoEvidence[];
  gradebookStatus: GradebookStatus;
  observationHistory: ObservationHistoryItem[];
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

export interface AIObservation {
  id: string;
  videoId: string;
  elementId: string;
  confidence: number;
  scoreEstimate: number | null;
  startTs: string | null;
  endTs: string | null;
  summary: string | null;
  keyMoments: KeyMoment[];
  status: AIObservationStatus;
  createdAt: string;
}

export interface KeyMoment {
  timestamp: string;
  description: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}

export interface VideoEvidence {
  id: string;
  clipUrl: string | null;
  thumbnailUrl: string | null;
  startTs: string | null;
  endTs: string | null;
  durationSeconds: number | null;
  anonymized: boolean;
  processingStatus: VideoStatus;
  uploadedAt: string;
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

// API Response
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

// Date Range
export interface DateRange {
  start: Date;
  end: Date;
  preset: 'week' | 'month' | 'quarter' | 'year' | 'custom';
}

// ============================================
// NOTES TYPES
// ============================================

export type NoteType = 'general' | 'observation' | 'question' | 'action_item' | 'follow_up';
export type NoteStatus = 'active' | 'resolved' | 'archived';

export interface ObservationNote {
  id: string;
  observationId: string;
  userId: string;
  videoId?: string;
  elementId?: string;
  content: string;
  noteType: NoteType;
  timestampSeconds?: number;
  tags: string[];
  isPrivate: boolean;
  isPinned: boolean;
  status: NoteStatus;
  resolvedAt?: string;
  resolvedBy?: string;
  createdAt: string;
  updatedAt: string;
  userName?: string;
  userEmail?: string;
  elementName?: string;
  resolvedByName?: string;
}

export interface CreateNoteInput {
  observationId: string;
  videoId?: string;
  elementId?: string;
  content: string;
  noteType?: NoteType;
  timestampSeconds?: number;
  tags?: string[];
  isPrivate?: boolean;
}

export interface NoteCounts {
  general: number;
  observation: number;
  question: number;
  action_item: number;
  follow_up: number;
}

// ============================================
// FEEDBACK TYPES
// ============================================

export type AgreementLevel = 'strongly_agree' | 'agree' | 'neutral' | 'disagree' | 'strongly_disagree';
export type UserConfidence = 'very_confident' | 'confident' | 'somewhat_confident';
export type DisagreementType = 'score_too_high' | 'score_too_low' | 'wrong_evidence' | 'missed_evidence' | 'misinterpreted';
export type FeedbackCategory = 'scoring_accuracy' | 'evidence_quality' | 'recommendation_relevance' | 'summary_clarity' | 'detail_level' | 'rubric_alignment' | 'video_coverage';

export interface AIFeedback {
  id: string;
  observationId: string;
  userId: string;
  videoId?: string;
  accuracyRating?: number;
  helpfulnessRating?: number;
  detailRating?: number;
  overallAgreement?: AgreementLevel;
  elementsAgreed: number;
  elementsDisagreed: number;
  feedbackText?: string;
  whatWasMissed?: string;
  whatWasIncorrect?: string;
  suggestions?: string;
  feedbackCategories: FeedbackCategory[];
  approvedForTraining: boolean;
  containsCorrections: boolean;
  userExpertiseWeight: number;
  createdAt: string;
  updatedAt: string;
  userName?: string;
  corrections?: FeedbackCorrection[];
}

export interface FeedbackCorrection {
  id: string;
  feedbackId: string;
  elementId: string;
  userId: string;
  aiScore: number;
  correctedScore: number;
  scoreDifference: number;
  aiConfidence?: number;
  userConfidence?: UserConfidence;
  correctionReason?: string;
  evidenceDescription?: string;
  timestampReferences: number[];
  disagreementType?: DisagreementType;
  validated: boolean;
  includedInTraining: boolean;
  createdAt: string;
  elementName?: string;
  domainName?: string;
}

export interface CreateFeedbackInput {
  observationId: string;
  videoId?: string;
  accuracyRating?: number;
  helpfulnessRating?: number;
  detailRating?: number;
  overallAgreement?: AgreementLevel;
  feedbackText?: string;
  whatWasMissed?: string;
  whatWasIncorrect?: string;
  suggestions?: string;
  feedbackCategories?: FeedbackCategory[];
}

export interface CreateCorrectionInput {
  elementId: string;
  aiScore: number;
  correctedScore: number;
  aiConfidence?: number;
  userConfidence?: UserConfidence;
  correctionReason?: string;
  evidenceDescription?: string;
  timestampReferences?: number[];
  disagreementType?: DisagreementType;
}

export interface FeedbackAnalytics {
  totalFeedback: number;
  averageAccuracyRating: number;
  averageHelpfulnessRating: number;
  agreementDistribution: Record<AgreementLevel, number>;
  totalCorrections: number;
  averageScoreDifference: number;
  commonDisagreementTypes: Array<{ type: DisagreementType; count: number }>;
  elementsWithMostCorrections: Array<{ elementId: string; elementName: string; count: number }>;
  feedbackTrend: Array<{ date: string; count: number; avgAccuracy: number }>;
}

// ============================================
// VIDEO ANALYSIS TYPES
// ============================================

export interface VideoAnalysis {
  video: {
    id: string;
    teacher_name: string;
    subjects: string[];
    grades: string[];
    duration_seconds: number;
    processed_at: string;
  };
  analysis: {
    executive_summary: string;
    overall_rating: {
      score: number;
      score_4_scale: number;
      performance_level: string;
      confidence: number;
      justification: string;
    };
    domain_summaries: DomainSummary[];
    top_strengths: string[];
    top_growth_areas: string[];
    recommendations: string[];
    total_elements_analyzed: number;
  };
  processing: {
    frames_analyzed: number;
    tokens_used: number;
    cost_usd: number;
    model: string;
    processing_time_ms: number;
  } | null;
  notes: {
    items: ObservationNote[];
    counts: NoteCounts;
    total: number;
  };
  feedback: {
    items: AIFeedback[];
    total: number;
    has_user_feedback: boolean;
  };
}

export interface DomainSummary {
  domain_name: string;
  average_score: number;
  average_confidence: number;
  summary: string;
  element_count: number;
  strengths: string[];
  growth_areas: string[];
  elements: ElementAnalysis[];
}

export interface ElementAnalysis {
  id: string;
  name: string;
  description: string;
  score: number;
  confidence: number;
  summary: string;
  detailed_analysis: string;
  key_moments: KeyMoment[];
  recommendations: string[];
  evidence_timestamps: number[];
}

// ============================================
// AUDIT TYPES
// ============================================

export type AuditAction =
  | 'login'
  | 'logout'
  | 'create'
  | 'update'
  | 'delete'
  | 'view'
  | 'export'
  | 'approve'
  | 'reject'
  | 'upload'
  | 'download';

export type AuditTargetType =
  | 'user'
  | 'teacher'
  | 'video'
  | 'observation'
  | 'feedback'
  | 'template'
  | 'settings'
  | 'report';

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  details: Record<string, unknown>;
  timestamp: string;
}
