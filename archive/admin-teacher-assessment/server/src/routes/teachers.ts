import { Router, Request, Response } from 'express';
import { db } from '../utils/db';
import { authenticateToken } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import {
  TeacherDetail,
  ElementScore,
  AIObservation,
  VideoEvidence,
  ObservationHistoryItem,
  GradebookStatusSummary,
  TrendDirection,
} from '../types';
import {
  colorFromScore,
  calculateProblemScore,
  DEFAULT_THRESHOLDS,
} from '../utils/aggregation';

const router = Router();

/**
 * GET /api/teachers/:teacherId/detail
 * Get comprehensive teacher dashboard data
 */
router.get('/:teacherId/detail', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { teacherId } = req.params;
    const { templateId, start, end } = req.query;
    const userId = req.user!.userId;
    const schoolId = req.user!.schoolId;

    if (!schoolId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'User must be associated with a school',
        },
      });
    }

    if (!templateId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'templateId is required',
        },
      });
    }

    // Get teacher
    const teacher = await db('teachers')
      .where('id', teacherId)
      .where('school_id', schoolId)
      .first();

    if (!teacher) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Teacher not found',
        },
      });
    }

    // Get user preferences
    const preferences = await db('user_preferences')
      .where('user_id', userId)
      .first();

    const thresholds = {
      greenMin: preferences?.color_threshold_green || DEFAULT_THRESHOLDS.greenMin,
      yellowMin: preferences?.color_threshold_yellow || DEFAULT_THRESHOLDS.yellowMin,
    };

    const pinnedElementIds = preferences?.pinned_element_ids || [];

    // Set date range (default last 30 days)
    const endDate = end ? new Date(end as string) : new Date();
    const startDate = start
      ? new Date(start as string)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Previous period for comparison
    const periodLength = endDate.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - periodLength);
    const prevEndDate = new Date(startDate.getTime() - 1);

    // Get current period assessments
    const currentAssessments = await db('assessments')
      .where('teacher_id', teacherId)
      .where('template_id', templateId)
      .where('observation_date', '>=', startDate)
      .where('observation_date', '<=', endDate)
      .orderBy('observation_date', 'desc');

    // Get previous period assessments for comparison
    const previousAssessments = await db('assessments')
      .where('teacher_id', teacherId)
      .where('template_id', templateId)
      .where('observation_date', '>=', prevStartDate)
      .where('observation_date', '<=', prevEndDate);

    // Get all elements for template
    const elements = await db('rubric_elements')
      .join('rubric_domains', 'rubric_domains.id', 'rubric_elements.domain_id')
      .where('rubric_elements.template_id', templateId)
      .select(
        'rubric_elements.*',
        'rubric_domains.name as domain_name'
      )
      .orderBy('rubric_domains.sort_order')
      .orderBy('rubric_elements.sort_order');

    // Calculate element scores
    const elementScores: ElementScore[] = [];
    let totalScore = 0;
    let scoreCount = 0;

    for (const elem of elements) {
      // Get current scores for this element
      const currentScores = await db('assessment_elements')
        .whereIn('assessment_id', currentAssessments.map(a => a.id))
        .where('element_id', elem.id);

      // Get previous period scores
      const previousScores = await db('assessment_elements')
        .whereIn('assessment_id', previousAssessments.map(a => a.id))
        .where('element_id', elem.id);

      // Get AI observations for this element
      const aiObs = await db('ai_observations')
        .join('video_evidence', 'video_evidence.id', 'ai_observations.video_id')
        .where('video_evidence.teacher_id', teacherId)
        .where('ai_observations.element_id', elem.id)
        .where('ai_observations.created_at', '>=', startDate)
        .where('ai_observations.created_at', '<=', endDate)
        .select('ai_observations.*');

      // Calculate averages
      const currentAvg = currentScores.length > 0
        ? currentScores.reduce((sum, s) => sum + parseFloat(s.score), 0) / currentScores.length
        : null;

      const previousAvg = previousScores.length > 0
        ? previousScores.reduce((sum, s) => sum + parseFloat(s.score), 0) / previousScores.length
        : null;

      // Determine trend
      let trend: TrendDirection = 'stable';
      if (currentAvg !== null && previousAvg !== null) {
        const diff = currentAvg - previousAvg;
        if (diff > 5) trend = 'up';
        else if (diff < -5) trend = 'down';
      }

      const numericScore = currentAvg ?? 0;
      const avgConfidence = aiObs.length > 0
        ? aiObs.reduce((sum, o) => sum + parseFloat(o.confidence), 0) / aiObs.length
        : 0;

      const problemScore = calculateProblemScore(
        numericScore,
        previousAvg,
        parseFloat(elem.default_weight) || 1,
        currentScores.length,
        avgConfidence
      );

      if (currentAvg !== null) {
        totalScore += currentAvg;
        scoreCount++;
      }

      elementScores.push({
        elementId: elem.id,
        elementName: elem.name,
        domain: elem.domain_name,
        numericScore: Math.round(numericScore * 100) / 100,
        color: colorFromScore(numericScore, thresholds),
        previousScore: previousAvg ? Math.round(previousAvg * 100) / 100 : null,
        trend,
        lastObserved: currentScores[0]?.created_at?.toISOString() || null,
        observationCount: currentScores.length,
        evidenceIds: currentScores.flatMap(s => s.evidence_ids || []),
        aiObservationIds: aiObs.map(o => o.id),
        isPinned: pinnedElementIds.includes(elem.id),
        problemScore,
      });
    }

    // Get AI observations
    const aiObservations = await db('ai_observations')
      .join('video_evidence', 'video_evidence.id', 'ai_observations.video_id')
      .where('video_evidence.teacher_id', teacherId)
      .where('ai_observations.created_at', '>=', startDate)
      .where('ai_observations.created_at', '<=', endDate)
      .select('ai_observations.*')
      .orderBy('ai_observations.created_at', 'desc');

    // Get video evidence
    const videoEvidence = await db('video_evidence')
      .where('teacher_id', teacherId)
      .where('created_at', '>=', startDate)
      .where('created_at', '<=', endDate)
      .orderBy('created_at', 'desc');

    // Get gradebook status
    const gradebook = await db('gradebook_status')
      .where('teacher_id', teacherId)
      .first();

    const gradebookStatus: GradebookStatusSummary = {
      isHealthy: gradebook?.is_healthy ?? true,
      missingGrades: gradebook?.missing_grades ?? false,
      classesMissing: gradebook?.classes_missing || [],
      lastUpdated: gradebook?.last_synced_at?.toISOString() || null,
    };

    // Build observation history
    const observationHistory: ObservationHistoryItem[] = [];

    for (const assessment of currentAssessments) {
      const observer = assessment.observer_id
        ? await db('users').where('id', assessment.observer_id).first()
        : null;

      const assessmentElements = await db('assessment_elements')
        .where('assessment_id', assessment.id);

      observationHistory.push({
        id: assessment.id,
        type: 'human',
        observerId: assessment.observer_id,
        observerName: observer?.name,
        date: assessment.observation_date?.toISOString() || assessment.created_at.toISOString(),
        elementsObserved: assessmentElements.map(e => e.element_id),
        summary: assessment.notes || 'Classroom observation',
      });
    }

    // Add AI observations to history
    for (const aiObs of aiObservations) {
      observationHistory.push({
        id: aiObs.id,
        type: 'ai',
        date: aiObs.created_at.toISOString(),
        elementsObserved: [aiObs.element_id],
        summary: aiObs.summary || 'AI video analysis',
        evidenceId: aiObs.video_id,
      });
    }

    // Sort history by date
    observationHistory.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Calculate overall scores
    const overallScore = scoreCount > 0 ? totalScore / scoreCount : 0;
    const overallColor = colorFromScore(overallScore, thresholds);

    // Calculate previous period score
    let previousPeriodScore = null;
    if (previousAssessments.length > 0) {
      const prevScores = await db('assessments')
        .whereIn('id', previousAssessments.map(a => a.id))
        .whereNotNull('overall_score');
      if (prevScores.length > 0) {
        previousPeriodScore = prevScores.reduce(
          (sum, a) => sum + parseFloat(a.overall_score),
          0
        ) / prevScores.length;
      }
    }

    // Calculate school average (simplified)
    const schoolTeachers = await db('teachers')
      .where('school_id', teacher.school_id)
      .where('status', 'active');

    let schoolTotal = 0;
    let schoolCount = 0;
    for (const t of schoolTeachers) {
      const latestAssessment = await db('assessments')
        .where('teacher_id', t.id)
        .whereNotNull('overall_score')
        .orderBy('observation_date', 'desc')
        .first();
      if (latestAssessment) {
        schoolTotal += parseFloat(latestAssessment.overall_score);
        schoolCount++;
      }
    }
    const schoolAverage = schoolCount > 0 ? schoolTotal / schoolCount : 75;

    const detail: TeacherDetail = {
      teacher,
      overallScore: Math.round(overallScore * 100) / 100,
      overallColor,
      previousPeriodScore: previousPeriodScore
        ? Math.round(previousPeriodScore * 100) / 100
        : null,
      schoolAverage: Math.round(schoolAverage * 100) / 100,
      elementScores,
      aiObservations: aiObservations.map(o => ({
        ...o,
        key_moments: o.key_moments || [],
      })),
      videoEvidence,
      gradebookStatus,
      observationHistory,
    };

    return res.json({
      success: true,
      data: detail,
    });
  } catch (error) {
    console.error('Get teacher detail error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred fetching teacher details',
      },
    });
  }
});

