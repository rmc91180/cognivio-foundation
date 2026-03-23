import { create } from 'zustand';
import { feedbackApi } from '@/services/api';
import type {
  AIFeedback,
  CreateFeedbackInput,
  CreateCorrectionInput,
  FeedbackCorrection,
  FeedbackAnalytics,
} from '@/types';

interface FeedbackState {
  // Current feedback
  currentFeedback: AIFeedback | null;
  observationFeedbacks: AIFeedback[];
  isLoading: boolean;
  error: string | null;

  // Analytics (admin)
  analytics: FeedbackAnalytics | null;
  analyticsLoading: boolean;

  // Form state
  isSubmitting: boolean;

  // Actions
  submitFeedback: (input: CreateFeedbackInput) => Promise<AIFeedback>;
  updateFeedback: (feedbackId: string, updates: Partial<CreateFeedbackInput>) => Promise<void>;
  fetchFeedbackForObservation: (observationId: string) => Promise<void>;
  addCorrection: (feedbackId: string, correction: CreateCorrectionInput) => Promise<FeedbackCorrection>;
  approveFeedback: (feedbackId: string) => Promise<void>;
  validateCorrection: (correctionId: string) => Promise<void>;
  fetchAnalytics: (params?: { startDate?: string; endDate?: string }) => Promise<void>;
  setCurrentFeedback: (feedback: AIFeedback | null) => void;
  clearFeedback: () => void;
  clearError: () => void;
}

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  currentFeedback: null,
  observationFeedbacks: [],
  isLoading: false,
  error: null,
  analytics: null,
  analyticsLoading: false,
  isSubmitting: false,

  submitFeedback: async (input: CreateFeedbackInput) => {
    set({ isSubmitting: true, error: null });
    try {
      const feedback = await feedbackApi.submit(input);
      set((state) => ({
        currentFeedback: feedback,
        observationFeedbacks: [feedback, ...state.observationFeedbacks],
        isSubmitting: false,
      }));
      return feedback;
    } catch (err: any) {
      set({ error: err.message || 'Failed to submit feedback', isSubmitting: false });
      throw err;
    }
  },

  updateFeedback: async (feedbackId: string, updates: Partial<CreateFeedbackInput>) => {
    set({ isSubmitting: true, error: null });
    try {
      const updated = await feedbackApi.update(feedbackId, updates);
      set((state) => ({
        currentFeedback: state.currentFeedback?.id === feedbackId ? updated : state.currentFeedback,
        observationFeedbacks: state.observationFeedbacks.map((f) =>
          f.id === feedbackId ? updated : f
        ),
        isSubmitting: false,
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to update feedback', isSubmitting: false });
      throw err;
    }
  },

  fetchFeedbackForObservation: async (observationId: string) => {
    set({ isLoading: true, error: null });
    try {
      const feedbacks = await feedbackApi.getForObservation(observationId);
      set({
        observationFeedbacks: feedbacks,
        currentFeedback: feedbacks.length > 0 ? feedbacks[0] : null,
        isLoading: false,
      });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch feedback', isLoading: false });
    }
  },

  addCorrection: async (feedbackId: string, correction: CreateCorrectionInput) => {
    set({ error: null });
    try {
      const newCorrection = await feedbackApi.addCorrection(feedbackId, correction);

      // Update the current feedback with the new correction
      set((state) => {
        if (state.currentFeedback?.id === feedbackId) {
          return {
            currentFeedback: {
              ...state.currentFeedback,
              corrections: [...(state.currentFeedback.corrections || []), newCorrection],
              containsCorrections: true,
              elementsDisagreed: state.currentFeedback.elementsDisagreed + 1,
            },
          };
        }
        return state;
      });

      return newCorrection;
    } catch (err: any) {
      set({ error: err.message || 'Failed to add correction' });
      throw err;
    }
  },

  approveFeedback: async (feedbackId: string) => {
    set({ error: null });
    try {
      const updated = await feedbackApi.approve(feedbackId);
      set((state) => ({
        currentFeedback: state.currentFeedback?.id === feedbackId ? updated : state.currentFeedback,
        observationFeedbacks: state.observationFeedbacks.map((f) =>
          f.id === feedbackId ? updated : f
        ),
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to approve feedback' });
      throw err;
    }
  },

  validateCorrection: async (correctionId: string) => {
    set({ error: null });
    try {
      const validated = await feedbackApi.validateCorrection(correctionId);

      // Update correction in current feedback
      set((state) => {
        if (state.currentFeedback?.corrections) {
          return {
            currentFeedback: {
              ...state.currentFeedback,
              corrections: state.currentFeedback.corrections.map((c) =>
                c.id === correctionId ? validated : c
              ),
            },
          };
        }
        return state;
      });
    } catch (err: any) {
      set({ error: err.message || 'Failed to validate correction' });
      throw err;
    }
  },

  fetchAnalytics: async (params) => {
    set({ analyticsLoading: true });
    try {
      const analytics = await feedbackApi.getAnalytics(params);
      set({ analytics, analyticsLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch analytics', analyticsLoading: false });
    }
  },

  setCurrentFeedback: (feedback: AIFeedback | null) => {
    set({ currentFeedback: feedback });
  },

  clearFeedback: () => {
    set({
      currentFeedback: null,
      observationFeedbacks: [],
      analytics: null,
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
