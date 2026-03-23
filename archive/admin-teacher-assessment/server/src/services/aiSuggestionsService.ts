import { db } from '../utils/db';
import { v4 as uuidv4 } from 'uuid';
import { logAudit } from './auditService';

// ===========================================
// Types
// ===========================================

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
  evidenceBasis: Record<string, unknown>;
  confidenceScore?: number;
  patternDetected?: PatternType;
  modelVersion?: string;
  status: SuggestionStatus;
  acceptedAt?: Date;
  acceptedBy?: string;
  rejectedAt?: Date;
  rejectedBy?: string;
  rejectionReason?: string;
  completedAt?: Date;
  completionNotes?: string;
  expiresAt?: Date;
  helpfulnessRating?: number;
  feedbackNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GenerateSuggestionsInput {
  teacherId: string;
  principalId: string;
  templateId?: string;
}

export interface SuggestionFilters {
  status?: SuggestionStatus;
  priority?: SuggestionPriority;
  suggestionType?: SuggestionType;
  teacherId?: string;
  principalId?: string;
  patternDetected?: PatternType;
  page?: number;
  pageSize?: number;
}

// ===========================================
// Suggestion Templates by Pattern
// ===========================================

const SUGGESTION_TEMPLATES: Record<PatternType, {
  type: SuggestionType;
  priority: SuggestionPriority;
  titleTemplate: string;
  descriptionTemplate: string;
  actionItems: string[];
}> = {
  declining_trend: {
    type: 'observation',
    priority: 'high',
    titleTemplate: 'Schedule observation for {teacherName}',
    descriptionTemplate: '{teacherName} has shown a declining trend in {domainName} over the past {periodCount} observation periods. Scores have dropped from {startScore} to {endScore}.',
    actionItems: [
      'Schedule a classroom observation within the next 2 weeks',
      'Focus observation on identified areas of concern',
      'Prepare targeted feedback and support resources',
      'Schedule follow-up meeting to discuss observations',
    ],
  },
  consistent_low: {
    type: 'intervention',
    priority: 'high',
    titleTemplate: 'Intervention needed for {teacherName}',
    descriptionTemplate: '{teacherName} has consistently scored below expectations in {domainName} across {observationCount} observations. Average score is {avgScore}/100.',
    actionItems: [
      'Schedule one-on-one meeting to discuss performance',
      'Develop a targeted improvement plan',
      'Assign mentor teacher for peer support',
      'Provide specific professional development resources',
      'Schedule bi-weekly check-ins for progress monitoring',
    ],
  },
  improvement_stall: {
    type: 'coaching',
    priority: 'medium',
    titleTemplate: 'Coaching opportunity for {teacherName}',
    descriptionTemplate: '{teacherName} showed initial improvement but progress has stalled in {domainName}. Score has remained at {currentScore} for {stallPeriods} periods.',
    actionItems: [
      'Provide new instructional strategies',
      'Consider peer observation opportunity',
      'Review and adjust current improvement plan',
      'Explore different professional development approaches',
    ],
  },
  high_performer: {
    type: 'recognition',
    priority: 'low',
    titleTemplate: 'Recognize excellence: {teacherName}',
    descriptionTemplate: '{teacherName} has demonstrated exceptional performance in {domainName} with an average score of {avgScore}/100. Consider for mentorship or leadership role.',
    actionItems: [
      'Send formal recognition or commendation',
      'Consider for mentor teacher program',
      'Invite to share best practices with colleagues',
      'Nominate for teaching excellence award',
    ],
  },
  volatile_scores: {
    type: 'observation',
    priority: 'medium',
    titleTemplate: 'Investigate score variability for {teacherName}',
    descriptionTemplate: '{teacherName} shows high variability in {domainName} scores (std dev: {stdDev}). This may indicate inconsistent practice or external factors.',
    actionItems: [
      'Schedule multiple short observations',
      'Review contextual factors (class composition, time of day)',
      'Discuss consistency strategies with teacher',
      'Consider environmental or resource support',
    ],
  },
  new_teacher: {
    type: 'coaching',
    priority: 'medium',
    titleTemplate: 'New teacher support: {teacherName}',
    descriptionTemplate: '{teacherName} is a new teacher ({monthsEmployed} months). Current performance in {domainName} is {currentScore}/100. Proactive support recommended.',
    actionItems: [
      'Assign experienced mentor teacher',
      'Schedule regular check-in meetings',
      'Provide new teacher orientation resources',
      'Plan classroom observation with supportive feedback',
    ],
  },
};

