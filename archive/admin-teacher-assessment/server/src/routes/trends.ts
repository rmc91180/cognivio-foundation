import { Router, Request, Response } from 'express';
import { authenticateToken, requireRoles } from '../middleware/auth';
import { trendAnalysisService } from '../services/trendAnalysisService';

const router = Router();

// ===========================================
// Trend Analysis Routes
// ===========================================

/**
 * GET /api/trends/teacher/:teacherId
 * Get trend data for a teacher
 */
router.get('/teacher/:teacherId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { teacherId } = req.params;
    const { templateId, elementId, periodType, startDate, endDate } = req.query;

    const trends = await trendAnalysisService.getTrendData({
      teacherId,
      templateId: templateId as string,
      elementId: elementId as string,
      periodType: periodType as any,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });

    return res.json({
      success: true,
      data: trends,
    });
  } catch (error: any) {
    console.error('Error getting trends:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/trends/teacher/:teacherId/alerts
 * Get regression alerts for a teacher
 */
router.get('/teacher/:teacherId/alerts', authenticateToken, requireRoles('admin', 'principal', 'department_head'), async (req: Request, res: Response) => {
  try {
    const { teacherId } = req.params;

    const alerts = await trendAnalysisService.detectRegressions(teacherId);

    return res.json({
      success: true,
      data: alerts,
    });
  } catch (error: any) {
    console.error('Error getting regression alerts:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/trends/teacher/:teacherId/progress
 * Get progress reports for a teacher
 */
router.get('/teacher/:teacherId/progress', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { teacherId } = req.params;

    const progress = await trendAnalysisService.detectProgress(teacherId);

    return res.json({
      success: true,
      data: progress,
    });
  } catch (error: any) {
    console.error('Error getting progress reports:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/trends/teacher/:teacherId/predicted-risk
 * Get predicted future risk for a teacher
 */
router.get('/teacher/:teacherId/predicted-risk', authenticateToken, requireRoles('admin', 'principal', 'department_head'), async (req: Request, res: Response) => {
  try {
    const { teacherId } = req.params;
    const { elementId } = req.query;

    const riskPrediction = await trendAnalysisService.predictFutureRisk(teacherId, elementId as string);

    return res.json({
      success: true,
      data: riskPrediction,
    });
  } catch (error: any) {
    console.error('Error getting risk prediction:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * POST /api/trends/teacher/:teacherId/calculate
 * Calculate and store trends for a teacher
 */
router.post('/teacher/:teacherId/calculate', authenticateToken, requireRoles('admin', 'principal'), async (req: Request, res: Response) => {
  try {
    const { teacherId } = req.params;
    const { templateId, periodType } = req.body;

    if (!templateId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'templateId is required' },
      });
    }

    const trends = await trendAnalysisService.calculateTrends(
      teacherId,
      templateId,
      periodType || 'month'
    );

    return res.status(201).json({
      success: true,
      data: trends,
      meta: { count: trends.length },
    });
  } catch (error: any) {
    console.error('Error calculating trends:', error);
    if (error.message === 'Teacher not found') {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/trends/school
 * Get school-wide trend overview
 */
router.get('/school', authenticateToken, requireRoles('admin', 'principal'), async (req: Request, res: Response) => {
  try {
    const schoolId = req.user!.schoolId;

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'User must be associated with a school' },
      });
    }

    const overview = await trendAnalysisService.getSchoolOverview(schoolId);

    return res.json({
      success: true,
      data: overview,
    });
  } catch (error: any) {
    console.error('Error getting school overview:', error);
    if (error.message === 'School not found') {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/trends/school/:schoolId
 * Get school-wide trend overview for a specific school (admin only)
 */
router.get('/school/:schoolId', authenticateToken, requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { schoolId } = req.params;

    const overview = await trendAnalysisService.getSchoolOverview(schoolId);

    return res.json({
      success: true,
      data: overview,
    });
  } catch (error: any) {
    console.error('Error getting school overview:', error);
    if (error.message === 'School not found') {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * POST /api/trends/calculate
 * Bulk calculate trends for all teachers (cron endpoint)
 */
router.post('/calculate', authenticateToken, requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { schoolId, templateId, periodType } = req.body;

    if (!schoolId || !templateId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'schoolId and templateId are required' },
      });
    }

    // Get all active teachers in the school
    const { db } = await import('../utils/db');
    const teachers = await db('teachers')
      .where('school_id', schoolId)
      .where('status', 'active');

    const results: { teacherId: string; trendCount: number; error?: string }[] = [];

    for (const teacher of teachers) {
      try {
        const trends = await trendAnalysisService.calculateTrends(
          teacher.id,
          templateId,
          periodType || 'month'
        );
        results.push({ teacherId: teacher.id, trendCount: trends.length });
      } catch (err: any) {
        results.push({ teacherId: teacher.id, trendCount: 0, error: err.message });
      }
    }

    return res.json({
      success: true,
      data: {
        processedTeachers: results.length,
        successful: results.filter(r => !r.error).length,
        failed: results.filter(r => r.error).length,
        details: results,
      },
    });
  } catch (error: any) {
    console.error('Error bulk calculating trends:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

export default router;
