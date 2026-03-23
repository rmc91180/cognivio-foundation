import { create } from 'zustand';
import { aiSuggestionsApi } from '@/services/api';
import type {
  AISuggestion,
  SuggestionStatus,
  SuggestionPriority,
  SuggestionType,
  PatternType,
  SuggestionStats,
} from '@/types';

interface SuggestionsFilters {
  status?: SuggestionStatus;
  priority?: SuggestionPriority;
  suggestionType?: SuggestionType;
  teacherId?: string;
  patternDetected?: PatternType;
  page?: number;
  pageSize?: number;
}

interface SuggestionsState {
  // Suggestions list
  suggestions: AISuggestion[];
  totalSuggestions: number;
  currentPage: number;
  pageSize: number;
  isLoading: boolean;
  error: string | null;

  // Current suggestion
  currentSuggestion: AISuggestion | null;

  // Stats
  stats: SuggestionStats | null;
  statsLoading: boolean;

  // Filters
  filters: SuggestionsFilters;

  // Actions
  fetchSuggestions: (filters?: SuggestionsFilters) => Promise<void>;
  fetchSuggestionById: (id: string) => Promise<void>;
  generateSuggestions: (teacherId: string, templateId?: string) => Promise<AISuggestion[]>;
  acceptSuggestion: (id: string) => Promise<void>;
  rejectSuggestion: (id: string, reason: string) => Promise<void>;
  completeSuggestion: (id: string, notes: string, helpfulnessRating: number) => Promise<void>;
  fetchStats: () => Promise<void>;
  setFilters: (filters: SuggestionsFilters) => void;
  setCurrentSuggestion: (suggestion: AISuggestion | null) => void;
  clearSuggestions: () => void;
  clearError: () => void;
}

export const useSuggestionsStore = create<SuggestionsState>((set, get) => ({
  suggestions: [],
  totalSuggestions: 0,
  currentPage: 1,
  pageSize: 10,
  isLoading: false,
  error: null,
  currentSuggestion: null,
  stats: null,
  statsLoading: false,
  filters: {},

  fetchSuggestions: async (filters?: SuggestionsFilters) => {
    const currentFilters = filters || get().filters;
    set({ isLoading: true, error: null, filters: currentFilters });
    try {
      const result = await aiSuggestionsApi.getSuggestions(currentFilters);
      set({
        suggestions: result.suggestions,
        totalSuggestions: result.total,
        currentPage: result.page,
        pageSize: result.pageSize,
        isLoading: false,
      });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch suggestions', isLoading: false });
    }
  },

  fetchSuggestionById: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const suggestion = await aiSuggestionsApi.getById(id);
      set({ currentSuggestion: suggestion, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch suggestion', isLoading: false });
    }
  },

  generateSuggestions: async (teacherId: string, templateId?: string) => {
    set({ isLoading: true, error: null });
    try {
      const newSuggestions = await aiSuggestionsApi.generateForTeacher(teacherId, templateId);
      set((state) => ({
        suggestions: [...newSuggestions, ...state.suggestions],
        totalSuggestions: state.totalSuggestions + newSuggestions.length,
        isLoading: false,
      }));
      return newSuggestions;
    } catch (err: any) {
      set({ error: err.message || 'Failed to generate suggestions', isLoading: false });
      throw err;
    }
  },

  acceptSuggestion: async (id: string) => {
    set({ error: null });
    try {
      const updated = await aiSuggestionsApi.accept(id);
      set((state) => ({
        suggestions: state.suggestions.map((s) => (s.id === id ? updated : s)),
        currentSuggestion: state.currentSuggestion?.id === id ? updated : state.currentSuggestion,
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to accept suggestion' });
      throw err;
    }
  },

  rejectSuggestion: async (id: string, reason: string) => {
    set({ error: null });
    try {
      const updated = await aiSuggestionsApi.reject(id, reason);
      set((state) => ({
        suggestions: state.suggestions.map((s) => (s.id === id ? updated : s)),
        currentSuggestion: state.currentSuggestion?.id === id ? updated : state.currentSuggestion,
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to reject suggestion' });
      throw err;
    }
  },

  completeSuggestion: async (id: string, notes: string, helpfulnessRating: number) => {
    set({ error: null });
    try {
      const updated = await aiSuggestionsApi.complete(id, notes, helpfulnessRating);
      set((state) => ({
        suggestions: state.suggestions.map((s) => (s.id === id ? updated : s)),
        currentSuggestion: state.currentSuggestion?.id === id ? updated : state.currentSuggestion,
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to complete suggestion' });
      throw err;
    }
  },

  fetchStats: async () => {
    set({ statsLoading: true });
    try {
      const stats = await aiSuggestionsApi.getStats();
      set({ stats, statsLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch stats', statsLoading: false });
    }
  },

  setFilters: (filters: SuggestionsFilters) => {
    set({ filters });
  },

  setCurrentSuggestion: (suggestion: AISuggestion | null) => {
    set({ currentSuggestion: suggestion });
  },

  clearSuggestions: () => {
    set({
      suggestions: [],
      totalSuggestions: 0,
      currentSuggestion: null,
      stats: null,
      filters: {},
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
