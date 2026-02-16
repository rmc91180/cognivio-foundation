import { Router, Request, Response } from 'express';
import { db } from '../utils/db';
import { authenticateToken } from '../middleware/auth';
import { DashboardSummary, StatusColor } from '../types';
import { colorFromScore, DEFAULT_THRESHOLDS } from '../utils/aggregation';

const router = Router();

/**
 * GET /api/dashboard/summary
 * Get homepage dashboard summary data
 */
router.get('/summary', authenticateToken, async (req: Request, res: Response) => {
  try {
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

    // Get user preferences for default template
    const preferences = await db('user_preferences')
      .where('user_id', userId)
      .first();

    // Get active rubric template
    let activeTemplate = null;
    if (preferences?.default_template_id) {
      activeTemplate = await db('rubric_templates')
        .where('id', preferences.default_template_id)
        .first();
    }

    // If no default, get first active template
    if (!activeTemplate) {
      activeTemplate = await db('rubric_templates')
        .where('is_active', true)
        .orderBy('is_system_template', 'desc')
        .first();
    }

    // Get teacher counts by status
    let teacherQuery = db('teachers').where('status', 'active').where('school_id', schoolId);
    const teachers = await teacherQuery;

    // Calculate color distribution from latest assessments
    let greenCount = 0;
    let yellowCount = 0;
    let redCount = 0;

    for (const teacher of teachers) {
      // Get latest assessment score
      const latestAssessment = await db('assessments')
        .where('teacher_id', teacher.id)
        .whereNotNull('overall_score')
        .orderBy('observation_date', 'desc')
        .first();

      if (latestAssessment?.overall_score) {
        const color = colorFromScore(
          latestAssessment.overall_score,
          {
            greenMin: preferences?.color_threshold_green || DEFAULT_THRESHOLDS.greenMin,
            yellowMin: preferences?.color_threshold_yellow || DEFAULT_THRESHOLDS.yellowMin,
          }
        );
        if (color === 'green') greenCount++;
        else if (color === 'yellow') yellowCount++;
        else redCount++;
      } else {
        // No assessment = needs attention
        redCount++;
      }
    }

    // Get missing grades count
    const missingGradesResult = await db('gradebook_status')
      .whereIn('teacher_id', teachers.map(t => t.id))
      .where('missing_grades', true)
      .count('id as count')
      .first();
    const missingGradesCount = parseInt(missingGradesResult?.count as string) || 0;

    // Get creator name for active template
    let lastEditedBy = 'System';
    if (activeTemplate?.created_by) {
      const creator = await db('users').where('id', activeTemplate.created_by).first();
      lastEditedBy = creator?.name || 'Unknown';
    }

    const summary: DashboardSummary = {
      activeRubricId: activeTemplate?.id || '',
      activeRubricName: activeTemplate?.name || 'No template selected',
      activeRubricVersion: activeTemplate?.version || 'v1.0',
      lastEditedAt: activeTemplate?.updated_at?.toISOString() || new Date().toISOString(),
      lastEditedBy,
      totalTeachers: teachers.length,
      greenTeachers: greenCount,
      yellowTeachers: yellowCount,
      redTeachers: redCount,
      missingGradesCount,
      recentReports: [
        // Stub reports - TODO: Implement real reports
        {
          id: 'report_1',
          title: 'Q1 Performance Summary',
          lastSent: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          recipientCount: teachers.length,
        },
      ],
    };

    return res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred fetching dashboard data',
      },
    });
  }
});

export default router;
