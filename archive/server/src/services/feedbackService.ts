import { db } from '../utils/db';
import { v4 as uuidv4 } from 'uuid';
import { logAudit } from './auditService';

// ===========================================
// Types
// ===========================================

export type AgreementLevel = 'strongly_agree' | 'agree' | 'neutral' | 'disagree' | 'strongly_disagree';
export type UserConfidence = 'very_confident' | 'confident' | 'somewhat_confident';
export type DisagreementType = 'score_too_high' | 'score_too_low' | 'wrong_evidence' | 'missed_evidence' | 'misinterpreted';
export type FeedbackCategory = 'scoring_accuracy' | 'evidence_quality' | 'recommendation_relevance' | 'summary_clarity' | 'detail_level' | 'rubric_alignment' | 'video_coverage';

export interface CreateFeedbackInput {
  observationId: string;
  userId: string;
  videoId?: string;
  accuracyRating?: number; // 1-5
  helpfulnessRating?: number; // 1-5
  detailRating?: number; // 1-5
  overallAgreement?: AgreementLevel;
  feedbackText?: string;
  whatWasMissed?: string;
  whatWasIncorrect?: string;
  suggestions?: string;
  feedbackCategories?: FeedbackCategory[];
}

export interface CreateCorrectionInput {
  feedbackId: string;
  elementId: string;
  userId: string;
  aiScore: number;
  correctedScore: number;
  aiConfidence?: number;
  userConfidence?: UserConfidence;
  correctionReason?: string;
  evidenceDescription?: string;
  timestampReferences?: number[];
  disagreementType?: DisagreementType;
}

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
  approvedAt?: Date;
  approvedBy?: string;
  userExpertiseWeight: number;
  createdAt: Date;
  updatedAt: Date;
  // Joined fields
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
  validatedAt?: Date;
  validatedBy?: string;
  createdAt: Date;
  // Joined fields
  elementName?: string;
  domainName?: string;
}

