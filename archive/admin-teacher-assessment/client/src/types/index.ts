// ============================================
// CORE TYPES
// ============================================

export type UserRole = 'admin' | 'principal' | 'department_head' | 'teacher' | 'observer';
export type StatusColor = 'green' | 'yellow' | 'red';
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

// ============================================
// AI LEARNING & FEEDBACK LOOP TYPES
// ============================================

// AI Learning History
export interface AILearningEntry {
  id: string;
  teacherId: string;
  teacherName?: string;
  elementId: string;
  elementName?: string;
  observationId?: string;
  correctionId?: string;
  originalAiScore: number;
  correctedScore: number;
  scoreDelta: number;
  aiConfidence?: number;
  correctionType?: string;
  frameworkType?: string;
  domainName?: string;
  subjects: string[];
  grades: string[];
  reviewerId?: string;
  reviewerName?: string;
  reviewerRole?: string;
  reviewerExpertiseWeight: number;
  cumulativeCorrections: number;
  averageDelta: number;
  modelVersion?: string;
  appliedToModel: boolean;
  appliedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LearningPattern {
  elementId: string;
  elementName: string;
  domainName: string;
  frameworkType: string;
  totalCorrections: number;
  averageDelta: number;
  biasDirection: 'high' | 'low' | 'neutral';
  confidenceCorrelation: number;
  correctionTypes: Array<{ type: string; count: number }>;
  recommendedAdjustment: number;
}

export interface TrainingDataExport {
  id: string;
  learningHistoryId: string;
  elementId: string;
  frameworkType: string;
  domainName: string;
  originalScore: number;
  correctedScore: number;
  scoreDelta: number;
  aiConfidence: number;
  reviewerExpertiseWeight: number;
  modelVersion: string;
  createdAt: string;
}

export interface ConfidenceAdjustment {
  elementId: string;
  currentConfidence: number;
  adjustedConfidence: number;
  adjustmentReason: string;
  correctionHistory: {
    totalCorrections: number;
    recentCorrections: number;
    averageDelta: number;
  };
}

// AI Suggestions
export type SuggestionType = 'observation' | 'coaching' | 'resource' | 'intervention' | 'recognition';
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'completed' | 'expired';
export type SuggestionPriority = 'high' | 'medium' | 'low';
export type PatternType = 'declining_trend' | 'consistent_low' | 'improvement_stall' | 'high_performer' | 'volatile_scores' | 'new_teacher';

export interface AISuggestion {
  id: string;
  teacherId: string;
  teacherName?: string;
  elementId?: string;
  elementName?: string;
  generatedForUser?: string;
  generatedForUserName?: string;
  suggestionType: SuggestionType;
  priority: SuggestionPriority;
  title: string;
  description: string;
  rationale?: string;
  actionItems: string[];
  relatedElements: string[];
  evidenceBasis: {
    observationCount?: number;
    trendPeriods?: number;
    keyFindings?: string[];
    [key: string]: unknown;
  };
  confidenceScore?: number;
  patternDetected?: PatternType;
  modelVersion?: string;
  status: SuggestionStatus;
  acceptedAt?: string;
  acceptedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  completedAt?: string;
  completionNotes?: string;
  expiresAt?: string;
  helpfulnessRating?: number;
  feedbackNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SuggestionStats {
  pending: number;
  accepted: number;
  rejected: number;
  completed: number;
  avgHelpfulness: number;
  byType: Record<SuggestionType, number>;
  byPriority: Record<SuggestionPriority, number>;
}

// Teacher Feedback Messages
export type FeedbackMessageType = 'praise' | 'coaching' | 'action_required' | 'follow_up' | 'general';
export type MessagePriority = 'urgent' | 'high' | 'normal' | 'low';

// Type aliases for compatibility
export type FeedbackType = FeedbackMessageType;
export type FeedbackPriority = 'urgent' | 'high' | 'normal' | 'low';
export type FeedbackStats = FeedbackMessageStats;

export interface TeacherFeedbackMessage {
  id: string;
  teacherId: string;
  teacherName?: string;
  senderId: string;
  senderName?: string;
  senderRole?: string;
  observationId?: string;
  elementId?: string;
  elementName?: string;
  suggestionId?: string;
  videoId?: string;
  feedbackType: FeedbackMessageType;
  subject: string;
  message: string;
  attachments: Array<{ type: string; url: string; name: string }>;
  priority: MessagePriority;
  requiresAcknowledgment: boolean;
  acknowledgedAt?: string;
  readAt?: string;
  isArchived: boolean;
  parentMessageId?: string;
  threadDepth: number;
  replyCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeacherFeedbackInput {
  teacherId: string;
  observationId?: string;
  elementId?: string;
  suggestionId?: string;
  videoId?: string;
  feedbackType: FeedbackMessageType;
  subject: string;
  message: string;
  attachments?: Array<{ type: string; url: string; name: string }>;
  priority?: MessagePriority;
  requiresAcknowledgment?: boolean;
  parentMessageId?: string;
}

export interface FeedbackMessageStats {
  totalMessages: number;
  unreadMessages: number;
  pendingAcknowledgments: number;
  byType: Record<FeedbackMessageType, number>;
  byPriority: Record<MessagePriority, number>;
  recentActivity: Array<{ date: string; count: number }>;
}

// Performance Trends
export type PeriodType = 'week' | 'month' | 'quarter' | 'year';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface TrendDataPoint {
  id: string;
  teacherId: string;
  elementId?: string;
  templateId?: string;
  periodStart: string;
  periodEnd: string;
  periodType: PeriodType;
  averageScore: number;
  scoreChange: number;
  trendDirection: TrendDirection;
  observationCount: number;
  minScore: number;
  maxScore: number;
  stdDeviation: number;
  confidenceAverage: number;
  schoolAverage: number;
  percentileRank: number;
  riskLevel?: RiskLevel;
  predictedFutureRisk?: number;
  riskFactors: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RegressionAlert {
  teacherId: string;
  teacherName: string;
  elementId?: string;
  elementName?: string;
  domainName?: string;
  severity: 'critical' | 'warning';
  previousScore: number;
  currentScore: number;
  decline: number;
  declinePercent: number;
  periodsAffected: number;
  trendDirection: TrendDirection;
  riskLevel: RiskLevel;
  recommendedAction: string;
  createdAt: string;
}

export interface ProgressReport {
  teacherId: string;
  teacherName: string;
  elementId?: string;
  elementName?: string;
  domainName?: string;
  previousScore: number;
  currentScore: number;
  improvement: number;
  improvementPercent: number;
  periodsOfGrowth: number;
  consistency: number;
  createdAt: string;
}

export interface RiskPrediction {
  overallRisk: number;
  riskLevel: RiskLevel;
  contributingFactors: string[];
  projectedScore: number;
  confidence: number;
  recommendations: string[];
}

export interface SchoolTrendSummary {
  schoolId: string;
  schoolName: string;
  periodStart: string;
  periodEnd: string;
  overallAverage: number;
  teacherCount: number;
  improvingCount: number;
  decliningCount: number;
  stableCount: number;
  atRiskCount: number;
  topPerformers: Array<{ teacherId: string; teacherName: string; score: number }>;
  needsAttention: Array<{ teacherId: string; teacherName: string; score: number; riskLevel: RiskLevel }>;
  domainAverages: Array<{ domainId: string; domainName: string; average: number; trend: TrendDirection }>;
}

// AI Model Version
export interface AIModelVersion {
  version: string;
  type: string;
  name: string;
  deploymentDate: string;
}
