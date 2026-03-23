import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { notesService, NoteType, NoteStatus } from '../services/notesService';

const router = Router();

/**
 * POST /api/notes
 * Create a new note on an observation
 */
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      observationId,
      videoId,
      elementId,
      content,
      noteType,
      timestampSeconds,
      tags,
      isPrivate,
    } = req.body;

    if (!observationId || !content) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'observationId and content are required',
        },
      });
    }

    const note = await notesService.createNote({
      observationId,
      userId: req.user!.userId,
      videoId,
      elementId,
      content,
      noteType: noteType as NoteType,
      timestampSeconds,
      tags,
      isPrivate,
    });

    return res.status(201).json({
      success: true,
      data: note,
    });
  } catch (error: any) {
    console.error('Create note error:', error);
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
 * GET /api/notes
 * Get notes with filters
 */
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      observationId,
      videoId,
      elementId,
      userId,
      noteType,
      status,
      searchTerm,
      page = '1',
      pageSize = '20',
    } = req.query;

    const result = await notesService.getNotes(
      {
        observationId: observationId as string,
        videoId: videoId as string,
        elementId: elementId as string,
        userId: userId as string,
        noteType: noteType as NoteType,
        status: status as NoteStatus,
        searchTerm: searchTerm as string,
        page: parseInt(page as string),
        pageSize: parseInt(pageSize as string),
      },
      req.user!.userId
    );

    return res.json({
      success: true,
      data: result.notes,
      meta: {
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
        totalItems: result.total,
      },
    });
  } catch (error: any) {
    console.error('Get notes error:', error);
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
 * GET /api/notes/observation/:observationId
 * Get all notes for a specific observation
 */
router.get('/observation/:observationId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { observationId } = req.params;

    const notes = await notesService.getNotesForObservation(observationId, req.user!.userId);

    return res.json({
      success: true,
      data: notes,
    });
  } catch (error: any) {
    console.error('Get observation notes error:', error);
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
 * GET /api/notes/observation/:observationId/counts
 * Get note counts by type for an observation
 */
router.get('/observation/:observationId/counts', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { observationId } = req.params;

    const counts = await notesService.getNoteCountsByType(observationId);

    return res.json({
      success: true,
      data: counts,
    });
  } catch (error: any) {
    console.error('Get note counts error:', error);
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
 * GET /api/notes/:noteId
 * Get a specific note by ID
 */
router.get('/:noteId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { noteId } = req.params;

    const note = await notesService.getNoteById(noteId, req.user!.userId);

    return res.json({
      success: true,
      data: note,
    });
  } catch (error: any) {
    console.error('Get note error:', error);

    if (error.message === 'Note not found') {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Note not found',
        },
      });
    }

    if (error.message === 'Access denied to private note') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied to private note',
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
 * PATCH /api/notes/:noteId
 * Update a note
 */
router.patch('/:noteId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { noteId } = req.params;
    const { content, noteType, tags, isPrivate, isPinned, status } = req.body;

    const note = await notesService.updateNote(noteId, req.user!.userId, {
      content,
      noteType: noteType as NoteType,
      tags,
      isPrivate,
      isPinned,
      status: status as NoteStatus,
    });

    return res.json({
      success: true,
      data: note,
    });
  } catch (error: any) {
    console.error('Update note error:', error);

    if (error.message === 'Note not found') {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Note not found',
        },
      });
    }

    if (error.message.includes('Only the note author')) {
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
 * POST /api/notes/:noteId/resolve
 * Mark a note as resolved
 */
router.post('/:noteId/resolve', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { noteId } = req.params;

    const note = await notesService.resolveNote(noteId, req.user!.userId);

    return res.json({
      success: true,
      data: note,
    });
  } catch (error: any) {
    console.error('Resolve note error:', error);

    if (error.message === 'Note not found') {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Note not found',
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
 * POST /api/notes/:noteId/pin
 * Toggle pin status of a note
 */
router.post('/:noteId/pin', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { noteId } = req.params;

    const note = await notesService.togglePin(noteId, req.user!.userId);

    return res.json({
      success: true,
      data: note,
    });
  } catch (error: any) {
    console.error('Toggle pin error:', error);

    if (error.message === 'Note not found') {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Note not found',
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
 * POST /api/notes/:noteId/archive
 * Archive a note
 */
router.post('/:noteId/archive', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { noteId } = req.params;

    await notesService.archiveNote(noteId, req.user!.userId);

    return res.json({
      success: true,
      data: {
        message: 'Note archived successfully',
      },
    });
  } catch (error: any) {
    console.error('Archive note error:', error);

    if (error.message === 'Note not found') {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Note not found',
        },
      });
    }

    if (error.message.includes('Only the note author')) {
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
 * DELETE /api/notes/:noteId
 * Delete a note
 */
router.delete('/:noteId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { noteId } = req.params;

    await notesService.deleteNote(noteId, req.user!.userId);

    return res.json({
      success: true,
      data: {
        message: 'Note deleted successfully',
      },
    });
  } catch (error: any) {
    console.error('Delete note error:', error);

    if (error.message === 'Note not found') {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Note not found',
        },
      });
    }

    if (error.message.includes('Only the note author')) {
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

export default router;
