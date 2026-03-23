import { db } from '../utils/db';
import { v4 as uuidv4 } from 'uuid';
import { logAudit } from './auditService';

// ===========================================
// Types
// ===========================================

export type FeedbackMessageType = 'praise' | 'coaching' | 'action_required' | 'follow_up' | 'general';
export type MessagePriority = 'urgent' | 'high' | 'normal' | 'low';

export interface FeedbackMessage {
  id: string;
  teacherId: string;
  teacherName?: string;
  senderId: string;
  senderName?: string;
  senderRole?: string;
  observationId?: string;
  elementId?: string;
  elementName?: string;
  suggestionId?: string;
  videoId?: string;
  feedbackType: FeedbackMessageType;
  subject: string;
  message: string;
  attachments: Array<{ type: string; url: string; name: string }>;
  priority: MessagePriority;
  requiresAcknowledgment: boolean;
  acknowledgedAt?: Date;
  readAt?: Date;
  isArchived: boolean;
  parentMessageId?: string;
  threadDepth: number;
  createdAt: Date;
  updatedAt: Date;
  // Thread info
  replyCount?: number;
}

export interface CreateFeedbackMessageInput {
  teacherId: string;
  senderId: string;
  observationId?: string;
  elementId?: string;
  suggestionId?: string;
  videoId?: string;
  feedbackType: FeedbackMessageType;
  subject: string;
  message: string;
  attachments?: Array<{ type: string; url: string; name: string }>;
  priority?: MessagePriority;
  requiresAcknowledgment?: boolean;
  parentMessageId?: string;
}

export interface FeedbackMessageFilters {
  teacherId?: string;
  senderId?: string;
  feedbackType?: FeedbackMessageType;
  priority?: MessagePriority;
  unreadOnly?: boolean;
  requiresAcknowledgment?: boolean;
  unacknowledgedOnly?: boolean;
  isArchived?: boolean;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  pageSize?: number;
}

export interface NotificationPayload {
  type: 'new_feedback' | 'feedback_reply' | 'action_required' | 'acknowledgment_needed';
  teacherId: string;
  messageId: string;
  subject: string;
  senderName: string;
  priority: MessagePriority;
}

// ===========================================
// Teacher Feedback Service
// ===========================================

