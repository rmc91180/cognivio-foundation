import { db } from '../utils/db';
import { v4 as uuidv4 } from 'uuid';
import { logAudit } from './auditService';

// ===========================================
// Types
// ===========================================

export type NoteType = 'general' | 'observation' | 'question' | 'action_item' | 'follow_up';
export type NoteStatus = 'active' | 'resolved' | 'archived';

export interface CreateNoteInput {
  observationId: string;
  userId: string;
  videoId?: string;
  elementId?: string;
  content: string;
  noteType?: NoteType;
  timestampSeconds?: number;
  tags?: string[];
  isPrivate?: boolean;
}

export interface UpdateNoteInput {
  content?: string;
  noteType?: NoteType;
  tags?: string[];
  isPrivate?: boolean;
  isPinned?: boolean;
  status?: NoteStatus;
}

export interface NoteFilters {
  observationId?: string;
  videoId?: string;
  elementId?: string;
  userId?: string;
  noteType?: NoteType;
  status?: NoteStatus;
  isPrivate?: boolean;
  searchTerm?: string;
  page?: number;
  pageSize?: number;
}

export interface ObservationNote {
  id: string;
  observationId: string;
  userId: string;
  videoId?: string;
  elementId?: string;
  content: string;
  noteType: NoteType;
  timestampSeconds?: number;
  tags: string[];
  isPrivate: boolean;
  isPinned: boolean;
  status: NoteStatus;
  resolvedAt?: Date;
  resolvedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  // Joined fields
  userName?: string;
  userEmail?: string;
  elementName?: string;
  resolvedByName?: string;
}

// ===========================================
// Notes Service
// ===========================================

