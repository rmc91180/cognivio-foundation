import { db } from '../utils/db';
import { v4 as uuidv4 } from 'uuid';
import { logAudit } from './auditService';

// ===========================================
// Types
// ===========================================

export interface AILearningEntry {
  id: string;
  teacherId: string;
  elementId: string;
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
  reviewerRole?: string;
  reviewerExpertiseWeight: number;
  cumulativeCorrections: number;
  averageDelta: number;
  modelVersion?: string;
  appliedToModel: boolean;
  appliedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  // Joined fields
  teacherName?: string;
  elementName?: string;
  reviewerName?: string;
}

export interface RecordLearningInput {
  teacherId: string;
  elementId: string;
  observationId?: string;
  correctionId?: string;
  originalAiScore: number;
  correctedScore: number;
  aiConfidence?: number;
  correctionType?: string;
  reviewerId: string;
}

export interface LearningHistoryParams {
  teacherId?: string;
  elementId?: string;
  startDate?: Date;
  endDate?: Date;
  correctionType?: string;
  frameworkType?: string;
  domainName?: string;
  modelVersion?: string;
  appliedToModel?: boolean;
  page?: number;
  pageSize?: number;
}

export interface PatternAnalysisParams {
  frameworkType?: string;
  domainName?: string;
  elementId?: string;
  modelVersion?: string;
  startDate?: Date;
  endDate?: Date;
  minSamples?: number;
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

export interface TrainingQueueItem {
  id: string;
  learningHistoryId: string;
  status: string;
  priority: number;
  qualityScore?: number;
  queuedAt: Date;
  processingStartedAt?: Date;
  processedAt?: Date;
  processingNotes?: string;
  errorMessage?: string;
  targetModelVersion?: string;
  batchId?: string;
}

// ===========================================
// AI Learning Service
// ===========================================

export const aiLearningService = {
  /**
   * Record a learning entry when a correction is made
   */
  async recordLearning(input: RecordLearningInput): Promise<AILearningEntry> {
    // Get teacher info for context
    const teacher = await db('teachers').where('id', input.teacherId).first();

    // Get element info for context
    const element = await db('rubric_elements as e')
      .leftJoin('rubric_domains as d', 'e.domain_id', 'd.id')
      .leftJoin('rubric_templates as t', 'd.template_id', 't.id')
      .select('e.id', 'e.name as element_name', 'd.name as domain_name', 't.source as framework_type')
      .where('e.id', input.elementId)
      .first();

    // Get reviewer info
    const reviewer = await db('users').where('id', input.reviewerId).first();
    const reviewerRole = reviewer?.active_role || reviewer?.roles?.[0] || 'observer';

    // Calculate reviewer expertise weight based on role
    const ROLE_WEIGHTS: Record<string, number> = {
      admin: 1.5,
      principal: 1.3,
      department_head: 1.2,
      observer: 1.1,
      teacher: 1.0,
    };
    const expertiseWeight = ROLE_WEIGHTS[reviewerRole] || 1.0;

    // Calculate cumulative stats for this element
    const existingStats = await db('ai_learning_history')
      .where('teacher_id', input.teacherId)
      .where('element_id', input.elementId)
      .select(
        db.raw('COUNT(*) as total_corrections'),
        db.raw('AVG(score_delta) as avg_delta')
      )
      .first();

    const stats = existingStats as { total_corrections?: string; avg_delta?: string } | undefined;
    const cumulativeCorrections = (parseInt(stats?.total_corrections || '0') || 0) + 1;
    const currentAvgDelta = parseFloat(stats?.avg_delta || '0') || 0;
    const newAvgDelta = ((currentAvgDelta * (cumulativeCorrections - 1)) + (input.correctedScore - input.originalAiScore)) / cumulativeCorrections;

    // Get current active model version
    const activeModel = await db('ai_model_versions')
      .where('is_active', true)
      .first();

    const learningId = uuidv4();
    const scoreDelta = input.correctedScore - input.originalAiScore;

    await db('ai_learning_history').insert({
      id: learningId,
      teacher_id: input.teacherId,
      element_id: input.elementId,
      observation_id: input.observationId || null,
      correction_id: input.correctionId || null,
      original_ai_score: input.originalAiScore,
      corrected_score: input.correctedScore,
      score_delta: scoreDelta,
      ai_confidence: input.aiConfidence || null,
      correction_type: input.correctionType || this.inferCorrectionType(scoreDelta),
      framework_type: element?.framework_type || null,
      domain_name: element?.domain_name || null,
      subjects: teacher?.subjects || [],
      grades: teacher?.grades || [],
      reviewer_id: input.reviewerId,
      reviewer_role: reviewerRole,
      reviewer_expertise_weight: expertiseWeight,
      cumulative_corrections: cumulativeCorrections,
      average_delta: newAvgDelta,
      model_version: activeModel?.model_version || 'v1.0.0',
      applied_to_model: false,
    });

    // Auto-enqueue for training if quality threshold met
    if (expertiseWeight >= 1.1) {
      await this.enqueueForTraining(learningId, expertiseWeight);
    }

    // Log audit
    await logAudit({
      userId: input.reviewerId,
      action: 'record_learning',
      targetType: 'ai_learning_history',
      targetId: learningId,
      details: {
        teacherId: input.teacherId,
        elementId: input.elementId,
        scoreDelta,
        cumulativeCorrections,
      },
    });

    return this.getLearningEntryById(learningId);
  },

  /**
   * Infer correction type from score delta
   */
  inferCorrectionType(scoreDelta: number): string {
    if (scoreDelta > 0) return 'score_too_low';
    if (scoreDelta < 0) return 'score_too_high';
    return 'evidence_only';
  },

  /**
   * Get learning history with filters
   */
  async getLearningHistory(params: LearningHistoryParams = {}): Promise<{
    entries: AILearningEntry[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = params.page || 1;
    const pageSize = params.pageSize || 50;
    const offset = (page - 1) * pageSize;

    let query = db('ai_learning_history as h')
      .leftJoin('teachers as t', 'h.teacher_id', 't.id')
      .leftJoin('rubric_elements as e', 'h.element_id', 'e.id')
      .leftJoin('users as u', 'h.reviewer_id', 'u.id')
      .select(
        'h.*',
        't.name as teacher_name',
        'e.name as element_name',
        'u.name as reviewer_name'
      );

    // Apply filters
    if (params.teacherId) {
      query = query.where('h.teacher_id', params.teacherId);
    }
    if (params.elementId) {
      query = query.where('h.element_id', params.elementId);
    }
    if (params.startDate) {
      query = query.where('h.created_at', '>=', params.startDate);
    }
    if (params.endDate) {
      query = query.where('h.created_at', '<=', params.endDate);
    }
    if (params.correctionType) {
      query = query.where('h.correction_type', params.correctionType);
    }
    if (params.frameworkType) {
      query = query.where('h.framework_type', params.frameworkType);
    }
    if (params.domainName) {
      query = query.where('h.domain_name', params.domainName);
    }
    if (params.modelVersion) {
      query = query.where('h.model_version', params.modelVersion);
    }
    if (params.appliedToModel !== undefined) {
      query = query.where('h.applied_to_model', params.appliedToModel);
    }

    // Get total count
    const countQuery = query.clone();
    const countResult = await countQuery.count('h.id as count').first();
    const total = parseInt(countResult?.count as string) || 0;

    // Get paginated results
    const entries = await query
      .orderBy('h.created_at', 'desc')
      .limit(pageSize)
      .offset(offset);

    return {
      entries: entries.map((row: any) => this.formatLearningEntry(row)),
      total,
      page,
      pageSize,
    };
  },

  /**
   * Get a single learning entry by ID
   */
  async getLearningEntryById(learningId: string): Promise<AILearningEntry> {
    const entry = await db('ai_learning_history as h')
      .leftJoin('teachers as t', 'h.teacher_id', 't.id')
      .leftJoin('rubric_elements as e', 'h.element_id', 'e.id')
      .leftJoin('users as u', 'h.reviewer_id', 'u.id')
      .select(
        'h.*',
        't.name as teacher_name',
        'e.name as element_name',
        'u.name as reviewer_name'
      )
      .where('h.id', learningId)
      .first();

    if (!entry) {
      throw new Error('Learning entry not found');
    }

    return this.formatLearningEntry(entry);
  },

  /**
   * Analyze patterns in AI corrections
   */
  async getPatternAnalysis(params: PatternAnalysisParams = {}): Promise<LearningPattern[]> {
    const minSamples = params.minSamples || 5;

    let query = db('ai_learning_history as h')
      .leftJoin('rubric_elements as e', 'h.element_id', 'e.id')
      .leftJoin('rubric_domains as d', 'e.domain_id', 'd.id')
      .groupBy('h.element_id', 'e.name', 'd.name', 'h.framework_type')
      .having(db.raw('COUNT(*) >= ?', [minSamples]))
      .select(
        'h.element_id',
        'e.name as element_name',
        'd.name as domain_name',
        'h.framework_type',
        db.raw('COUNT(*) as total_corrections'),
        db.raw('AVG(h.score_delta) as avg_delta'),
        db.raw('STDDEV(h.score_delta) as std_delta'),
        db.raw('CORR(h.ai_confidence, ABS(h.score_delta)) as confidence_correlation')
      );

    // Apply filters
    if (params.frameworkType) {
      query = query.where('h.framework_type', params.frameworkType);
    }
    if (params.domainName) {
      query = query.where('d.name', params.domainName);
    }
    if (params.elementId) {
      query = query.where('h.element_id', params.elementId);
    }
    if (params.modelVersion) {
      query = query.where('h.model_version', params.modelVersion);
    }
    if (params.startDate) {
      query = query.where('h.created_at', '>=', params.startDate);
    }
    if (params.endDate) {
      query = query.where('h.created_at', '<=', params.endDate);
    }

    const patterns = await query.orderBy('total_corrections', 'desc');

    // Get correction type distribution for each element
    const result: LearningPattern[] = [];

    for (const pattern of patterns) {
      const correctionTypes = await db('ai_learning_history')
        .where('element_id', pattern.element_id)
        .whereNotNull('correction_type')
        .groupBy('correction_type')
        .select('correction_type as type', db.raw('COUNT(*) as count'))
        .orderBy('count', 'desc');

      const avgDelta = parseFloat(pattern.avg_delta) || 0;
      const biasDirection = avgDelta > 0.3 ? 'low' : avgDelta < -0.3 ? 'high' : 'neutral';

      result.push({
        elementId: pattern.element_id,
        elementName: pattern.element_name,
        domainName: pattern.domain_name,
        frameworkType: pattern.framework_type,
        totalCorrections: parseInt(pattern.total_corrections) || 0,
        averageDelta: avgDelta,
        biasDirection,
        confidenceCorrelation: parseFloat(pattern.confidence_correlation) || 0,
        correctionTypes: correctionTypes.map((ct: any) => ({
          type: ct.type,
          count: parseInt(ct.count) || 0,
        })),
        recommendedAdjustment: this.calculateRecommendedAdjustment(avgDelta, parseInt(pattern.total_corrections) || 0),
      });
    }

    return result;
  },

  /**
   * Calculate recommended score adjustment based on patterns
   */
  calculateRecommendedAdjustment(avgDelta: number, sampleCount: number): number {
    // Weight adjustment by sample count (more samples = more confidence)
    const confidenceMultiplier = Math.min(1, sampleCount / 20);
    return avgDelta * confidenceMultiplier * 0.5; // Apply 50% of the average delta
  },

  /**
   * Calculate confidence adjustment for an element (MUST ADD)
   * Returns adjusted confidence based on historical correction patterns
   */
  async calculateConfidenceAdjustment(
    elementId: string,
    currentConfidence: number,
    modelVersion?: string
  ): Promise<ConfidenceAdjustment> {
    // Get recent corrections for this element (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const corrections = await db('ai_learning_history')
      .where('element_id', elementId)
      .where('created_at', '>=', thirtyDaysAgo)
      .modify((qb) => {
        if (modelVersion) {
          qb.where('model_version', modelVersion);
        }
      })
      .select(
        db.raw('COUNT(*) as recent_count'),
        db.raw('AVG(ABS(score_delta)) as avg_abs_delta'),
        db.raw('AVG(score_delta) as avg_delta')
      )
      .first();

    const totalCorrections = await db('ai_learning_history')
      .where('element_id', elementId)
      .count('id as count')
      .first();

    const recentCorrections = parseInt(corrections?.recent_count) || 0;
    const avgAbsDelta = parseFloat(corrections?.avg_abs_delta) || 0;
    const avgDelta = parseFloat(corrections?.avg_delta) || 0;
    const total = parseInt(totalCorrections?.count as string) || 0;

    // Calculate adjustment
    // High correction rate = lower confidence
    // Large average delta = lower confidence
    let adjustmentFactor = 1.0;
    let reason = 'No adjustments needed';

    if (recentCorrections >= 3) {
      // Significant recent corrections
      const correctionPenalty = Math.min(0.3, recentCorrections * 0.05);
      adjustmentFactor -= correctionPenalty;
      reason = `${recentCorrections} recent corrections`;
    }

    if (avgAbsDelta >= 0.5) {
      // Large average delta
      const deltaPenalty = Math.min(0.2, avgAbsDelta * 0.15);
      adjustmentFactor -= deltaPenalty;
      reason += reason ? `, avg delta ${avgAbsDelta.toFixed(2)}` : `Avg delta ${avgAbsDelta.toFixed(2)}`;
    }

    // Ensure confidence stays in valid range
    const adjustedConfidence = Math.max(0.1, Math.min(1.0, currentConfidence * adjustmentFactor));

    return {
      elementId,
      currentConfidence,
      adjustedConfidence,
      adjustmentReason: reason,
      correctionHistory: {
        totalCorrections: total,
        recentCorrections,
        averageDelta: avgDelta,
      },
    };
  },

  /**
   * Enqueue a learning entry for model training (MUST ADD)
   */
  async enqueueForTraining(learningHistoryId: string, qualityScore?: number): Promise<TrainingQueueItem> {
    // Check if already queued
    const existing = await db('ai_training_queue')
      .where('learning_history_id', learningHistoryId)
      .first();

    if (existing) {
      return this.formatTrainingQueueItem(existing);
    }

    const queueId = uuidv4();

    // Calculate priority based on quality score
    const priority = qualityScore ? Math.round(qualityScore * 100) : 50;

    await db('ai_training_queue').insert({
      id: queueId,
      learning_history_id: learningHistoryId,
      status: 'pending',
      priority,
      quality_score: qualityScore || null,
      queued_at: new Date(),
    });

    const item = await db('ai_training_queue').where('id', queueId).first();
    return this.formatTrainingQueueItem(item);
  },

  /**
   * Get pending items from training queue
   */
  async getTrainingQueue(limit: number = 100): Promise<TrainingQueueItem[]> {
    const items = await db('ai_training_queue')
      .where('status', 'pending')
      .orderBy('priority', 'desc')
      .orderBy('queued_at', 'asc')
      .limit(limit);

    return items.map((item: any) => this.formatTrainingQueueItem(item));
  },

  /**
   * Mark training queue item as processed
   */
  async markTrainingProcessed(
    queueId: string,
    success: boolean,
    notes?: string,
    batchId?: string
  ): Promise<void> {
    await db('ai_training_queue')
      .where('id', queueId)
      .update({
        status: success ? 'processed' : 'failed',
        processed_at: new Date(),
        processing_notes: notes || null,
        batch_id: batchId || null,
        error_message: success ? null : notes,
        updated_at: new Date(),
      });

    // If successful, mark the learning history entry as applied
    if (success) {
      const queueItem = await db('ai_training_queue').where('id', queueId).first();
      if (queueItem) {
        await db('ai_learning_history')
          .where('id', queueItem.learning_history_id)
          .update({
            applied_to_model: true,
            applied_at: new Date(),
            updated_at: new Date(),
          });
      }
    }
  },

  /**
   * Get current active model version
   */
  async getActiveModelVersion(): Promise<{
    version: string;
    type: string;
    name: string;
    deploymentDate: Date;
  } | null> {
    const model = await db('ai_model_versions')
      .where('is_active', true)
      .first();

    if (!model) return null;

    return {
      version: model.model_version,
      type: model.model_type,
      name: model.model_name,
      deploymentDate: model.deployment_date,
    };
  },

  /**
   * Create a new model version
   */
  async createModelVersion(params: {
    version: string;
    type: string;
    name: string;
    description?: string;
    config?: Record<string, unknown>;
    createdBy: string;
  }): Promise<void> {
    await db('ai_model_versions').insert({
      id: uuidv4(),
      model_version: params.version,
      model_type: params.type,
      model_name: params.name,
      description: params.description || null,
      config: JSON.stringify(params.config || {}),
      is_active: false,
      is_deprecated: false,
      created_by: params.createdBy,
    });

    await logAudit({
      userId: params.createdBy,
      action: 'create_model_version',
      targetType: 'ai_model_version',
      details: { version: params.version, type: params.type },
    });
  },

  /**
   * Activate a model version (deactivates others)
   */
  async activateModelVersion(version: string, userId: string): Promise<void> {
    await db.transaction(async (trx) => {
      // Deactivate all other versions
      await trx('ai_model_versions')
        .where('is_active', true)
        .update({ is_active: false, updated_at: new Date() });

      // Activate the specified version
      await trx('ai_model_versions')
        .where('model_version', version)
        .update({
          is_active: true,
          deployment_date: new Date(),
          updated_at: new Date(),
        });
    });

    await logAudit({
      userId,
      action: 'activate_model_version',
      targetType: 'ai_model_version',
      details: { version },
    });
  },

  /**
   * Export training data for model fine-tuning
   */
  async exportTrainingData(params: {
    modelVersion?: string;
    startDate?: Date;
    endDate?: Date;
    validatedOnly?: boolean;
    minExpertiseWeight?: number;
  } = {}): Promise<Array<{
    input: {
      elementId: string;
      elementName: string;
      frameworkType: string;
      domainName: string;
    };
    originalScore: number;
    correctedScore: number;
    confidence: number;
    expertiseWeight: number;
    context: {
      subjects: string[];
      grades: string[];
    };
  }>> {
    let query = db('ai_learning_history as h')
      .leftJoin('rubric_elements as e', 'h.element_id', 'e.id')
      .leftJoin('rubric_domains as d', 'e.domain_id', 'd.id')
      .select(
        'h.element_id',
        'e.name as element_name',
        'h.framework_type',
        'd.name as domain_name',
        'h.original_ai_score',
        'h.corrected_score',
        'h.ai_confidence',
        'h.reviewer_expertise_weight',
        'h.subjects',
        'h.grades'
      );

    if (params.modelVersion) {
      query = query.where('h.model_version', params.modelVersion);
    }
    if (params.startDate) {
      query = query.where('h.created_at', '>=', params.startDate);
    }
    if (params.endDate) {
      query = query.where('h.created_at', '<=', params.endDate);
    }
    if (params.minExpertiseWeight) {
      query = query.where('h.reviewer_expertise_weight', '>=', params.minExpertiseWeight);
    }

    const entries = await query.orderBy('h.created_at', 'asc');

    return entries.map((entry: any) => ({
      input: {
        elementId: entry.element_id,
        elementName: entry.element_name,
        frameworkType: entry.framework_type,
        domainName: entry.domain_name,
      },
      originalScore: entry.original_ai_score,
      correctedScore: entry.corrected_score,
      confidence: parseFloat(entry.ai_confidence) || 0,
      expertiseWeight: parseFloat(entry.reviewer_expertise_weight) || 1.0,
      context: {
        subjects: entry.subjects || [],
        grades: entry.grades || [],
      },
    }));
  },

  /**
   * Format database row to AILearningEntry
   */
  formatLearningEntry(row: any): AILearningEntry {
    return {
      id: row.id,
      teacherId: row.teacher_id,
      elementId: row.element_id,
      observationId: row.observation_id,
      correctionId: row.correction_id,
      originalAiScore: row.original_ai_score,
      correctedScore: row.corrected_score,
      scoreDelta: row.score_delta,
      aiConfidence: row.ai_confidence ? parseFloat(row.ai_confidence) : undefined,
      correctionType: row.correction_type,
      frameworkType: row.framework_type,
      domainName: row.domain_name,
      subjects: row.subjects || [],
      grades: row.grades || [],
      reviewerId: row.reviewer_id,
      reviewerRole: row.reviewer_role,
      reviewerExpertiseWeight: parseFloat(row.reviewer_expertise_weight) || 1.0,
      cumulativeCorrections: row.cumulative_corrections || 0,
      averageDelta: parseFloat(row.average_delta) || 0,
      modelVersion: row.model_version,
      appliedToModel: row.applied_to_model,
      appliedAt: row.applied_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      teacherName: row.teacher_name,
      elementName: row.element_name,
      reviewerName: row.reviewer_name,
    };
  },

  /**
   * Format database row to TrainingQueueItem
   */
  formatTrainingQueueItem(row: any): TrainingQueueItem {
    return {
      id: row.id,
      learningHistoryId: row.learning_history_id,
      status: row.status,
      priority: row.priority,
      qualityScore: row.quality_score ? parseFloat(row.quality_score) : undefined,
      queuedAt: row.queued_at,
      processingStartedAt: row.processing_started_at,
      processedAt: row.processed_at,
      processingNotes: row.processing_notes,
      errorMessage: row.error_message,
      targetModelVersion: row.target_model_version,
      batchId: row.batch_id,
    };
  },
};

export default aiLearningService;
