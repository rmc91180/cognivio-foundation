import { Router, Request, Response } from 'express';
import { db } from '../utils/db';
import { authenticateToken, requireRoles } from '../middleware/auth';

const router = Router();

/**
 * GET /api/audit
 * Get audit log entries
 */
router.get('/', authenticateToken, requireRoles('admin', 'principal'), async (req: Request, res: Response) => {
  try {
    const {
      targetType,
      targetId,
      action,
      startDate,
      endDate,
      page = '1',
      pageSize = '50',
    } = req.query;

    let query = db('audit_log').orderBy('created_at', 'desc');

    if (targetType) {
      query = query.where('target_type', targetType);
    }
    if (targetId) {
      query = query.where('target_id', targetId);
    }
    if (action) {
      query = query.where('action', action);
    }
    if (startDate) {
      query = query.where('created_at', '>=', new Date(startDate as string));
    }
    if (endDate) {
      query = query.where('created_at', '<=', new Date(endDate as string));
    }

    // Get total count
    const countResult = await query.clone().count('id as count').first();
    const totalItems = parseInt(countResult?.count as string) || 0;

    // Apply pagination
    const pageNum = parseInt(page as string);
    const pageSizeNum = parseInt(pageSize as string);

    const entries = await query
      .offset((pageNum - 1) * pageSizeNum)
      .limit(pageSizeNum);

    return res.json({
      success: true,
      data: entries.map((e) => ({
        id: e.id,
        userId: e.user_id,
        userName: e.user_name,
        action: e.action,
        targetType: e.target_type,
        targetId: e.target_id,
        details: e.details,
        timestamp: e.created_at,
      })),
      meta: {
        page: pageNum,
        pageSize: pageSizeNum,
        totalPages: Math.ceil(totalItems / pageSizeNum),
        totalItems,
      },
    });
  } catch (error) {
    console.error('Get audit log error:', error);
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