// ===========================================
// AI Suggestions Service
// ===========================================

export const aiSuggestionsService = {
  /**
   * Generate suggestions for a teacher based on their performance patterns
   */
  async generateSuggestions(input: GenerateSuggestionsInput): Promise<AISuggestion[]> {
    const { teacherId, principalId, templateId } = input;

    // Get teacher info
    const teacher = await db('teachers').where('id', teacherId).first();
    if (!teacher) {
      throw new Error('Teacher not found');
    }

    // Get active model version
    const activeModel = await db('ai_model_versions').where('is_active', true).first();
    const modelVersion = activeModel?.model_version || 'v1.0.0';

    // Analyze teacher's performance patterns
    const patterns = await this.analyzeTeacherPatterns(teacherId, templateId);

    // Generate suggestions based on patterns
    const suggestions: AISuggestion[] = [];

    for (const pattern of patterns) {
      // Check if similar suggestion already exists and is pending
      const existingSuggestion = await db('ai_suggestions')
        .where('teacher_id', teacherId)
        .where('pattern_detected', pattern.type)
        .where('status', 'pending')
        .first();

      if (existingSuggestion) {
        continue; // Don't duplicate pending suggestions
      }

      const template = SUGGESTION_TEMPLATES[pattern.type];
      if (!template) continue;

      // Fill in template placeholders
      const title = this.fillTemplate(template.titleTemplate, {
        teacherName: teacher.name,
        ...pattern.data,
      });

      const description = this.fillTemplate(template.descriptionTemplate, {
        teacherName: teacher.name,
        ...pattern.data,
      });

      const suggestionId = uuidv4();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30-day expiration

      await db('ai_suggestions').insert({
        id: suggestionId,
        teacher_id: teacherId,
        element_id: pattern.elementId || null,
        generated_for_user: principalId,
        suggestion_type: template.type,
        priority: template.priority,
        title,
        description,
        rationale: pattern.rationale,
        action_items: template.actionItems,
        related_elements: pattern.relatedElements || [],
        evidence_basis: JSON.stringify(pattern.evidence),
        confidence_score: pattern.confidence,
        pattern_detected: pattern.type,
        model_version: modelVersion,
        status: 'pending',
        expires_at: expiresAt,
      });

      suggestions.push(await this.getSuggestionById(suggestionId));
    }

    // Log audit
    await logAudit({
      userId: principalId,
      action: 'generate_suggestions',
      targetType: 'teacher',
      targetId: teacherId,
      details: { suggestionsGenerated: suggestions.length },
    });

    return suggestions;
  },

  /**
   * Analyze teacher performance patterns
   */
  async analyzeTeacherPatterns(teacherId: string, templateId?: string): Promise<Array<{
    type: PatternType;
    elementId?: string;
    confidence: number;
    rationale: string;
    evidence: Record<string, unknown>;
    relatedElements?: string[];
    data: Record<string, unknown>;
  }>> {
    const patterns: Array<{
      type: PatternType;
      elementId?: string;
      confidence: number;
      rationale: string;
      evidence: Record<string, unknown>;
      relatedElements?: string[];
      data: Record<string, unknown>;
    }> = [];

    // Get teacher info
    const teacher = await db('teachers').where('id', teacherId).first();
    const hireDate = teacher?.hire_date ? new Date(teacher.hire_date) : null;
    const monthsEmployed = hireDate
      ? Math.floor((Date.now() - hireDate.getTime()) / (1000 * 60 * 60 * 24 * 30))
      : null;

    // Get recent observations
    const observations = await db('ai_observations as o')
      .leftJoin('video_evidence as v', 'o.video_id', 'v.id')
      .leftJoin('rubric_elements as e', 'o.element_id', 'e.id')
      .leftJoin('rubric_domains as d', 'e.domain_id', 'd.id')
      .where('v.teacher_id', teacherId)
      .where('o.status', 'accepted')
      .where('o.created_at', '>=', db.raw("NOW() - INTERVAL '90 days'"))
      .select(
        'o.element_id',
        'o.score_estimate',
        'o.confidence',
        'o.created_at',
        'e.name as element_name',
        'd.name as domain_name',
        'd.id as domain_id'
      )
      .orderBy('o.created_at', 'asc');

    if (observations.length === 0) {
      // New teacher with no observations
      if (monthsEmployed !== null && monthsEmployed <= 6) {
        patterns.push({
          type: 'new_teacher',
          confidence: 0.8,
          rationale: 'New teacher with limited observation history',
          evidence: { monthsEmployed, observationCount: 0 },
          data: { monthsEmployed, currentScore: 'N/A', domainName: 'all domains' },
        });
      }
      return patterns;
    }

    // Group by domain for analysis
    const domainScores: Record<string, number[]> = {};
    const domainNames: Record<string, string> = {};

    for (const obs of observations) {
      const domainId = obs.domain_id;
      if (!domainScores[domainId]) {
        domainScores[domainId] = [];
        domainNames[domainId] = obs.domain_name;
      }
      domainScores[domainId].push(parseFloat(obs.score_estimate) || 0);
    }

    // Analyze each domain
    for (const [domainId, scores] of Object.entries(domainScores)) {
      const domainName = domainNames[domainId];
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      const stdDev = Math.sqrt(scores.map(s => Math.pow(s - avgScore, 2)).reduce((a, b) => a + b, 0) / scores.length);

      // Check for declining trend
      if (scores.length >= 3) {
        const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
        const secondHalf = scores.slice(Math.floor(scores.length / 2));
        const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

        if (secondAvg < firstAvg - 10) {
          patterns.push({
            type: 'declining_trend',
            confidence: Math.min(0.9, 0.6 + (firstAvg - secondAvg) / 50),
            rationale: `Scores declined from ${firstAvg.toFixed(0)} to ${secondAvg.toFixed(0)} over ${scores.length} observations`,
            evidence: { scores, firstAvg, secondAvg, observationCount: scores.length },
            data: {
              domainName,
              periodCount: scores.length,
              startScore: firstAvg.toFixed(0),
              endScore: secondAvg.toFixed(0),
            },
          });
        }
      }

      // Check for consistent low performance
      if (avgScore < 60 && scores.length >= 2) {
        patterns.push({
          type: 'consistent_low',
          confidence: Math.min(0.9, 0.5 + (60 - avgScore) / 100),
          rationale: `Average score of ${avgScore.toFixed(0)} is below proficiency threshold`,
          evidence: { scores, avgScore, observationCount: scores.length },
          data: {
            domainName,
            avgScore: avgScore.toFixed(0),
            observationCount: scores.length,
          },
        });
      }

      // Check for high performer
      if (avgScore >= 85 && scores.length >= 2) {
        patterns.push({
          type: 'high_performer',
          confidence: Math.min(0.95, 0.7 + (avgScore - 85) / 50),
          rationale: `Consistently high performance with average of ${avgScore.toFixed(0)}`,
          evidence: { scores, avgScore, observationCount: scores.length },
          data: {
            domainName,
            avgScore: avgScore.toFixed(0),
          },
        });
      }

      // Check for volatile scores
      if (stdDev > 15 && scores.length >= 3) {
        patterns.push({
          type: 'volatile_scores',
          confidence: Math.min(0.85, 0.5 + stdDev / 50),
          rationale: `High score variability with standard deviation of ${stdDev.toFixed(1)}`,
          evidence: { scores, stdDev, avgScore },
          data: {
            domainName,
            stdDev: stdDev.toFixed(1),
          },
        });
      }

      // Check for improvement stall
      if (scores.length >= 4) {
        const recentScores = scores.slice(-3);
        const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
        const recentStdDev = Math.sqrt(recentScores.map(s => Math.pow(s - recentAvg, 2)).reduce((a, b) => a + b, 0) / recentScores.length);

        // Stall if recent scores are stable but below proficiency
        if (recentStdDev < 5 && recentAvg < 75 && recentAvg > 50) {
          patterns.push({
            type: 'improvement_stall',
            confidence: 0.7,
            rationale: `Scores have plateaued at ${recentAvg.toFixed(0)} for recent observations`,
            evidence: { recentScores, recentAvg, recentStdDev },
            data: {
              domainName,
              currentScore: recentAvg.toFixed(0),
              stallPeriods: recentScores.length,
            },
          });
        }
      }
    }

    // New teacher pattern
    if (monthsEmployed !== null && monthsEmployed <= 6 && observations.length <= 3) {
      const overallAvg = observations.reduce((sum, o) => sum + (parseFloat(o.score_estimate) || 0), 0) / observations.length;
      patterns.push({
        type: 'new_teacher',
        confidence: 0.8,
        rationale: 'New teacher needing onboarding support',
        evidence: { monthsEmployed, observationCount: observations.length, avgScore: overallAvg },
        data: {
          monthsEmployed,
          currentScore: overallAvg.toFixed(0),
          domainName: 'overall performance',
        },
      });
    }

    // Sort by confidence and return top patterns
    return patterns.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
  },

  /**
   * Fill template placeholders with data
   */
  fillTemplate(template: string, data: Record<string, unknown>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return data[key] !== undefined ? String(data[key]) : match;
    });
  },

  /**
   * Get suggestions for a principal
   */
  async getSuggestionsForPrincipal(filters: SuggestionFilters = {}): Promise<{
    suggestions: AISuggestion[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let query = db('ai_suggestions as s')
      .leftJoin('teachers as t', 's.teacher_id', 't.id')
      .leftJoin('rubric_elements as e', 's.element_id', 'e.id')
      .leftJoin('users as u', 's.generated_for_user', 'u.id')
      .select(
        's.*',
        't.name as teacher_name',
        'e.name as element_name',
        'u.name as generated_for_user_name'
      );

    // Apply filters
    if (filters.principalId) {
      query = query.where('s.generated_for_user', filters.principalId);
    }
    if (filters.status) {
      query = query.where('s.status', filters.status);
    }
    if (filters.priority) {
      query = query.where('s.priority', filters.priority);
    }
    if (filters.suggestionType) {
      query = query.where('s.suggestion_type', filters.suggestionType);
    }
    if (filters.teacherId) {
      query = query.where('s.teacher_id', filters.teacherId);
    }
    if (filters.patternDetected) {
      query = query.where('s.pattern_detected', filters.patternDetected);
    }

    // Filter out expired suggestions
    query = query.where((qb) => {
      qb.whereNull('s.expires_at').orWhere('s.expires_at', '>', new Date());
    });

    // Get total count
    const countResult = await query.clone().count('s.id as count').first();
    const total = parseInt(countResult?.count as string) || 0;

    // Get paginated results with priority ordering
    const priorityOrder = { high: 1, medium: 2, low: 3 };
    const suggestions = await query
      .orderByRaw(`CASE s.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`)
      .orderBy('s.created_at', 'desc')
      .limit(pageSize)
      .offset(offset);

    return {
      suggestions: suggestions.map((row: any) => this.formatSuggestion(row)),
      total,
      page,
      pageSize,
    };
  },

  /**
   * Get a suggestion by ID
   */
  async getSuggestionById(suggestionId: string): Promise<AISuggestion> {
    const suggestion = await db('ai_suggestions as s')
      .leftJoin('teachers as t', 's.teacher_id', 't.id')
      .leftJoin('rubric_elements as e', 's.element_id', 'e.id')
      .leftJoin('users as u', 's.generated_for_user', 'u.id')
      .select(
        's.*',
        't.name as teacher_name',
        'e.name as element_name',
        'u.name as generated_for_user_name'
      )
      .where('s.id', suggestionId)
      .first();

    if (!suggestion) {
      throw new Error('Suggestion not found');
    }

    return this.formatSuggestion(suggestion);
  },

  /**
   * Accept a suggestion
   */
  async acceptSuggestion(suggestionId: string, userId: string): Promise<AISuggestion> {
    const suggestion = await db('ai_suggestions').where('id', suggestionId).first();

    if (!suggestion) {
      throw new Error('Suggestion not found');
    }

    if (suggestion.status !== 'pending') {
      throw new Error('Can only accept pending suggestions');
    }

    await db('ai_suggestions').where('id', suggestionId).update({
      status: 'accepted',
      accepted_at: new Date(),
      accepted_by: userId,
      updated_at: new Date(),
    });

    await logAudit({
      userId,
      action: 'accept_suggestion',
      targetType: 'ai_suggestion',
      targetId: suggestionId,
      details: { teacherId: suggestion.teacher_id },
    });

    return this.getSuggestionById(suggestionId);
  },

  /**
   * Reject a suggestion
   */
  async rejectSuggestion(suggestionId: string, userId: string, reason: string): Promise<AISuggestion> {
    const suggestion = await db('ai_suggestions').where('id', suggestionId).first();

    if (!suggestion) {
      throw new Error('Suggestion not found');
    }

    if (suggestion.status !== 'pending') {
      throw new Error('Can only reject pending suggestions');
    }

    await db('ai_suggestions').where('id', suggestionId).update({
      status: 'rejected',
      rejected_at: new Date(),
      rejected_by: userId,
      rejection_reason: reason,
      updated_at: new Date(),
    });

    await logAudit({
      userId,
      action: 'reject_suggestion',
      targetType: 'ai_suggestion',
      targetId: suggestionId,
      details: { teacherId: suggestion.teacher_id, reason },
    });

    return this.getSuggestionById(suggestionId);
  },

  /**
   * Complete a suggestion with notes and rating
   */
  async completeSuggestion(
    suggestionId: string,
    userId: string,
    notes: string,
    helpfulnessRating: number
  ): Promise<AISuggestion> {
    const suggestion = await db('ai_suggestions').where('id', suggestionId).first();

    if (!suggestion) {
      throw new Error('Suggestion not found');
    }

    if (suggestion.status !== 'accepted') {
      throw new Error('Can only complete accepted suggestions');
    }

    if (helpfulnessRating < 1 || helpfulnessRating > 5) {
      throw new Error('Helpfulness rating must be between 1 and 5');
    }

    await db('ai_suggestions').where('id', suggestionId).update({
      status: 'completed',
      completed_at: new Date(),
      completion_notes: notes,
      helpfulness_rating: helpfulnessRating,
      updated_at: new Date(),
    });

    await logAudit({
      userId,
      action: 'complete_suggestion',
      targetType: 'ai_suggestion',
      targetId: suggestionId,
      details: { teacherId: suggestion.teacher_id, helpfulnessRating },
    });

    return this.getSuggestionById(suggestionId);
  },

  /**
   * Expire old pending suggestions (called by cron)
   */
  async expireSuggestions(): Promise<number> {
    const result = await db('ai_suggestions')
      .where('status', 'pending')
      .where('expires_at', '<', new Date())
      .update({
        status: 'expired',
        updated_at: new Date(),
      });

    return result;
  },

  /**
   * Rank suggestions by importance (NICE TO ADD)
   */
  async rankSuggestions(suggestions: AISuggestion[]): Promise<AISuggestion[]> {
    // Scoring factors
    const priorityScores = { high: 100, medium: 50, low: 25 };
    const typeScores = { intervention: 30, observation: 25, coaching: 20, resource: 15, recognition: 10 };

    return suggestions.map(s => ({
      ...s,
      _rankScore: (priorityScores[s.priority] || 0) +
        (typeScores[s.suggestionType] || 0) +
        ((s.confidenceScore || 0) * 50),
    })).sort((a: any, b: any) => b._rankScore - a._rankScore);
  },

  /**
   * Get suggestion statistics
   */
  async getSuggestionStats(principalId?: string): Promise<{
    pending: number;
    accepted: number;
    rejected: number;
    completed: number;
    avgHelpfulness: number;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
  }> {
    let baseQuery = db('ai_suggestions');
    if (principalId) {
      baseQuery = baseQuery.where('generated_for_user', principalId);
    }

    const statusCounts = await baseQuery.clone()
      .groupBy('status')
      .select('status', db.raw('COUNT(*) as count'));

    const typeCounts = await baseQuery.clone()
      .groupBy('suggestion_type')
      .select('suggestion_type', db.raw('COUNT(*) as count'));

    const priorityCounts = await baseQuery.clone()
      .groupBy('priority')
      .select('priority', db.raw('COUNT(*) as count'));

    const avgHelpfulness = await baseQuery.clone()
      .whereNotNull('helpfulness_rating')
      .avg('helpfulness_rating as avg')
      .first();

    const statusMap: Record<string, number> = {};
    statusCounts.forEach((s: any) => { statusMap[s.status] = parseInt(s.count) || 0; });

    const byType: Record<string, number> = {};
    typeCounts.forEach((t: any) => { byType[t.suggestion_type] = parseInt(t.count) || 0; });

    const byPriority: Record<string, number> = {};
    priorityCounts.forEach((p: any) => { byPriority[p.priority] = parseInt(p.count) || 0; });

    return {
      pending: statusMap.pending || 0,
      accepted: statusMap.accepted || 0,
      rejected: statusMap.rejected || 0,
      completed: statusMap.completed || 0,
      avgHelpfulness: parseFloat(avgHelpfulness?.avg) || 0,
      byType,
      byPriority,
    };
  },

  /**
   * Format database row to AISuggestion
   */
  formatSuggestion(row: any): AISuggestion {
    return {
      id: row.id,
      teacherId: row.teacher_id,
      teacherName: row.teacher_name,
      elementId: row.element_id,
      elementName: row.element_name,
      generatedForUser: row.generated_for_user,
      generatedForUserName: row.generated_for_user_name,
      suggestionType: row.suggestion_type,
      priority: row.priority,
      title: row.title,
      description: row.description,
      rationale: row.rationale,
      actionItems: row.action_items || [],
      relatedElements: row.related_elements || [],
      evidenceBasis: typeof row.evidence_basis === 'string'
        ? JSON.parse(row.evidence_basis)
        : row.evidence_basis || {},
      confidenceScore: row.confidence_score ? parseFloat(row.confidence_score) : undefined,
      patternDetected: row.pattern_detected,
      modelVersion: row.model_version,
      status: row.status,
      acceptedAt: row.accepted_at,
      acceptedBy: row.accepted_by,
      rejectedAt: row.rejected_at,
      rejectedBy: row.rejected_by,
      rejectionReason: row.rejection_reason,
      completedAt: row.completed_at,
      completionNotes: row.completion_notes,
      expiresAt: row.expires_at,
      helpfulnessRating: row.helpfulness_rating,
      feedbackNotes: row.feedback_notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },
};

export default aiSuggestionsService;
