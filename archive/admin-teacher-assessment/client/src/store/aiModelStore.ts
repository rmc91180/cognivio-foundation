import { create } from 'zustand';
import { aiLearningApi } from '@/services/api';
import type {
  AIModelVersion,
  AILearningEntry,
  LearningPattern,
  TrainingDataExport,
} from '@/types';

interface LearningHistoryFilters {
  elementId?: string;
  startDate?: string;
  endDate?: string;
  correctionType?: string;
  page?: number;
  pageSize?: number;
}

interface PatternFilters {
  frameworkType?: string;
  domainName?: string;
  elementId?: string;
  modelVersion?: string;
  minSamples?: number;
}

interface ExportFilters {
  modelVersion?: string;
  startDate?: string;
  endDate?: string;
  minExpertiseWeight?: number;
}

interface AIModelState {
  // Model version
  currentVersion: AIModelVersion | null;
  isLoadingVersion: boolean;

  // Learning history
  learningHistory: AILearningEntry[];
  totalEntries: number;
  currentPage: number;
  pageSize: number;
  historyLoading: boolean;

  // Patterns
  patterns: LearningPattern[];
  patternsLoading: boolean;

  // Training data export
  trainingData: TrainingDataExport[];
  exportLoading: boolean;

  // Error state
  error: string | null;

  // Filters
  historyFilters: LearningHistoryFilters;
  patternFilters: PatternFilters;

  // Actions
  fetchCurrentVersion: () => Promise<void>;
  createModelVersion: (params: {
    version: string;
    type: string;
    name: string;
    description?: string;
    config?: Record<string, any>;
  }) => Promise<void>;
  activateModelVersion: (version: string) => Promise<void>;
  fetchLearningHistory: (teacherId: string, filters?: LearningHistoryFilters) => Promise<void>;
  fetchPatterns: (filters?: PatternFilters) => Promise<void>;
  exportTrainingData: (filters?: ExportFilters) => Promise<TrainingDataExport[]>;
  setHistoryFilters: (filters: LearningHistoryFilters) => void;
  setPatternFilters: (filters: PatternFilters) => void;
  clearAIModel: () => void;
  clearError: () => void;
}

export const useAIModelStore = create<AIModelState>((set, get) => ({
  currentVersion: null,
  isLoadingVersion: false,
  learningHistory: [],
  totalEntries: 0,
  currentPage: 1,
  pageSize: 20,
  historyLoading: false,
  patterns: [],
  patternsLoading: false,
  trainingData: [],
  exportLoading: false,
  error: null,
  historyFilters: {},
  patternFilters: {},

  fetchCurrentVersion: async () => {
    set({ isLoadingVersion: true, error: null });
    try {
      const version = await aiLearningApi.getModelVersion();
      set({ currentVersion: version, isLoadingVersion: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch model version', isLoadingVersion: false });
    }
  },

  createModelVersion: async (params) => {
    set({ error: null });
    try {
      await aiLearningApi.createModelVersion(params);
      // Refresh current version
      await get().fetchCurrentVersion();
    } catch (err: any) {
      set({ error: err.message || 'Failed to create model version' });
      throw err;
    }
  },

  activateModelVersion: async (version: string) => {
    set({ error: null });
    try {
      await aiLearningApi.activateModelVersion(version);
      // Refresh current version
      await get().fetchCurrentVersion();
    } catch (err: any) {
      set({ error: err.message || 'Failed to activate model version' });
      throw err;
    }
  },

  fetchLearningHistory: async (teacherId: string, filters?: LearningHistoryFilters) => {
    const currentFilters = filters || get().historyFilters;
    set({ historyLoading: true, error: null, historyFilters: currentFilters });
    try {
      const result = await aiLearningApi.getHistory(teacherId, currentFilters);
      set({
        learningHistory: result.entries,
        totalEntries: result.total,
        currentPage: result.page,
        pageSize: result.pageSize,
        historyLoading: false,
      });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch learning history', historyLoading: false });
    }
  },

  fetchPatterns: async (filters?: PatternFilters) => {
    const currentFilters = filters || get().patternFilters;
    set({ patternsLoading: true, error: null, patternFilters: currentFilters });
    try {
      const patterns = await aiLearningApi.getPatterns(currentFilters);
      set({ patterns, patternsLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch patterns', patternsLoading: false });
    }
  },

  exportTrainingData: async (filters?: ExportFilters) => {
    set({ exportLoading: true, error: null });
    try {
      const data = await aiLearningApi.exportTrainingData(filters);
      set({ trainingData: data, exportLoading: false });
      return data;
    } catch (err: any) {
      set({ error: err.message || 'Failed to export training data', exportLoading: false });
      throw err;
    }
  },

  setHistoryFilters: (filters: LearningHistoryFilters) => {
    set({ historyFilters: filters });
  },

  setPatternFilters: (filters: PatternFilters) => {
    set({ patternFilters: filters });
  },

  clearAIModel: () => {
    set({
      currentVersion: null,
      learningHistory: [],
      patterns: [],
      trainingData: [],
      historyFilters: {},
      patternFilters: {},
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
