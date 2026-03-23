import { Router, Request, Response } from 'express';
import { db } from '../utils/db';
import { authenticateToken, requireRoles } from '../middleware/auth';
import {
  feedbackService,
  AgreementLevel,
  UserConfidence,
  DisagreementType,
  FeedbackCategory,
} from '../services/feedbackService';

const router = Router();

async function observationInSchoolScope(observationId: string, schoolId: string): Promise<boolean> {
  const row = await db('ai_observations as o')
    .join('video_evidence as v', 'o.video_id', 'v.id')
    .join('teachers as t', 'v.teacher_id', 't.id')
    .where('o.id', observationId)
    .where('t.school_id', schoolId)
    .select('o.id')
    .first();
  return Boolean(row);
}

async function feedbackInSchoolScope(feedbackId: string, schoolId: string): Promise<boolean> {
  const row = await db('ai_feedback as f')
    .join('ai_observations as o', 'f.observation_id', 'o.id')
    .join('video_evidence as v', 'o.video_id', 'v.id')
    .join('teachers as t', 'v.teacher_id', 't.id')
    .where('f.id', feedbackId)
    .where('t.school_id', schoolId)
    .select('f.id')
    .first();
  return Boolean(row);
}

async function correctionInSchoolScope(correctionId: string, schoolId: string): Promise<boolean> {
  const row = await db('feedback_corrections as c')
    .join('ai_feedback as f', 'c.feedback_id', 'f.id')
    .join('ai_observations as o', 'f.observation_id', 'o.id')
    .join('video_evidence as v', 'o.video_id', 'v.id')
    .join('teachers as t', 'v.teacher_id', 't.id')
    .where('c.id', correctionId)
    .where('t.school_id', schoolId)
    .select('c.id')
    .first();
  return Boolean(row);
}

/**
 * POST /api/feedback
 * Submit feedback on an AI observation
 */
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      observationId,
      videoId,
      accuracyRating,
      helpfulnessRating,
      detailRating,
      overallAgreement,
      feedbackText,
      whatWasMissed,
      whatWasIncorrect,
      suggestions,
      feedbackCategories,
    } = req.body;
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

    if (!observationId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'observationId is required',
        },
      });
    }
    if (!(await observationInSchoolScope(observationId, schoolId))) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Observation not found',
        },
      });
    }

    // Validate ratings if provided
    if (accuracyRating !== undefined && (accuracyRating < 1 || accuracyRating > 5)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'accuracyRating must be between 1 and 5',
        },
      });
    }

    const feedback = await feedbackService.submitFeedback({
      observationId,
      userId: req.user!.userId,
      videoId,
      accuracyRating,
      helpfulnessRating,
      detailRating,
      overallAgreement: overallAgreement as AgreementLevel,
      feedbackText,
      whatWasMissed,
      whatWasIncorrect,
      suggestions,
      feedbackCategories: feedbackCategories as FeedbackCategory[],
    });

    return res.status(201).json({
      success: true,
      data: feedback,
    });
  } catch (error: any) {
    console.error('Submit feedback error:', error);

    if (error.message.includes('already submitted')) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'CONFLICT',
          message: error.message,
        },
      });
    }

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'An error occurred',
      },
    });
  }
});

/**
 * GET /api/feedback/:feedbackId
 * Get feedback by ID with corrections
 */
router.get('/:feedbackId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { feedbackId } = req.params;
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
    if (!(await feedbackInSchoolScope(feedbackId, schoolId))) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Feedback not found',
        },
      });
    }

    const feedback = await feedbackService.getFeedbackById(feedbackId);

    return res.json({
      success: true,
      data: feedback,
    });
  } catch (error: any) {
    console.error('Get feedback error:', error);

    if (error.message === 'Feedback not found') {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Feedback not found',
        },
      });
    }

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'An error occurred',
      },
    });
  }
});

/**
 * PATCH /api/feedback/:feedbackId
 * Update existing feedback
 */
router.patch('/:feedbackId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { feedbackId } = req.params;
    const updates = req.body;
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
    if (!(await feedbackInSchoolScope(feedbackId, schoolId))) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Feedback not found',
        },
      });
    }

    const feedback = await feedbackService.updateFeedback(feedbackId, req.user!.userId, updates);

    return res.json({
      success: true,
      data: feedback,
    });
  } catch (error: any) {
    console.error('Update feedback error:', error);

    if (error.message === 'Feedback not found') {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Feedback not found',
        },
      });
    }

    if (error.message.includes('approved for training')) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: error.message,
        },
      });
    }

    if (error.message.includes('Only the feedback author')) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: error.message,
        },
      });
    }

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'An error occurred',
      },
    });
  }
});

/**
 * GET /api/feedback/observation/:observationId
 * Get all feedback for an observation
 */
router.get('/observation/:observationId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { observationId } = req.params;
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
    if (!(await observationInSchoolScope(observationId, schoolId))) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Observation not found',
        },
      });
    }

    const feedbacks = await feedbackService.getFeedbackForObservation(observationId);

    return res.json({
      success: true,
      data: feedbacks,
    });
  } catch (error: any) {
    console.error('Get observation feedback error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'An error occurred',
      },
    });
  }
});

/**
 * POST /api/feedback/:feedbackId/corrections
 * Add a score correction to feedback
 */
