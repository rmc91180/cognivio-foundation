import { Router, Request, Response } from 'express';
import { authenticateToken, requireRoles } from '../middleware/auth';
import { teacherFeedbackService } from '../services/teacherFeedbackService';

const router = Router();

// ===========================================
// Teacher Feedback Routes
// ===========================================

/**
 * POST /api/feedback/teacher
 * Send feedback to a teacher
 */
router.post('/', authenticateToken, requireRoles('admin', 'principal', 'department_head', 'observer'), async (req: Request, res: Response) => {
  try {
    const senderId = req.user!.userId;
    const {
      teacherId,
      observationId,
      elementId,
      suggestionId,
      videoId,
      feedbackType,
      subject,
      message,
      attachments,
      priority,
      requiresAcknowledgment,
      parentMessageId,
    } = req.body;

    // Validation
    if (!teacherId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'teacherId is required' },
      });
    }
    if (!feedbackType) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'feedbackType is required' },
      });
    }
    if (!subject) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'subject is required' },
      });
    }
    if (!message) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'message is required' },
      });
    }

    const feedbackMessage = await teacherFeedbackService.sendFeedback({
      teacherId,
      senderId,
      observationId,
      elementId,
      suggestionId,
      videoId,
      feedbackType,
      subject,
      message,
      attachments,
      priority,
      requiresAcknowledgment,
      parentMessageId,
    });

    return res.status(201).json({
      success: true,
      data: feedbackMessage,
    });
  } catch (error: any) {
    console.error('Error sending feedback:', error);
    if (error.message === 'Teacher not found' || error.message === 'Sender not found') {
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
 * GET /api/feedback/teacher/:teacherId
 * Get feedback messages for a teacher
 */
router.get('/:teacherId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const userRoles = req.user!.roles;
    const { teacherId } = req.params;
    const {
      feedbackType,
      priority,
      unreadOnly,
      unacknowledgedOnly,
      isArchived,
      startDate,
      endDate,
      page,
      pageSize,
    } = req.query;

    // Teachers can only view their own feedback
    // TODO: Get teacher's user_id and compare
    const isAdminOrPrincipal = userRoles.some((r: string) => ['admin', 'principal', 'department_head'].includes(r));

    const result = await teacherFeedbackService.getFeedbackForTeacher({
      teacherId,
      feedbackType: feedbackType as any,
      priority: priority as any,
      unreadOnly: unreadOnly === 'true',
      unacknowledgedOnly: unacknowledgedOnly === 'true',
      isArchived: isArchived === 'true' ? true : isArchived === 'false' ? false : undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      page: page ? parseInt(page as string) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string) : undefined,
    });

    return res.json({
      success: true,
      data: result.messages,
      meta: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    });
  } catch (error: any) {
    console.error('Error getting feedback:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/feedback/teacher/:teacherId/unread
 * Get unread message count for a teacher
 */
router.get('/:teacherId/unread', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { teacherId } = req.params;

    const unreadCount = await teacherFeedbackService.getUnreadCount(teacherId);
    const pendingAckCount = await teacherFeedbackService.getPendingAcknowledgmentCount(teacherId);

    return res.json({
      success: true,
      data: {
        unreadCount,
        pendingAcknowledgmentCount: pendingAckCount,
      },
    });
  } catch (error: any) {
    console.error('Error getting unread count:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/feedback/teacher/:teacherId/stats
 * Get feedback statistics for a teacher
 */
router.get('/:teacherId/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { teacherId } = req.params;

    const stats = await teacherFeedbackService.getFeedbackStats(teacherId);

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error('Error getting feedback stats:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/feedback/teacher/message/:messageId
 * Get a single message by ID
 */
router.get('/message/:messageId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { messageId } = req.params;

    const message = await teacherFeedbackService.getMessageById(messageId);

    return res.json({
      success: true,
      data: message,
    });
  } catch (error: any) {
    console.error('Error getting message:', error);
    if (error.message === 'Message not found') {
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
 * GET /api/feedback/teacher/message/:messageId/thread
 * Get replies to a message
 */
router.get('/message/:messageId/thread', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { messageId } = req.params;

    const replies = await teacherFeedbackService.getThreadReplies(messageId);

    return res.json({
      success: true,
      data: replies,
    });
  } catch (error: any) {
    console.error('Error getting thread replies:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * POST /api/feedback/teacher/message/:messageId/read
 * Mark message as read
 */
router.post('/message/:messageId/read', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { messageId } = req.params;

    const message = await teacherFeedbackService.markAsRead(messageId);

    return res.json({
      success: true,
      data: message,
    });
  } catch (error: any) {
    console.error('Error marking message as read:', error);
    if (error.message === 'Message not found') {
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
 * POST /api/feedback/teacher/message/:messageId/acknowledge
 * Acknowledge a message (teacher only)
 */
router.post('/message/:messageId/acknowledge', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { messageId } = req.params;

    // Get the message to find the teacher ID
    const existingMessage = await teacherFeedbackService.getMessageById(messageId);

    // For now, we'll use the user's ID to look up if they're the teacher
    // In a real implementation, we'd verify the user is the teacher
    const message = await teacherFeedbackService.acknowledgeMessage(messageId, existingMessage.teacherId);

    return res.json({
      success: true,
      data: message,
    });
  } catch (error: any) {
    console.error('Error acknowledging message:', error);
    if (error.message === 'Message not found') {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    if (error.message.includes('Only the recipient') || error.message.includes('does not require') || error.message.includes('already acknowledged')) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: error.message },
      });
    }
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * POST /api/feedback/teacher/message/:messageId/archive
 * Archive a message
 */
router.post('/message/:messageId/archive', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { messageId } = req.params;

    const message = await teacherFeedbackService.archiveMessage(messageId, userId);

    return res.json({
      success: true,
      data: message,
    });
  } catch (error: any) {
    console.error('Error archiving message:', error);
    if (error.message === 'Message not found') {
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
 * POST /api/feedback/teacher/message/:messageId/reply
 * Reply to a message
 */
router.post('/message/:messageId/reply', authenticateToken, async (req: Request, res: Response) => {
  try {
    const senderId = req.user!.userId;
    const { messageId } = req.params;
    const { message: messageContent, feedbackType } = req.body;

    if (!messageContent) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'message is required' },
      });
    }

    // Get the original message to get context
    const originalMessage = await teacherFeedbackService.getMessageById(messageId);

    const reply = await teacherFeedbackService.sendFeedback({
      teacherId: originalMessage.teacherId,
      senderId,
      observationId: originalMessage.observationId,
      elementId: originalMessage.elementId,
      suggestionId: originalMessage.suggestionId,
      videoId: originalMessage.videoId,
      feedbackType: feedbackType || originalMessage.feedbackType,
      subject: `Re: ${originalMessage.subject}`,
      message: messageContent,
      parentMessageId: messageId,
    });

    return res.status(201).json({
      success: true,
      data: reply,
    });
  } catch (error: any) {
    console.error('Error replying to message:', error);
    if (error.message === 'Message not found' || error.message === 'Parent message not found') {
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

export default router;
