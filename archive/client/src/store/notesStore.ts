import { create } from 'zustand';
import { notesApi } from '@/services/api';
import type { ObservationNote, CreateNoteInput, NoteCounts, NoteType } from '@/types';

interface NotesState {
  // Notes list
  notes: ObservationNote[];
  noteCounts: NoteCounts;
  isLoading: boolean;
  error: string | null;

  // Pagination
  page: number;
  pageSize: number;
  totalPages: number;
  total: number;

  // Filters
  filterType: NoteType | null;
  searchTerm: string;

  // Actions
  fetchNotes: (params: { observationId?: string; videoId?: string }) => Promise<void>;
  fetchNoteCounts: (observationId: string) => Promise<void>;
  createNote: (input: CreateNoteInput) => Promise<ObservationNote>;
  updateNote: (noteId: string, updates: Partial<CreateNoteInput>) => Promise<void>;
  deleteNote: (noteId: string) => Promise<void>;
  resolveNote: (noteId: string) => Promise<void>;
  togglePin: (noteId: string) => Promise<void>;
  setFilterType: (type: NoteType | null) => void;
  setSearchTerm: (term: string) => void;
  setPage: (page: number) => void;
  clearNotes: () => void;
  clearError: () => void;
}

const initialCounts: NoteCounts = {
  general: 0,
  observation: 0,
  question: 0,
  action_item: 0,
  follow_up: 0,
};

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  noteCounts: initialCounts,
  isLoading: false,
  error: null,
  page: 1,
  pageSize: 20,
  totalPages: 1,
  total: 0,
  filterType: null,
  searchTerm: '',

  fetchNotes: async (params) => {
    const { page, pageSize, filterType, searchTerm } = get();
    set({ isLoading: true, error: null });

    try {
      const result = await notesApi.getAll({
        ...params,
        noteType: filterType || undefined,
        searchTerm: searchTerm || undefined,
        page,
        pageSize,
      });

      set({
        notes: result.notes,
        total: result.total,
        totalPages: result.totalPages,
        isLoading: false,
      });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch notes', isLoading: false });
    }
  },

  fetchNoteCounts: async (observationId: string) => {
    try {
      const counts = await notesApi.getCounts(observationId);
      set({ noteCounts: counts });
    } catch (err: any) {
      console.error('Failed to fetch note counts:', err);
    }
  },

  createNote: async (input: CreateNoteInput) => {
    set({ error: null });
    try {
      const note = await notesApi.create(input);
      set((state) => ({
        notes: [note, ...state.notes],
        total: state.total + 1,
      }));
      // Refresh counts
      if (input.observationId) {
        get().fetchNoteCounts(input.observationId);
      }
      return note;
    } catch (err: any) {
      set({ error: err.message || 'Failed to create note' });
      throw err;
    }
  },

  updateNote: async (noteId: string, updates: Partial<CreateNoteInput>) => {
    set({ error: null });
    try {
      const updatedNote = await notesApi.update(noteId, updates);
      set((state) => ({
        notes: state.notes.map((n) => (n.id === noteId ? updatedNote : n)),
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to update note' });
      throw err;
    }
  },

  deleteNote: async (noteId: string) => {
    set({ error: null });
    try {
      await notesApi.delete(noteId);
      set((state) => ({
        notes: state.notes.filter((n) => n.id !== noteId),
        total: state.total - 1,
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete note' });
      throw err;
    }
  },

  resolveNote: async (noteId: string) => {
    set({ error: null });
    try {
      const updatedNote = await notesApi.resolve(noteId);
      set((state) => ({
        notes: state.notes.map((n) => (n.id === noteId ? updatedNote : n)),
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to resolve note' });
      throw err;
    }
  },

  togglePin: async (noteId: string) => {
    set({ error: null });
    try {
      const updatedNote = await notesApi.togglePin(noteId);
      set((state) => ({
        notes: state.notes.map((n) => (n.id === noteId ? updatedNote : n)),
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to toggle pin' });
      throw err;
    }
  },

  setFilterType: (type: NoteType | null) => {
    set({ filterType: type, page: 1 });
  },

  setSearchTerm: (term: string) => {
    set({ searchTerm: term, page: 1 });
  },

  setPage: (page: number) => {
    set({ page });
  },

  clearNotes: () => {
    set({
      notes: [],
      noteCounts: initialCounts,
      page: 1,
      total: 0,
      totalPages: 1,
      filterType: null,
      searchTerm: '',
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