export const notesService = {
  /**
   * Create a new note on an observation
   */
  async createNote(input: CreateNoteInput): Promise<ObservationNote> {
    const noteId = uuidv4();

    await db('observation_notes').insert({
      id: noteId,
      observation_id: input.observationId,
      user_id: input.userId,
      video_id: input.videoId || null,
      element_id: input.elementId || null,
      content: input.content,
      note_type: input.noteType || 'general',
      timestamp_seconds: input.timestampSeconds || null,
      tags: JSON.stringify(input.tags || []),
      is_private: input.isPrivate || false,
      is_pinned: false,
      status: 'active',
    });

    // Log audit
    await logAudit({
      userId: input.userId,
      action: 'create_note',
      targetType: 'observation_note',
      targetId: noteId,
      details: {
        observationId: input.observationId,
        noteType: input.noteType || 'general',
        isPrivate: input.isPrivate || false,
      },
    });

    return this.getNoteById(noteId, input.userId);
  },

  /**
   * Get a note by ID
   */
  async getNoteById(noteId: string, requestingUserId?: string): Promise<ObservationNote> {
    const note = await db('observation_notes as n')
      .leftJoin('users as u', 'n.user_id', 'u.id')
      .leftJoin('users as r', 'n.resolved_by', 'r.id')
      .leftJoin('rubric_elements as e', 'n.element_id', 'e.id')
      .select(
        'n.*',
        'u.name as user_name',
        'u.email as user_email',
        'e.name as element_name',
        'r.name as resolved_by_name'
      )
      .where('n.id', noteId)
      .first();

    if (!note) {
      throw new Error('Note not found');
    }

    // Check private note access
    if (note.is_private && note.user_id !== requestingUserId) {
      throw new Error('Access denied to private note');
    }

    return this.formatNote(note);
  },

  /**
   * Get notes with filters
   */
  async getNotes(filters: NoteFilters, requestingUserId: string): Promise<{
    notes: ObservationNote[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const { page = 1, pageSize = 20 } = filters;

    let query = db('observation_notes as n')
      .leftJoin('users as u', 'n.user_id', 'u.id')
      .leftJoin('users as r', 'n.resolved_by', 'r.id')
      .leftJoin('rubric_elements as e', 'n.element_id', 'e.id');

    // Apply filters
    if (filters.observationId) {
      query = query.where('n.observation_id', filters.observationId);
    }
    if (filters.videoId) {
      query = query.where('n.video_id', filters.videoId);
    }
    if (filters.elementId) {
      query = query.where('n.element_id', filters.elementId);
    }
    if (filters.userId) {
      query = query.where('n.user_id', filters.userId);
    }
    if (filters.noteType) {
      query = query.where('n.note_type', filters.noteType);
    }
    if (filters.status) {
      query = query.where('n.status', filters.status);
    }
    if (filters.searchTerm) {
      query = query.where('n.content', 'ilike', `%${filters.searchTerm}%`);
    }

    // Handle private notes visibility
    query = query.where(function () {
      this.where('n.is_private', false).orWhere('n.user_id', requestingUserId);
    });

    // Count total
    const countResult = await query.clone().count('n.id as count').first();
    const total = parseInt(countResult?.count as string) || 0;

    // Get paginated results
    const notes = await query
      .clone()
      .select(
        'n.*',
        'u.name as user_name',
        'u.email as user_email',
        'e.name as element_name',
        'r.name as resolved_by_name'
      )
      .orderBy('n.is_pinned', 'desc')
      .orderBy('n.created_at', 'desc')
      .offset((page - 1) * pageSize)
      .limit(pageSize);

    return {
      notes: notes.map((n: any) => this.formatNote(n)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  },

  /**
   * Get notes for an observation
   */
  async getNotesForObservation(
    observationId: string,
    requestingUserId: string
  ): Promise<ObservationNote[]> {
    const result = await this.getNotes(
      { observationId, page: 1, pageSize: 1000 },
      requestingUserId
    );
    return result.notes;
  },

  /**
   * Update a note
   */
  async updateNote(
    noteId: string,
    userId: string,
    updates: UpdateNoteInput
  ): Promise<ObservationNote> {
    const note = await db('observation_notes').where('id', noteId).first();

    if (!note) {
      throw new Error('Note not found');
    }

    // Only allow owner to update
    if (note.user_id !== userId) {
      throw new Error('Only the note author can update this note');
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (updates.content !== undefined) updateData.content = updates.content;
    if (updates.noteType !== undefined) updateData.note_type = updates.noteType;
    if (updates.tags !== undefined) updateData.tags = JSON.stringify(updates.tags);
    if (updates.isPrivate !== undefined) updateData.is_private = updates.isPrivate;
    if (updates.isPinned !== undefined) updateData.is_pinned = updates.isPinned;
    if (updates.status !== undefined) updateData.status = updates.status;

    await db('observation_notes').where('id', noteId).update(updateData);

    // Log audit
    await logAudit({
      userId,
      action: 'update_note',
      targetType: 'observation_note',
      targetId: noteId,
      details: { updates: Object.keys(updates) },
    });

    return this.getNoteById(noteId, userId);
  },

  /**
   * Resolve a note (mark as resolved)
   */
  async resolveNote(noteId: string, userId: string): Promise<ObservationNote> {
    const note = await db('observation_notes').where('id', noteId).first();

    if (!note) {
      throw new Error('Note not found');
    }

    await db('observation_notes').where('id', noteId).update({
      status: 'resolved',
      resolved_at: new Date(),
      resolved_by: userId,
      updated_at: new Date(),
    });

    // Log audit
    await logAudit({
      userId,
      action: 'resolve_note',
      targetType: 'observation_note',
      targetId: noteId,
    });

    return this.getNoteById(noteId, userId);
  },

  /**
   * Archive a note
   */
  async archiveNote(noteId: string, userId: string): Promise<void> {
    const note = await db('observation_notes').where('id', noteId).first();

    if (!note) {
      throw new Error('Note not found');
    }

    // Only owner can archive
    if (note.user_id !== userId) {
      throw new Error('Only the note author can archive this note');
    }

    await db('observation_notes').where('id', noteId).update({
      status: 'archived',
      updated_at: new Date(),
    });

    // Log audit
    await logAudit({
      userId,
      action: 'archive_note',
      targetType: 'observation_note',
      targetId: noteId,
    });
  },

  /**
   * Delete a note
   */
  async deleteNote(noteId: string, userId: string): Promise<void> {
    const note = await db('observation_notes').where('id', noteId).first();

    if (!note) {
      throw new Error('Note not found');
    }

    // Only owner can delete
    if (note.user_id !== userId) {
      throw new Error('Only the note author can delete this note');
    }

    await db('observation_notes').where('id', noteId).delete();

    // Log audit
    await logAudit({
      userId,
      action: 'delete_note',
      targetType: 'observation_note',
      targetId: noteId,
    });
  },

  /**
   * Toggle pin status
   */
  async togglePin(noteId: string, userId: string): Promise<ObservationNote> {
    const note = await db('observation_notes').where('id', noteId).first();

    if (!note) {
      throw new Error('Note not found');
    }

    await db('observation_notes').where('id', noteId).update({
      is_pinned: !note.is_pinned,
      updated_at: new Date(),
    });

    return this.getNoteById(noteId, userId);
  },

  /**
   * Get note counts by type for an observation
   */
  async getNoteCountsByType(observationId: string): Promise<Record<NoteType, number>> {
    const counts = await db('observation_notes')
      .where('observation_id', observationId)
      .where('status', '!=', 'archived')
      .groupBy('note_type')
      .select('note_type')
      .count('id as count');

    const result: Record<NoteType, number> = {
      general: 0,
      observation: 0,
      question: 0,
      action_item: 0,
      follow_up: 0,
    };

    counts.forEach((c: any) => {
      result[c.note_type as NoteType] = parseInt(c.count) || 0;
    });

    return result;
  },

  /**
   * Format database row to ObservationNote
   */
  formatNote(row: any): ObservationNote {
    return {
      id: row.id,
      observationId: row.observation_id,
      userId: row.user_id,
      videoId: row.video_id,
      elementId: row.element_id,
      content: row.content,
      noteType: row.note_type,
      timestampSeconds: row.timestamp_seconds,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags || [],
      isPrivate: row.is_private,
      isPinned: row.is_pinned,
      status: row.status,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      userName: row.user_name,
      userEmail: row.user_email,
      elementName: row.element_name,
      resolvedByName: row.resolved_by_name,
    };
  },
};

export default notesService;
