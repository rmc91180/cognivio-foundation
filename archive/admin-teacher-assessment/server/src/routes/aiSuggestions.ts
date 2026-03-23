import { Router, Request, Response } from 'express';
import { authenticateToken, requireRoles } from '../middleware/auth';
import { aiSuggestionsService } from '../services/aiSuggestionsService';
import { aiLearningService } from '../services/aiLearningService';

const router = Router();

// ===========================================
// AI Suggestions Routes
// ===========================================

/**
 * GET /api/ai/suggestions
 * Get suggestions for the current principal
 */
router.get('/', authenticateToken, requireRoles('admin', 'principal', 'department_head'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const {
      status,
      priority,
      suggestionType,
      teacherId,
      patternDetected,
      page,
      pageSize,
    } = req.query;

    const result = await aiSuggestionsService.getSuggestionsForPrincipal({
      principalId: userId,
      status: status as any,
      priority: priority as any,
      suggestionType: suggestionType as any,
      teacherId: teacherId as string,
      patternDetected: patternDetected as any,
      page: page ? parseInt(page as string) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string) : undefined,
    });

    return res.json({
      success: true,
      data: result.suggestions,
      meta: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    });
  } catch (error: any) {
    console.error('Error getting suggestions:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/ai/suggestions/stats
 * Get suggestion statistics
 */
router.get('/stats', authenticateToken, requireRoles('admin', 'principal', 'department_head'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const stats = await aiSuggestionsService.getSuggestionStats(userId);

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error('Error getting suggestion stats:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/ai/suggestions/:id
 * Get a single suggestion by ID
 */
router.get('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const suggestion = await aiSuggestionsService.getSuggestionById(id);

    return res.json({
      success: true,
      data: suggestion,
    });
  } catch (error: any) {
    console.error('Error getting suggestion:', error);
    if (error.message === 'Suggestion not found') {
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
 * POST /api/ai/suggestions/generate/:teacherId
 * Generate suggestions for a teacher
 */
router.post('/generate/:teacherId', authenticateToken, requireRoles('admin', 'principal', 'department_head'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { teacherId } = req.params;
    const { templateId } = req.body;

    const suggestions = await aiSuggestionsService.generateSuggestions({
      teacherId,
      principalId: userId,
      templateId,
    });

    return res.status(201).json({
      success: true,
      data: suggestions,
      meta: { count: suggestions.length },
    });
  } catch (error: any) {
    console.error('Error generating suggestions:', error);
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
 * POST /api/ai/suggestions/:id/accept
 * Accept a suggestion
 */
router.post('/:id/accept', authenticateToken, requireRoles('admin', 'principal', 'department_head'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const suggestion = await aiSuggestionsService.acceptSuggestion(id, userId);

    return res.json({
      success: true,
      data: suggestion,
    });
  } catch (error: any) {
    console.error('Error accepting suggestion:', error);
    if (error.message === 'Suggestion not found') {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    if (error.message.includes('only accept')) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATE', message: error.message },
      });
    }
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * POST /api/ai/suggestions/:id/reject
 * Reject a suggestion
 */
router.post('/:id/reject', authenticateToken, requireRoles('admin', 'principal', 'department_head'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Rejection reason is required' },
      });
    }

    const suggestion = await aiSuggestionsService.rejectSuggestion(id, userId, reason);

    return res.json({
      success: true,
      data: suggestion,
    });
  } catch (error: any) {
    console.error('Error rejecting suggestion:', error);
    if (error.message === 'Suggestion not found') {
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
 * POST /api/ai/suggestions/:id/complete
 * Mark suggestion as completed with notes and rating
 */
router.post('/:id/complete', authenticateToken, requireRoles('admin', 'principal', 'department_head'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { notes, helpfulnessRating } = req.body;

    if (!helpfulnessRating || helpfulnessRating < 1 || helpfulnessRating > 5) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Helpfulness rating (1-5) is required' },
      });
    }

    const suggestion = await aiSuggestionsService.completeSuggestion(id, userId, notes || '', helpfulnessRating);

    return res.json({
      success: true,
      data: suggestion,
    });
  } catch (error: any) {
    console.error('Error completing suggestion:', error);
    if (error.message === 'Suggestion not found') {
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

// ===========================================
// AI Learning Routes (extend existing /api/ai)
// ===========================================

/**
 * GET /api/ai/suggestions/history/:teacherId
 * Get AI learning history for a teacher
 */
router.get('/history/:teacherId', authenticateToken, requireRoles('admin', 'principal', 'department_head'), async (req: Request, res: Response) => {
  try {
    const { teacherId } = req.params;
    const { elementId, startDate, endDate, correctionType, page, pageSize } = req.query;

    const result = await aiLearningService.getLearningHistory({
      teacherId,
      elementId: elementId as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      correctionType: correctionType as string,
      page: page ? parseInt(page as string) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string) : undefined,
    });

    return res.json({
      success: true,
      data: result.entries,
      meta: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    });
  } catch (error: any) {
    console.error('Error getting learning history:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/ai/suggestions/model/version
 * Get current active AI model version
 */
router.get('/model/version', authenticateToken, async (req: Request, res: Response) => {
  try {
    const modelVersion = await aiLearningService.getActiveModelVersion();

    return res.json({
      success: true,
      data: modelVersion,
    });
  } catch (error: any) {
    console.error('Error getting model version:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * POST /api/ai/suggestions/model/version
 * Create a new AI model version (admin only)
 */
router.post('/model/version', authenticateToken, requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { version, type, name, description, config } = req.body;

    if (!version || !type || !name) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'version, type, and name are required' },
      });
    }

    await aiLearningService.createModelVersion({
      version,
      type,
      name,
      description,
      config,
      createdBy: userId,
    });

    return res.status(201).json({
      success: true,
      data: { version, type, name },
    });
  } catch (error: any) {
    console.error('Error creating model version:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * POST /api/ai/suggestions/model/activate
 * Activate a model version (admin only)
 */
router.post('/model/activate', authenticateToken, requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { version } = req.body;

    if (!version) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'version is required' },
      });
    }

    await aiLearningService.activateModelVersion(version, userId);

    return res.json({
      success: true,
      data: { activatedVersion: version },
    });
  } catch (error: any) {
    console.error('Error activating model version:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/ai/suggestions/patterns
 * Get AI correction pattern analysis (admin only)
 */
router.get('/patterns', authenticateToken, requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { frameworkType, domainName, elementId, modelVersion, minSamples } = req.query;

    const patterns = await aiLearningService.getPatternAnalysis({
      frameworkType: frameworkType as string,
      domainName: domainName as string,
      elementId: elementId as string,
      modelVersion: modelVersion as string,
      minSamples: minSamples ? parseInt(minSamples as string) : undefined,
    });

    return res.json({
      success: true,
      data: patterns,
    });
  } catch (error: any) {
    console.error('Error getting patterns:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/ai/suggestions/learning/export
 * Export training data for model fine-tuning (admin only)
 */
router.get('/learning/export', authenticateToken, requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { modelVersion, startDate, endDate, minExpertiseWeight } = req.query;

    const trainingData = await aiLearningService.exportTrainingData({
      modelVersion: modelVersion as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      minExpertiseWeight: minExpertiseWeight ? parseFloat(minExpertiseWeight as string) : undefined,
    });

    return res.json({
      success: true,
      data: trainingData,
      meta: { count: trainingData.length },
    });
  } catch (error: any) {
    console.error('Error exporting training data:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

export default router;
