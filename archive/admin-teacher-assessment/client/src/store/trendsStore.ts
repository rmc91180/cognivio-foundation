import { create } from 'zustand';
import { trendsApi } from '@/services/api';
import type {
  TrendDataPoint,
  RegressionAlert,
  ProgressReport,
  RiskPrediction,
  SchoolTrendSummary,
  PeriodType,
} from '@/types';

interface TrendFilters {
  templateId?: string;
  elementId?: string;
  periodType?: PeriodType;
  startDate?: string;
  endDate?: string;
}

interface TrendsState {
  // Teacher trends
  trendData: TrendDataPoint[];
  isLoading: boolean;
  error: string | null;

  // Alerts & Progress
  regressionAlerts: RegressionAlert[];
  progressReports: ProgressReport[];
  alertsLoading: boolean;

  // Risk prediction
  riskPrediction: RiskPrediction | null;
  riskLoading: boolean;

  // School overview
  schoolOverview: SchoolTrendSummary | null;
  schoolLoading: boolean;

  // Filters
  filters: TrendFilters;

  // Current teacher ID for context
  currentTeacherId: string | null;

  // Actions
  fetchTeacherTrends: (teacherId: string, filters?: TrendFilters) => Promise<void>;
  fetchRegressionAlerts: (teacherId: string) => Promise<void>;
  fetchProgressReports: (teacherId: string) => Promise<void>;
  fetchRiskPrediction: (teacherId: string, elementId?: string) => Promise<void>;
  calculateTrends: (teacherId: string, templateId: string, periodType?: PeriodType) => Promise<TrendDataPoint[]>;
  fetchSchoolOverview: (schoolId?: string) => Promise<void>;
  setFilters: (filters: TrendFilters) => void;
  setCurrentTeacher: (teacherId: string | null) => void;
  clearTrends: () => void;
  clearError: () => void;
}

export const useTrendsStore = create<TrendsState>((set, get) => ({
  trendData: [],
  isLoading: false,
  error: null,
  regressionAlerts: [],
  progressReports: [],
  alertsLoading: false,
  riskPrediction: null,
  riskLoading: false,
  schoolOverview: null,
  schoolLoading: false,
  filters: {},
  currentTeacherId: null,

  fetchTeacherTrends: async (teacherId: string, filters?: TrendFilters) => {
    const currentFilters = filters || get().filters;
    set({ isLoading: true, error: null, filters: currentFilters, currentTeacherId: teacherId });
    try {
      const trends = await trendsApi.getTeacherTrends(teacherId, currentFilters);
      set({ trendData: trends, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch trends', isLoading: false });
    }
  },

  fetchRegressionAlerts: async (teacherId: string) => {
    set({ alertsLoading: true, error: null });
    try {
      const alerts = await trendsApi.getAlerts(teacherId);
      set({ regressionAlerts: alerts, alertsLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch alerts', alertsLoading: false });
    }
  },

  fetchProgressReports: async (teacherId: string) => {
    set({ alertsLoading: true, error: null });
    try {
      const progress = await trendsApi.getProgress(teacherId);
      set({ progressReports: progress, alertsLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch progress', alertsLoading: false });
    }
  },

  fetchRiskPrediction: async (teacherId: string, elementId?: string) => {
    set({ riskLoading: true, error: null });
    try {
      const prediction = await trendsApi.getPredictedRisk(teacherId, elementId);
      set({ riskPrediction: prediction, riskLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch risk prediction', riskLoading: false });
    }
  },

  calculateTrends: async (teacherId: string, templateId: string, periodType?: PeriodType) => {
    set({ isLoading: true, error: null });
    try {
      const trends = await trendsApi.calculateTrends(teacherId, templateId, periodType);
      set((state) => ({
        trendData: trends,
        isLoading: false,
      }));
      return trends;
    } catch (err: any) {
      set({ error: err.message || 'Failed to calculate trends', isLoading: false });
      throw err;
    }
  },

  fetchSchoolOverview: async (schoolId?: string) => {
    set({ schoolLoading: true, error: null });
    try {
      const overview = await trendsApi.getSchoolOverview(schoolId);
      set({ schoolOverview: overview, schoolLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch school overview', schoolLoading: false });
    }
  },

  setFilters: (filters: TrendFilters) => {
    set({ filters });
  },

  setCurrentTeacher: (teacherId: string | null) => {
    set({ currentTeacherId: teacherId });
  },

  clearTrends: () => {
    set({
      trendData: [],
      regressionAlerts: [],
      progressReports: [],
      riskPrediction: null,
      schoolOverview: null,
      filters: {},
      currentTeacherId: null,
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