/**
 * GET /api/teachers/:teacherId/summary
 * Get quick summary for roster quick-view
 */
router.get('/:teacherId/summary', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { teacherId } = req.params;
    const { columnId } = req.query;
    const schoolId = req.user!.schoolId;

    if (!schoolId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'User must be associated with a school',
        },
      });
    }

    const teacher = await db('teachers')
      .where('id', teacherId)
      .where('school_id', schoolId)
      .first();

    if (!teacher) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Teacher not found',
        },
      });
    }

    // Get column info if provided
    let columnName = 'Overall';
    let elements: { id: string; name: string; score: number; color: string }[] = [];

    if (columnId) {
      const column = await db('template_columns')
        .where('id', columnId)
        .first();

      if (column) {
        columnName = column.name;

        // Get elements assigned to this column
        const assignments = await db('template_column_assignments')
          .join('rubric_elements', 'rubric_elements.id', 'template_column_assignments.element_id')
          .where('column_id', columnId)
          .select('rubric_elements.*');

        for (const elem of assignments) {
          // Get latest score
          const latestScore = await db('assessment_elements')
            .join('assessments', 'assessments.id', 'assessment_elements.assessment_id')
            .where('assessment_elements.element_id', elem.id)
            .where('assessments.teacher_id', teacherId)
            .orderBy('assessments.observation_date', 'desc')
            .first();

          const score = latestScore ? parseFloat(latestScore.score) : 0;

          elements.push({
            id: elem.id,
            name: elem.name,
            score,
            color: colorFromScore(score, DEFAULT_THRESHOLDS),
          });
        }
      }
    }

    return res.json({
      success: true,
      data: {
        teacherName: teacher.name,
        columnName,
        elements,
      },
    });
  } catch (error) {
    console.error('Get teacher summary error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred',
      },
    });
  }
});

export default router;
