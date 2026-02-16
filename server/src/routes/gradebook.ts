import { Router, Request, Response } from 'express';
import { db } from '../utils/db';
import { authenticateToken } from '../middleware/auth';

const router = Router();

/**
 * GET /api/gradebook/status
 * Get gradebook status for multiple teachers
 *
 * This is a STUB implementation.
 * TODO: Integrate with real gradebook systems (PowerSchool, Canvas, etc.)
 */
router.get('/status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { teacherIds } = req.query;
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

    if (!teacherIds) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'teacherIds query parameter is required',
        },
      });
    }

    const ids = (teacherIds as string).split(',');

    const statuses = await db('gradebook_status as gs')
      .join('teachers as t', 'gs.teacher_id', 't.id')
      .whereIn('gs.teacher_id', ids)
      .where('t.school_id', schoolId)
      .select('gs.*');

    // Map to response format
    const data = statuses.map((s) => ({
      teacherId: s.teacher_id,
      isHealthy: s.is_healthy,
      missingGrades: s.missing_grades,
      classesMissing: s.classes_missing || [],
      lastUpdated: s.last_synced_at?.toISOString() || null,
    }));

    // Add stub entries for teachers without gradebook data
    for (const id of ids) {
      if (!data.find((d) => d.teacherId === id)) {
        data.push({
          teacherId: id,
          isHealthy: true,
          missingGrades: false,
          classesMissing: [],
          lastUpdated: null,
        });
      }
    }

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Get gradebook status error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred',
      },
    });
  }
});

/**
 * POST /api/gradebook/sync
 * Trigger gradebook sync (stub)
 *
 * TODO: Implement real gradebook sync with external systems
 */
router.post('/sync', authenticateToken, async (req: Request, res: Response) => {
  return res.json({
    success: true,
    data: {
      message: 'Gradebook sync is stubbed. TODO: Implement real integration.',
      syncedAt: new Date().toISOString(),
    },
  });
});

export default router;
