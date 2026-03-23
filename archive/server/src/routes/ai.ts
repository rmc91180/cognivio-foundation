import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/db';
import { authenticateToken } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { ReviewAction } from '../types';

const router = Router();

/**
 * POST /api/ai/review
 * Review an AI observation (accept, reject, or edit)
 */
router.post('/review', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { observationId, action, edits } = req.body as {
      observationId: string;
      action: ReviewAction;
      edits?: { score?: number; notes?: string };
    };
    const userId = req.user!.userId;

    if (!observationId || !action) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'observationId and action are required',
        },
      });
    }

    if (!['accept', 'reject', 'edit'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'action must be accept, reject, or edit',
        },
      });
    }

    // Get observation
    const observation = await db('ai_observations')
      .where('id', observationId)
      .first();

    if (!observation) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'AI observation not found',
        },
      });
    }

    // Get user info
    const user = await db('users').where('id', userId).first();

    // Create or update review
    const existingReview = await db('ai_observation_reviews')
      .where('observation_id', observationId)
      .first();

    if (existingReview) {
      await db('ai_observation_reviews')
        .where('observation_id', observationId)
        .update({
          action,
          edited_score: edits?.score || null,
          notes: edits?.notes || null,
          reviewed_at: new Date(),
        });
    } else {
      await db('ai_observation_reviews').insert({
        id: uuidv4(),
        observation_id: observationId,
        reviewer_id: userId,
        action,
        edited_score: edits?.score || null,
        notes: edits?.notes || null,
        reviewed_at: new Date(),
      });
    }

    // Update observation status
    let newStatus = 'pending';
    if (action === 'accept') newStatus = 'accepted';
    else if (action === 'reject') newStatus = 'rejected';
    else if (action === 'edit') newStatus = 'edited';

    await db('ai_observations')
      .where('id', observationId)
      .update({ status: newStatus });

    // Log audit
    const auditId = uuidv4();
    await logAudit({
      userId,
      userName: user?.name,
      action: `ai_review_${action}`,
      targetType: 'ai_observation',
      targetId: observationId,
      details: {
        previousScore: observation.score_estimate,
        newScore: edits?.score,
        notes: edits?.notes,
      },
    });

    return res.json({
      success: true,
      data: {
        observationId,
        status: newStatus,
        reviewedAt: new Date().toISOString(),
        reviewedBy: user?.name,
        auditLogId: auditId,
      },
    });
  } catch (error) {
    console.error('AI review error:', error);
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
 * GET /api/ai/observations
 * Get AI observations for a teacher
 */
router.get('/observations', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { teacherId, status, videoId } = req.query;

    let query = db('ai_observations')
      .join('video_evidence', 'video_evidence.id', 'ai_observations.video_id')
      .select('ai_observations.*');

    if (teacherId) {
      query = query.where('video_evidence.teacher_id', teacherId);
    }

    if (status) {
      query = query.where('ai_observations.status', status);
    }

    if (videoId) {
      query = query.where('ai_observations.video_id', videoId);
    }

    const observations = await query.orderBy('ai_observations.created_at', 'desc');

    return res.json({
      success: true,
      data: observations,
    });
  } catch (error) {
    console.error('Get AI observations error:', error);
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