export interface TrainingExport {
  id: string;
  exportName: string;
  description?: string;
  exportFormat: string;
  dataFrom?: Date;
  dataTo?: Date;
  minAccuracyRating?: number;
  validatedOnly: boolean;
  totalObservations: number;
  totalCorrections: number;
  totalFeedbackEntries: number;
  status: string;
  filePath?: string;
  fileSizeBytes?: number;
  errorMessage?: string;
  requestedBy?: string;
  completedAt?: Date;
  createdAt: Date;
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

// User role weights for feedback importance
const ROLE_WEIGHTS: Record<string, number> = {
  admin: 1.5,
  principal: 1.3,
  department_head: 1.2,
  observer: 1.1,
  teacher: 1.0,
};

// ===========================================
// Feedback Service
// ===========================================

export const feedbackService = {
  /**
   * Submit feedback on an AI observation
   */
  async submitFeedback(input: CreateFeedbackInput): Promise<AIFeedback> {
    // Check if feedback already exists
    const existing = await db('ai_feedback')
      .where('observation_id', input.observationId)
      .where('user_id', input.userId)
      .first();

    if (existing) {
      throw new Error('Feedback already submitted for this observation. Use update instead.');
    }

    // Get user role for weighting
    const user = await db('users').where('id', input.userId).first();
    const userRole = user?.active_role || user?.roles?.[0] || 'teacher';
    const expertiseWeight = ROLE_WEIGHTS[userRole] || 1.0;

    const feedbackId = uuidv4();

    await db('ai_feedback').insert({
      id: feedbackId,
      observation_id: input.observationId,
      user_id: input.userId,
      video_id: input.videoId || null,
      accuracy_rating: input.accuracyRating || null,
      helpfulness_rating: input.helpfulnessRating || null,
      detail_rating: input.detailRating || null,
      overall_agreement: input.overallAgreement || null,
      elements_agreed: 0,
      elements_disagreed: 0,
      feedback_text: input.feedbackText || null,
      what_was_missed: input.whatWasMissed || null,
      what_was_incorrect: input.whatWasIncorrect || null,
      suggestions: input.suggestions || null,
      feedback_categories: JSON.stringify(input.feedbackCategories || []),
      approved_for_training: false,
      contains_corrections: false,
      user_expertise_weight: expertiseWeight,
    });

    // Log audit
    await logAudit({
      userId: input.userId,
      action: 'submit_feedback',
      targetType: 'ai_feedback',
      targetId: feedbackId,
      details: {
        observationId: input.observationId,
        accuracyRating: input.accuracyRating,
        overallAgreement: input.overallAgreement,
      },
    });

    return this.getFeedbackById(feedbackId);
  },

  /**
   * Update existing feedback
   */
  async updateFeedback(feedbackId: string, userId: string, updates: Partial<CreateFeedbackInput>): Promise<AIFeedback> {
    const feedback = await db('ai_feedback').where('id', feedbackId).first();

    if (!feedback) {
      throw new Error('Feedback not found');
    }

    if (feedback.user_id !== userId) {
      throw new Error('Only the feedback author can update');
    }

    if (feedback.approved_for_training) {
      throw new Error('Cannot update feedback that has been approved for training');
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (updates.accuracyRating !== undefined) updateData.accuracy_rating = updates.accuracyRating;
    if (updates.helpfulnessRating !== undefined) updateData.helpfulness_rating = updates.helpfulnessRating;
    if (updates.detailRating !== undefined) updateData.detail_rating = updates.detailRating;
    if (updates.overallAgreement !== undefined) updateData.overall_agreement = updates.overallAgreement;
    if (updates.feedbackText !== undefined) updateData.feedback_text = updates.feedbackText;
    if (updates.whatWasMissed !== undefined) updateData.what_was_missed = updates.whatWasMissed;
    if (updates.whatWasIncorrect !== undefined) updateData.what_was_incorrect = updates.whatWasIncorrect;
    if (updates.suggestions !== undefined) updateData.suggestions = updates.suggestions;
    if (updates.feedbackCategories !== undefined) {
      updateData.feedback_categories = JSON.stringify(updates.feedbackCategories);
    }

    await db('ai_feedback').where('id', feedbackId).update(updateData);

    // Log audit
    await logAudit({
      userId,
      action: 'update_feedback',
      targetType: 'ai_feedback',
      targetId: feedbackId,
    });

    return this.getFeedbackById(feedbackId);
  },

  /**
   * Add a score correction
   */
  async addCorrection(input: CreateCorrectionInput): Promise<FeedbackCorrection> {
    // Verify feedback exists
    const feedback = await db('ai_feedback').where('id', input.feedbackId).first();
    if (!feedback) {
      throw new Error('Feedback not found');
    }

    // Check for existing correction for this element
    const existing = await db('feedback_corrections')
      .where('feedback_id', input.feedbackId)
      .where('element_id', input.elementId)
      .first();

    if (existing) {
      throw new Error('Correction already exists for this element. Use update instead.');
    }

    const correctionId = uuidv4();
    const scoreDifference = input.correctedScore - input.aiScore;

    await db('feedback_corrections').insert({
      id: correctionId,
      feedback_id: input.feedbackId,
      element_id: input.elementId,
      user_id: input.userId,
      ai_score: input.aiScore,
      corrected_score: input.correctedScore,
      score_difference: scoreDifference,
      ai_confidence: input.aiConfidence || null,
      user_confidence: input.userConfidence || null,
      correction_reason: input.correctionReason || null,
      evidence_description: input.evidenceDescription || null,
      timestamp_references: JSON.stringify(input.timestampReferences || []),
      disagreement_type: input.disagreementType || null,
      validated: false,
      included_in_training: false,
    });

    // Update feedback counts
    const isDisagreement = scoreDifference !== 0;
    await db('ai_feedback')
      .where('id', input.feedbackId)
      .update({
        contains_corrections: true,
        elements_disagreed: isDisagreement
          ? db.raw('elements_disagreed + 1')
          : db.raw('elements_disagreed'),
        elements_agreed: !isDisagreement
          ? db.raw('elements_agreed + 1')
          : db.raw('elements_agreed'),
        updated_at: new Date(),
      });

    // Log audit
    await logAudit({
      userId: input.userId,
      action: 'add_correction',
      targetType: 'feedback_correction',
      targetId: correctionId,
      details: {
        elementId: input.elementId,
        aiScore: input.aiScore,
        correctedScore: input.correctedScore,
        scoreDifference,
      },
    });

    return this.getCorrectionById(correctionId);
  },

  /**
   * Get feedback by ID with corrections
   */
  async getFeedbackById(feedbackId: string): Promise<AIFeedback> {
    const feedback = await db('ai_feedback as f')
      .leftJoin('users as u', 'f.user_id', 'u.id')
      .select('f.*', 'u.name as user_name')
      .where('f.id', feedbackId)
      .first();

    if (!feedback) {
      throw new Error('Feedback not found');
    }

    // Get corrections
    const corrections = await db('feedback_corrections as c')
      .leftJoin('rubric_elements as e', 'c.element_id', 'e.id')
      .leftJoin('rubric_domains as d', 'e.domain_id', 'd.id')
      .select('c.*', 'e.name as element_name', 'd.name as domain_name')
      .where('c.feedback_id', feedbackId)
      .orderBy('c.created_at', 'asc');

    return this.formatFeedback(feedback, corrections);
  },

  /**
   * Get correction by ID
   */
  async getCorrectionById(correctionId: string): Promise<FeedbackCorrection> {
    const correction = await db('feedback_corrections as c')
      .leftJoin('rubric_elements as e', 'c.element_id', 'e.id')
      .leftJoin('rubric_domains as d', 'e.domain_id', 'd.id')
      .select('c.*', 'e.name as element_name', 'd.name as domain_name')
      .where('c.id', correctionId)
      .first();

    if (!correction) {
      throw new Error('Correction not found');
    }

    return this.formatCorrection(correction);
  },

  /**
   * Get all feedback for an observation
   */
  async getFeedbackForObservation(observationId: string): Promise<AIFeedback[]> {
    const feedbacks = await db('ai_feedback as f')
      .leftJoin('users as u', 'f.user_id', 'u.id')
      .select('f.*', 'u.name as user_name')
      .where('f.observation_id', observationId)
      .orderBy('f.created_at', 'desc');

    const result: AIFeedback[] = [];

    for (const feedback of feedbacks) {
      const corrections = await db('feedback_corrections as c')
        .leftJoin('rubric_elements as e', 'c.element_id', 'e.id')
        .leftJoin('rubric_domains as d', 'e.domain_id', 'd.id')
        .select('c.*', 'e.name as element_name', 'd.name as domain_name')
        .where('c.feedback_id', feedback.id);

      result.push(this.formatFeedback(feedback, corrections));
    }

    return result;
  },

  /**
   * Approve feedback for AI training
   */
  async approveFeedbackForTraining(feedbackId: string, adminUserId: string): Promise<AIFeedback> {
    const feedback = await db('ai_feedback').where('id', feedbackId).first();

    if (!feedback) {
      throw new Error('Feedback not found');
    }

    await db('ai_feedback').where('id', feedbackId).update({
      approved_for_training: true,
      approved_at: new Date(),
      approved_by: adminUserId,
      updated_at: new Date(),
    });

    // Log audit
    await logAudit({
      userId: adminUserId,
      action: 'approve_feedback_for_training',
      targetType: 'ai_feedback',
      targetId: feedbackId,
    });

    return this.getFeedbackById(feedbackId);
  },

  /**
   * Validate a correction
   */
  async validateCorrection(correctionId: string, adminUserId: string): Promise<FeedbackCorrection> {
    const correction = await db('feedback_corrections').where('id', correctionId).first();

    if (!correction) {
      throw new Error('Correction not found');
    }

    await db('feedback_corrections').where('id', correctionId).update({
      validated: true,
      validated_at: new Date(),
      validated_by: adminUserId,
      updated_at: new Date(),
    });

    // Log audit
    await logAudit({
      userId: adminUserId,
      action: 'validate_correction',
      targetType: 'feedback_correction',
      targetId: correctionId,
    });

    return this.getCorrectionById(correctionId);
  },

  /**
   * Get feedback analytics for AI training insights
   */
  async getFeedbackAnalytics(params: {
    startDate?: Date;
    endDate?: Date;
    minCorrections?: number;
  } = {}): Promise<FeedbackAnalytics> {
    let query = db('ai_feedback');

    if (params.startDate) {
      query = query.where('created_at', '>=', params.startDate);
    }
    if (params.endDate) {
      query = query.where('created_at', '<=', params.endDate);
    }

    // Basic stats
    const stats: any = await query.clone()
      .select(
        db.raw('COUNT(*) as total_feedback'),
        db.raw('AVG(accuracy_rating) as avg_accuracy'),
        db.raw('AVG(helpfulness_rating) as avg_helpfulness')
      )
      .first();

    // Agreement distribution
    const agreementDist = await query.clone()
      .whereNotNull('overall_agreement')
      .groupBy('overall_agreement')
      .select('overall_agreement', db.raw('COUNT(*) as count'));

    // Corrections stats
    const correctionStats: any = await db('feedback_corrections')
      .select(
        db.raw('COUNT(*) as total'),
        db.raw('AVG(ABS(score_difference)) as avg_diff')
      )
      .first();

    // Common disagreement types
    const disagreementTypes = await db('feedback_corrections')
      .whereNotNull('disagreement_type')
      .groupBy('disagreement_type')
      .select('disagreement_type', db.raw('COUNT(*) as count'))
      .orderBy('count', 'desc')
      .limit(5);

    // Elements with most corrections
    const topElements = await db('feedback_corrections as c')
      .leftJoin('rubric_elements as e', 'c.element_id', 'e.id')
      .groupBy('c.element_id', 'e.name')
      .select('c.element_id', 'e.name as element_name', db.raw('COUNT(*) as count'))
      .orderBy('count', 'desc')
      .limit(10);

    // Feedback trend (last 30 days)
    const trend = await db('ai_feedback')
      .where('created_at', '>=', db.raw("NOW() - INTERVAL '30 days'"))
      .groupBy(db.raw('DATE(created_at)'))
      .select(
        db.raw('DATE(created_at) as date'),
        db.raw('COUNT(*) as count'),
        db.raw('AVG(accuracy_rating) as avg_accuracy')
      )
      .orderBy('date', 'asc');

    // Build agreement distribution
    const agreementDistribution: Record<AgreementLevel, number> = {
      strongly_agree: 0,
      agree: 0,
      neutral: 0,
      disagree: 0,
      strongly_disagree: 0,
    };
    agreementDist.forEach((a: any) => {
      agreementDistribution[a.overall_agreement as AgreementLevel] = parseInt(a.count) || 0;
    });

    return {
      totalFeedback: parseInt(stats?.total_feedback) || 0,
      averageAccuracyRating: parseFloat(stats?.avg_accuracy) || 0,
      averageHelpfulnessRating: parseFloat(stats?.avg_helpfulness) || 0,
      agreementDistribution,
      totalCorrections: parseInt(correctionStats?.total) || 0,
      averageScoreDifference: parseFloat(correctionStats?.avg_diff) || 0,
      commonDisagreementTypes: disagreementTypes.map((d: any) => ({
        type: d.disagreement_type as DisagreementType,
        count: parseInt(d.count) || 0,
      })),
      elementsWithMostCorrections: topElements.map((e: any) => ({
        elementId: e.element_id,
        elementName: e.element_name,
        count: parseInt(e.count) || 0,
      })),
      feedbackTrend: trend.map((t: any) => ({
        date: t.date,
        count: parseInt(t.count) || 0,
        avgAccuracy: parseFloat(t.avg_accuracy) || 0,
      })),
    };
  },

  /**
   * Export training data for AI fine-tuning
   */
  async createTrainingExport(params: {
    exportName: string;
    description?: string;
    exportFormat?: string;
    dataFrom?: Date;
    dataTo?: Date;
    minAccuracyRating?: number;
    validatedOnly?: boolean;
    requestedBy: string;
  }): Promise<TrainingExport> {
    const exportId = uuidv4();

    await db('ai_training_exports').insert({
      id: exportId,
      export_name: params.exportName,
      description: params.description || null,
      export_format: params.exportFormat || 'jsonl',
      data_from: params.dataFrom || null,
      data_to: params.dataTo || null,
      min_accuracy_rating: params.minAccuracyRating || null,
      validated_only: params.validatedOnly ?? true,
      status: 'pending',
      requested_by: params.requestedBy,
    });

    // Log audit
    await logAudit({
      userId: params.requestedBy,
      action: 'create_training_export',
      targetType: 'ai_training_export',
      targetId: exportId,
    });

    return this.getExportById(exportId);
  },

  /**
   * Get training data for export (called by export job)
   */
  async getTrainingData(params: {
    dataFrom?: Date;
    dataTo?: Date;
    minAccuracyRating?: number;
    validatedOnly?: boolean;
  }): Promise<Array<{
    observation: any;
    feedback: AIFeedback;
    corrections: FeedbackCorrection[];
  }>> {
    let feedbackQuery = db('ai_feedback as f')
      .leftJoin('ai_observations as o', 'f.observation_id', 'o.id')
      .where('f.approved_for_training', true);

    if (params.dataFrom) {
      feedbackQuery = feedbackQuery.where('f.created_at', '>=', params.dataFrom);
    }
    if (params.dataTo) {
      feedbackQuery = feedbackQuery.where('f.created_at', '<=', params.dataTo);
    }
    if (params.minAccuracyRating) {
      feedbackQuery = feedbackQuery.where('f.accuracy_rating', '>=', params.minAccuracyRating);
    }

    const feedbacks = await feedbackQuery.select('f.*', 'o.*');

    const result: Array<{ observation: any; feedback: AIFeedback; corrections: FeedbackCorrection[] }> = [];

    for (const feedback of feedbacks) {
      let correctionsQuery = db('feedback_corrections as c')
        .leftJoin('rubric_elements as e', 'c.element_id', 'e.id')
        .leftJoin('rubric_domains as d', 'e.domain_id', 'd.id')
        .where('c.feedback_id', feedback.id);

      if (params.validatedOnly) {
        correctionsQuery = correctionsQuery.where('c.validated', true);
      }

      const corrections = await correctionsQuery.select(
        'c.*',
        'e.name as element_name',
        'd.name as domain_name'
      );

      result.push({
        observation: feedback,
        feedback: this.formatFeedback(feedback, []),
        corrections: corrections.map((c: any) => this.formatCorrection(c)),
      });
    }

    return result;
  },

  /**
   * Get export by ID
   */
  async getExportById(exportId: string): Promise<TrainingExport> {
    const exp = await db('ai_training_exports').where('id', exportId).first();

    if (!exp) {
      throw new Error('Export not found');
    }

    return {
      id: exp.id,
      exportName: exp.export_name,
      description: exp.description,
      exportFormat: exp.export_format,
      dataFrom: exp.data_from,
      dataTo: exp.data_to,
      minAccuracyRating: exp.min_accuracy_rating,
      validatedOnly: exp.validated_only,
      totalObservations: exp.total_observations,
      totalCorrections: exp.total_corrections,
      totalFeedbackEntries: exp.total_feedback_entries,
      status: exp.status,
      filePath: exp.file_path,
      fileSizeBytes: exp.file_size_bytes,
      errorMessage: exp.error_message,
      requestedBy: exp.requested_by,
      completedAt: exp.completed_at,
      createdAt: exp.created_at,
    };
  },

  /**
   * Format database row to AIFeedback
   */
  formatFeedback(row: any, corrections: any[]): AIFeedback {
    return {
      id: row.id,
      observationId: row.observation_id,
      userId: row.user_id,
      videoId: row.video_id,
      accuracyRating: row.accuracy_rating,
      helpfulnessRating: row.helpfulness_rating,
      detailRating: row.detail_rating,
      overallAgreement: row.overall_agreement,
      elementsAgreed: row.elements_agreed || 0,
      elementsDisagreed: row.elements_disagreed || 0,
      feedbackText: row.feedback_text,
      whatWasMissed: row.what_was_missed,
      whatWasIncorrect: row.what_was_incorrect,
      suggestions: row.suggestions,
      feedbackCategories: typeof row.feedback_categories === 'string'
        ? JSON.parse(row.feedback_categories)
        : row.feedback_categories || [],
      approvedForTraining: row.approved_for_training,
      containsCorrections: row.contains_corrections,
      approvedAt: row.approved_at,
      approvedBy: row.approved_by,
      userExpertiseWeight: parseFloat(row.user_expertise_weight) || 1.0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      userName: row.user_name,
      corrections: corrections.map((c: any) => this.formatCorrection(c)),
    };
  },

  /**
   * Format database row to FeedbackCorrection
   */
  formatCorrection(row: any): FeedbackCorrection {
    return {
      id: row.id,
      feedbackId: row.feedback_id,
      elementId: row.element_id,
      userId: row.user_id,
      aiScore: row.ai_score,
      correctedScore: row.corrected_score,
      scoreDifference: row.score_difference,
      aiConfidence: row.ai_confidence,
      userConfidence: row.user_confidence,
      correctionReason: row.correction_reason,
      evidenceDescription: row.evidence_description,
      timestampReferences: typeof row.timestamp_references === 'string'
        ? JSON.parse(row.timestamp_references)
        : row.timestamp_references || [],
      disagreementType: row.disagreement_type,
      validated: row.validated,
      includedInTraining: row.included_in_training,
      validatedAt: row.validated_at,
      validatedBy: row.validated_by,
      createdAt: row.created_at,
      elementName: row.element_name,
      domainName: row.domain_name,
    };
  },
};

export default feedbackService;
