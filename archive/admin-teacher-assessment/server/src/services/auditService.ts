import { db } from '../utils/db';
import { v4 as uuidv4 } from 'uuid';

export interface AuditLogEntry {
  userId?: string;
  userName?: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Log an audit entry
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    await db('audit_log').insert({
      id: uuidv4(),
      user_id: entry.userId,
      user_name: entry.userName,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId,
      details: JSON.stringify(entry.details || {}),
      ip_address: entry.ipAddress,
      user_agent: entry.userAgent,
    });
  } catch (error) {
    console.error('Failed to log audit entry:', error);
    // Don't throw - audit logging should not break the main flow
  }
}

/**
 * Get audit log entries
 */
export async function getAuditLog(params: {
  targetType?: string;
  targetId?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  pageSize?: number;
}): Promise<{ entries: unknown[]; total: number }> {
  const { page = 1, pageSize = 50 } = params;

  let query = db('audit_log').orderBy('created_at', 'desc');

  if (params.targetType) {
    query = query.where('target_type', params.targetType);
  }
  if (params.targetId) {
    query = query.where('target_id', params.targetId);
  }
  if (params.action) {
    query = query.where('action', params.action);
  }
  if (params.startDate) {
    query = query.where('created_at', '>=', params.startDate);
  }
  if (params.endDate) {
    query = query.where('created_at', '<=', params.endDate);
  }

  const countResult = await query.clone().count('id as count').first();
  const total = parseInt(countResult?.count as string) || 0;

  const entries = await query
    .offset((page - 1) * pageSize)
    .limit(pageSize);

  return { entries, total };
}