export const teacherFeedbackService = {
  /**
   * Send feedback message to a teacher
   */
  async sendFeedback(input: CreateFeedbackMessageInput): Promise<FeedbackMessage> {
    const { teacherId, senderId, parentMessageId } = input;

    // Verify teacher exists
    const teacher = await db('teachers').where('id', teacherId).first();
    if (!teacher) {
      throw new Error('Teacher not found');
    }

    // Get sender info
    const sender = await db('users').where('id', senderId).first();
    if (!sender) {
      throw new Error('Sender not found');
    }

    // Calculate thread depth if this is a reply
    let threadDepth = 0;
    if (parentMessageId) {
      const parentMessage = await db('teacher_feedback_messages')
        .where('id', parentMessageId)
        .first();
      if (!parentMessage) {
        throw new Error('Parent message not found');
      }
      threadDepth = (parentMessage.thread_depth || 0) + 1;
    }

    const messageId = uuidv4();

    await db('teacher_feedback_messages').insert({
      id: messageId,
      teacher_id: teacherId,
      sender_id: senderId,
      observation_id: input.observationId || null,
      element_id: input.elementId || null,
      suggestion_id: input.suggestionId || null,
      video_id: input.videoId || null,
      feedback_type: input.feedbackType,
      subject: input.subject,
      message: input.message,
      attachments: JSON.stringify(input.attachments || []),
      priority: input.priority || 'normal',
      requires_acknowledgment: input.requiresAcknowledgment || false,
      is_archived: false,
      parent_message_id: parentMessageId || null,
      thread_depth: threadDepth,
    });

    // Log audit
    await logAudit({
      userId: senderId,
      action: 'send_feedback',
      targetType: 'teacher_feedback_message',
      targetId: messageId,
      details: {
        teacherId,
        feedbackType: input.feedbackType,
        priority: input.priority,
        isReply: !!parentMessageId,
      },
    });

    // Trigger notification (MUST ADD)
    await this.pushNotification({
      type: parentMessageId ? 'feedback_reply' : 'new_feedback',
      teacherId,
      messageId,
      subject: input.subject,
      senderName: sender.name,
      priority: input.priority || 'normal',
    });

    return this.getMessageById(messageId);
  },

  /**
   * Get feedback messages for a teacher
   */
  async getFeedbackForTeacher(filters: FeedbackMessageFilters = {}): Promise<{
    messages: FeedbackMessage[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let query = db('teacher_feedback_messages as m')
      .leftJoin('teachers as t', 'm.teacher_id', 't.id')
      .leftJoin('users as u', 'm.sender_id', 'u.id')
      .leftJoin('rubric_elements as e', 'm.element_id', 'e.id')
      .select(
        'm.*',
        't.name as teacher_name',
        'u.name as sender_name',
        'u.active_role as sender_role',
        'e.name as element_name'
      );

    // Apply filters
    if (filters.teacherId) {
      query = query.where('m.teacher_id', filters.teacherId);
    }
    if (filters.senderId) {
      query = query.where('m.sender_id', filters.senderId);
    }
    if (filters.feedbackType) {
      query = query.where('m.feedback_type', filters.feedbackType);
    }
    if (filters.priority) {
      query = query.where('m.priority', filters.priority);
    }
    if (filters.unreadOnly) {
      query = query.whereNull('m.read_at');
    }
    if (filters.requiresAcknowledgment !== undefined) {
      query = query.where('m.requires_acknowledgment', filters.requiresAcknowledgment);
    }
    if (filters.unacknowledgedOnly) {
      query = query.where('m.requires_acknowledgment', true).whereNull('m.acknowledged_at');
    }
    if (filters.isArchived !== undefined) {
      query = query.where('m.is_archived', filters.isArchived);
    } else {
      // Default to non-archived
      query = query.where('m.is_archived', false);
    }
    if (filters.startDate) {
      query = query.where('m.created_at', '>=', filters.startDate);
    }
    if (filters.endDate) {
      query = query.where('m.created_at', '<=', filters.endDate);
    }

    // Only get top-level messages (not replies)
    query = query.whereNull('m.parent_message_id');

    // Get total count
    const countResult = await query.clone().count('m.id as count').first();
    const total = parseInt(countResult?.count as string) || 0;

    // Get paginated results with priority ordering
    const messages = await query
      .orderByRaw(`CASE m.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END`)
      .orderBy('m.created_at', 'desc')
      .limit(pageSize)
      .offset(offset);

    // Get reply counts for each message
    const messageIds = messages.map((m: any) => m.id);
    const replyCounts = await db('teacher_feedback_messages')
      .whereIn('parent_message_id', messageIds)
      .groupBy('parent_message_id')
      .select('parent_message_id', db.raw('COUNT(*) as reply_count'));

    const replyCountMap: Record<string, number> = {};
    replyCounts.forEach((r: any) => {
      replyCountMap[r.parent_message_id] = parseInt(r.reply_count) || 0;
    });

    return {
      messages: messages.map((row: any) => ({
        ...this.formatMessage(row),
        replyCount: replyCountMap[row.id] || 0,
      })),
      total,
      page,
      pageSize,
    };
  },

  /**
   * Get a single message by ID
   */
  async getMessageById(messageId: string): Promise<FeedbackMessage> {
    const message = await db('teacher_feedback_messages as m')
      .leftJoin('teachers as t', 'm.teacher_id', 't.id')
      .leftJoin('users as u', 'm.sender_id', 'u.id')
      .leftJoin('rubric_elements as e', 'm.element_id', 'e.id')
      .select(
        'm.*',
        't.name as teacher_name',
        'u.name as sender_name',
        'u.active_role as sender_role',
        'e.name as element_name'
      )
      .where('m.id', messageId)
      .first();

    if (!message) {
      throw new Error('Message not found');
    }

    return this.formatMessage(message);
  },

  /**
   * Get thread replies for a message
   */
  async getThreadReplies(parentMessageId: string): Promise<FeedbackMessage[]> {
    const replies = await db('teacher_feedback_messages as m')
      .leftJoin('teachers as t', 'm.teacher_id', 't.id')
      .leftJoin('users as u', 'm.sender_id', 'u.id')
      .leftJoin('rubric_elements as e', 'm.element_id', 'e.id')
      .select(
        'm.*',
        't.name as teacher_name',
        'u.name as sender_name',
        'u.active_role as sender_role',
        'e.name as element_name'
      )
      .where('m.parent_message_id', parentMessageId)
      .orderBy('m.created_at', 'asc');

    return replies.map((row: any) => this.formatMessage(row));
  },

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string): Promise<FeedbackMessage> {
    const message = await db('teacher_feedback_messages').where('id', messageId).first();

    if (!message) {
      throw new Error('Message not found');
    }

    if (!message.read_at) {
      await db('teacher_feedback_messages').where('id', messageId).update({
        read_at: new Date(),
        updated_at: new Date(),
      });
    }

    return this.getMessageById(messageId);
  },

  /**
   * Acknowledge a message
   */
  async acknowledgeMessage(messageId: string, teacherId: string): Promise<FeedbackMessage> {
    const message = await db('teacher_feedback_messages').where('id', messageId).first();

    if (!message) {
      throw new Error('Message not found');
    }

    if (message.teacher_id !== teacherId) {
      throw new Error('Only the recipient teacher can acknowledge this message');
    }

    if (!message.requires_acknowledgment) {
      throw new Error('This message does not require acknowledgment');
    }

    if (message.acknowledged_at) {
      throw new Error('Message already acknowledged');
    }

    await db('teacher_feedback_messages').where('id', messageId).update({
      acknowledged_at: new Date(),
      read_at: message.read_at || new Date(),
      updated_at: new Date(),
    });

    // Log acknowledgment
    await this.logTeacherAcknowledgment(teacherId, 'feedback', messageId, 'acted_on');

    await logAudit({
      userId: teacherId,
      action: 'acknowledge_feedback',
      targetType: 'teacher_feedback_message',
      targetId: messageId,
    });

    return this.getMessageById(messageId);
  },

  /**
   * Archive a message
   */
  async archiveMessage(messageId: string, userId: string): Promise<FeedbackMessage> {
    const message = await db('teacher_feedback_messages').where('id', messageId).first();

    if (!message) {
      throw new Error('Message not found');
    }

    await db('teacher_feedback_messages').where('id', messageId).update({
      is_archived: true,
      updated_at: new Date(),
    });

    await logAudit({
      userId,
      action: 'archive_feedback',
      targetType: 'teacher_feedback_message',
      targetId: messageId,
    });

    return this.getMessageById(messageId);
  },

  /**
   * Get unread message count for a teacher
   */
  async getUnreadCount(teacherId: string): Promise<number> {
    const result = await db('teacher_feedback_messages')
      .where('teacher_id', teacherId)
      .whereNull('read_at')
      .where('is_archived', false)
      .count('id as count')
      .first();

    return parseInt(result?.count as string) || 0;
  },

  /**
   * Get count of messages requiring acknowledgment
   */
  async getPendingAcknowledgmentCount(teacherId: string): Promise<number> {
    const result = await db('teacher_feedback_messages')
      .where('teacher_id', teacherId)
      .where('requires_acknowledgment', true)
      .whereNull('acknowledged_at')
      .where('is_archived', false)
      .count('id as count')
      .first();

    return parseInt(result?.count as string) || 0;
  },

  /**
   * Push notification for new feedback (MUST ADD)
   * In a real implementation, this would integrate with a notification service
   */
  async pushNotification(payload: NotificationPayload): Promise<void> {
    // Get teacher's user account for notification preferences
    const teacher = await db('teachers').where('id', payload.teacherId).first();
    if (!teacher?.user_id) return;

    const userPrefs = await db('user_preferences').where('user_id', teacher.user_id).first();
    const notificationSettings = userPrefs?.notification_settings
      ? (typeof userPrefs.notification_settings === 'string'
        ? JSON.parse(userPrefs.notification_settings)
        : userPrefs.notification_settings)
      : {};

    // Check if notifications are enabled
    if (notificationSettings.feedbackNotifications === false) {
      return;
    }

    // Log notification attempt (in production, this would send email/push/in-app notification)
    console.log(`[NOTIFICATION] ${payload.type} for teacher ${payload.teacherId}: ${payload.subject}`);

    // In a real implementation:
    // - Send email notification if email notifications enabled
    // - Send push notification if mobile app installed
    // - Create in-app notification record
    // - Send real-time WebSocket event
  },

  /**
   * Log teacher acknowledgment for tracking
   */
  async logTeacherAcknowledgment(
    teacherId: string,
    insightType: string,
    insightId: string,
    actionType: string,
    notes?: string
  ): Promise<void> {
    await db('teacher_acknowledgment_logs').insert({
      id: uuidv4(),
      teacher_id: teacherId,
      insight_type: insightType,
      insight_id: insightId,
      action_type: actionType,
      action_notes: notes || null,
      source: 'dashboard',
    });
  },

  /**
   * Get feedback statistics
   */
  async getFeedbackStats(teacherId?: string): Promise<{
    totalMessages: number;
    unreadMessages: number;
    pendingAcknowledgments: number;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
    recentActivity: Array<{ date: string; count: number }>;
  }> {
    let baseQuery = db('teacher_feedback_messages').where('is_archived', false);
    if (teacherId) {
      baseQuery = baseQuery.where('teacher_id', teacherId);
    }

    const totalResult = await baseQuery.clone().count('id as count').first();
    const unreadResult = await baseQuery.clone().whereNull('read_at').count('id as count').first();
    const pendingAckResult = await baseQuery.clone()
      .where('requires_acknowledgment', true)
      .whereNull('acknowledged_at')
      .count('id as count')
      .first();

    const typeCounts = await baseQuery.clone()
      .groupBy('feedback_type')
      .select('feedback_type', db.raw('COUNT(*) as count'));

    const priorityCounts = await baseQuery.clone()
      .groupBy('priority')
      .select('priority', db.raw('COUNT(*) as count'));

    const recentActivity = await baseQuery.clone()
      .where('created_at', '>=', db.raw("NOW() - INTERVAL '30 days'"))
      .groupBy(db.raw('DATE(created_at)'))
      .select(db.raw('DATE(created_at) as date'), db.raw('COUNT(*) as count'))
      .orderBy('date', 'asc');

    const byType: Record<string, number> = {};
    typeCounts.forEach((t: any) => { byType[t.feedback_type] = parseInt(t.count) || 0; });

    const byPriority: Record<string, number> = {};
    priorityCounts.forEach((p: any) => { byPriority[p.priority] = parseInt(p.count) || 0; });

    return {
      totalMessages: parseInt(totalResult?.count as string) || 0,
      unreadMessages: parseInt(unreadResult?.count as string) || 0,
      pendingAcknowledgments: parseInt(pendingAckResult?.count as string) || 0,
      byType,
      byPriority,
      recentActivity: recentActivity.map((r: any) => ({
        date: r.date,
        count: parseInt(r.count) || 0,
      })),
    };
  },

  /**
   * Format database row to FeedbackMessage
   */
  formatMessage(row: any): FeedbackMessage {
    return {
      id: row.id,
      teacherId: row.teacher_id,
      teacherName: row.teacher_name,
      senderId: row.sender_id,
      senderName: row.sender_name,
      senderRole: row.sender_role,
      observationId: row.observation_id,
      elementId: row.element_id,
      elementName: row.element_name,
      suggestionId: row.suggestion_id,
      videoId: row.video_id,
      feedbackType: row.feedback_type,
      subject: row.subject,
      message: row.message,
      attachments: typeof row.attachments === 'string'
        ? JSON.parse(row.attachments)
        : row.attachments || [],
      priority: row.priority,
      requiresAcknowledgment: row.requires_acknowledgment,
      acknowledgedAt: row.acknowledged_at,
      readAt: row.read_at,
      isArchived: row.is_archived,
      parentMessageId: row.parent_message_id,
      threadDepth: row.thread_depth || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },
};

export default teacherFeedbackService;