router.post('/:feedbackId/corrections', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { feedbackId } = req.params;
    const {
      elementId,
      aiScore,
      correctedScore,
      aiConfidence,
      userConfidence,
      correctionReason,
      evidenceDescription,
      timestampReferences,
      disagreementType,
    } = req.body;
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
    if (!(await feedbackInSchoolScope(feedbackId, schoolId))) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Feedback not found',
        },
      });
    }

    if (!elementId || aiScore === undefined || correctedScore === undefined) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'elementId, aiScore, and correctedScore are required',
        },
      });
    }

    // Validate scores
    if (aiScore < 1 || aiScore > 4 || correctedScore < 1 || correctedScore > 4) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Scores must be between 1 and 4',
        },
      });
    }

    const correction = await feedbackService.addCorrection({
      feedbackId,
      elementId,
      userId: req.user!.userId,
      aiScore,
      correctedScore,
      aiConfidence,
      userConfidence: userConfidence as UserConfidence,
      correctionReason,
      evidenceDescription,
      timestampReferences,
      disagreementType: disagreementType as DisagreementType,
    });

    return res.status(201).json({
      success: true,
      data: correction,
    });
  } catch (error: any) {
    console.error('Add correction error:', error);

    if (error.message === 'Feedback not found') {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Feedback not found',
        },
      });
    }

    if (error.message.includes('Correction already exists')) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'CONFLICT',
          message: error.message,
        },
      });
    }

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'An error occurred',
      },
    });
  }
});

/**
 * POST /api/feedback/:feedbackId/approve
 * Approve feedback for AI training (admin only)
 */
router.post('/:feedbackId/approve', authenticateToken, requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { feedbackId } = req.params;
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
    if (!(await feedbackInSchoolScope(feedbackId, schoolId))) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Feedback not found',
        },
      });
    }

    const feedback = await feedbackService.approveFeedbackForTraining(feedbackId, req.user!.userId);

    return res.json({
      success: true,
      data: feedback,
    });
  } catch (error: any) {
    console.error('Approve feedback error:', error);

    if (error.message === 'Feedback not found') {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Feedback not found',
        },
      });
    }

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'An error occurred',
      },
    });
  }
});

/**
 * POST /api/feedback/corrections/:correctionId/validate
 * Validate a correction (admin only)
 */
router.post('/corrections/:correctionId/validate', authenticateToken, requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { correctionId } = req.params;
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
    if (!(await correctionInSchoolScope(correctionId, schoolId))) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Correction not found',
        },
      });
    }

    const correction = await feedbackService.validateCorrection(correctionId, req.user!.userId);

    return res.json({
      success: true,
      data: correction,
    });
  } catch (error: any) {
    console.error('Validate correction error:', error);

    if (error.message === 'Correction not found') {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Correction not found',
        },
      });
    }

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'An error occurred',
      },
    });
  }
});

/**
 * GET /api/feedback/analytics
 * Get feedback analytics for AI training insights (admin only)
 */
router.get('/analytics', authenticateToken, requireRoles('admin', 'principal'), async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, minCorrections } = req.query;

    const analytics = await feedbackService.getFeedbackAnalytics({
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      minCorrections: minCorrections ? parseInt(minCorrections as string) : undefined,
    });

    return res.json({
      success: true,
      data: analytics,
    });
  } catch (error: any) {
    console.error('Get analytics error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'An error occurred',
      },
    });
  }
});

/**
 * POST /api/feedback/training/export
 * Create a training data export (admin only)
 */
router.post('/training/export', authenticateToken, requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const {
      exportName,
      description,
      exportFormat,
      dataFrom,
      dataTo,
      minAccuracyRating,
      validatedOnly,
    } = req.body;

    if (!exportName) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'exportName is required',
        },
      });
    }

    const exportRecord = await feedbackService.createTrainingExport({
      exportName,
      description,
      exportFormat,
      dataFrom: dataFrom ? new Date(dataFrom) : undefined,
      dataTo: dataTo ? new Date(dataTo) : undefined,
      minAccuracyRating,
      validatedOnly,
      requestedBy: req.user!.userId,
    });

    return res.status(201).json({
      success: true,
      data: exportRecord,
    });
  } catch (error: any) {
    console.error('Create export error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'An error occurred',
      },
    });
  }
});

/**
 * GET /api/feedback/training/export/:exportId
 * Get training export status
 */
router.get('/training/export/:exportId', authenticateToken, requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { exportId } = req.params;

    const exportRecord = await feedbackService.getExportById(exportId);

    return res.json({
      success: true,
      data: exportRecord,
    });
  } catch (error: any) {
    console.error('Get export error:', error);

    if (error.message === 'Export not found') {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Export not found',
        },
      });
    }

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'An error occurred',
      },
    });
  }
});

/**
 * GET /api/feedback/training/data
 * Get training data for export (admin only)
 */
router.get('/training/data', authenticateToken, requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { dataFrom, dataTo, minAccuracyRating, validatedOnly } = req.query;

    const data = await feedbackService.getTrainingData({
      dataFrom: dataFrom ? new Date(dataFrom as string) : undefined,
      dataTo: dataTo ? new Date(dataTo as string) : undefined,
      minAccuracyRating: minAccuracyRating ? parseInt(minAccuracyRating as string) : undefined,
      validatedOnly: validatedOnly === 'true',
    });

    return res.json({
      success: true,
      data,
      meta: {
        totalEntries: data.length,
        totalCorrections: data.reduce((sum, d) => sum + d.corrections.length, 0),
      },
    });
  } catch (error: any) {
    console.error('Get training data error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'An error occurred',
      },
    });
  }
});

export default router;
