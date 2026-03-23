import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/db';
import { authenticateToken } from '../middleware/auth';
import { logAudit } from '../services/auditService';

const router = Router();

/**
 * GET /api/settings/thresholds
 * Get current color thresholds
 */
router.get('/thresholds', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const preferences = await db('user_preferences')
      .where('user_id', userId)
      .first();

    return res.json({
      success: true,
      data: {
        greenMin: preferences?.color_threshold_green || 80,
        yellowMin: preferences?.color_threshold_yellow || 60,
      },
    });
  } catch (error) {
    console.error('Get thresholds error:', error);
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
 * PUT /api/settings/thresholds
 * Update color thresholds
 */
router.put('/thresholds', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { greenMin, yellowMin } = req.body;
    const userId = req.user!.userId;

    // Validate thresholds
    if (
      typeof greenMin !== 'number' ||
      typeof yellowMin !== 'number' ||
      greenMin < 0 ||
      greenMin > 100 ||
      yellowMin < 0 ||
      yellowMin > 100 ||
      yellowMin >= greenMin
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid thresholds. greenMin must be > yellowMin and both must be 0-100.',
        },
      });
    }

    // Update or create preferences
    const existing = await db('user_preferences')
      .where('user_id', userId)
      .first();

    if (existing) {
      await db('user_preferences')
        .where('user_id', userId)
        .update({
          color_threshold_green: greenMin,
          color_threshold_yellow: yellowMin,
          updated_at: new Date(),
        });
    } else {
      await db('user_preferences').insert({
        id: uuidv4(),
        user_id: userId,
        color_threshold_green: greenMin,
        color_threshold_yellow: yellowMin,
      });
    }

    const user = await db('users').where('id', userId).first();

    await logAudit({
      userId,
      userName: user?.name,
      action: 'update_thresholds',
      targetType: 'settings',
      details: { greenMin, yellowMin },
    });

    return res.json({
      success: true,
      data: {
        greenMin,
        yellowMin,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.name,
      },
    });
  } catch (error) {
    console.error('Update thresholds error:', error);
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
 * PUT /api/settings/preferences
 * Update user preferences
 */
router.put('/preferences', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { defaultTemplateId, pinnedElementIds, dashboardLayout } = req.body;
    const userId = req.user!.userId;

    const existing = await db('user_preferences')
      .where('user_id', userId)
      .first();

    const updates: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (defaultTemplateId !== undefined) {
      updates.default_template_id = defaultTemplateId;
    }
    if (pinnedElementIds !== undefined) {
      updates.pinned_element_ids = pinnedElementIds;
    }
    if (dashboardLayout !== undefined) {
      updates.dashboard_layout = dashboardLayout;
    }

    if (existing) {
      await db('user_preferences')
        .where('user_id', userId)
        .update(updates);
    } else {
      await db('user_preferences').insert({
        id: uuidv4(),
        user_id: userId,
        ...updates,
      });
    }

    return res.json({
      success: true,
      data: {
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Update preferences error:', error);
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
 * POST /api/settings/pinned-elements
 * Add or remove pinned elements
 */
router.post('/pinned-elements', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { elementId, action } = req.body; // action: 'add' | 'remove'
    const userId = req.user!.userId;

    if (!elementId || !['add', 'remove'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'elementId and action (add/remove) are required',
        },
      });
    }

    const preferences = await db('user_preferences')
      .where('user_id', userId)
      .first();

    let pinnedIds = preferences?.pinned_element_ids || [];

    if (action === 'add' && !pinnedIds.includes(elementId)) {
      pinnedIds.push(elementId);
    } else if (action === 'remove') {
      pinnedIds = pinnedIds.filter((id: string) => id !== elementId);
    }

    if (preferences) {
      await db('user_preferences')
        .where('user_id', userId)
        .update({
          pinned_element_ids: pinnedIds,
          updated_at: new Date(),
        });
    } else {
      await db('user_preferences').insert({
        id: uuidv4(),
        user_id: userId,
        pinned_element_ids: pinnedIds,
      });
    }

    return res.json({
      success: true,
      data: {
        pinnedElementIds: pinnedIds,
      },
    });
  } catch (error) {
    console.error('Update pinned elements error:', error);
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
