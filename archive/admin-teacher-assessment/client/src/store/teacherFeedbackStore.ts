import { create } from 'zustand';
import { teacherFeedbackApi } from '@/services/api';
import type {
  TeacherFeedbackMessage,
  FeedbackType,
  FeedbackPriority,
  FeedbackStats,
} from '@/types';

interface SendFeedbackInput {
  teacherId: string;
  observationId?: string;
  elementId?: string;
  suggestionId?: string;
  videoId?: string;
  feedbackType: FeedbackType;
  subject: string;
  message: string;
  priority?: FeedbackPriority;
  requiresAcknowledgment?: boolean;
  parentMessageId?: string;
}

interface FeedbackFilters {
  feedbackType?: FeedbackType;
  isArchived?: boolean;
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
}

interface TeacherFeedbackState {
  // Messages list
  messages: TeacherFeedbackMessage[];
  totalMessages: number;
  currentPage: number;
  pageSize: number;
  isLoading: boolean;
  error: string | null;

  // Current message (for thread view)
  currentMessage: TeacherFeedbackMessage | null;

  // Unread count
  unreadCount: number;

  // Stats
  stats: FeedbackStats | null;
  statsLoading: boolean;

  // Filters
  filters: FeedbackFilters;

  // Sending state
  isSending: boolean;

  // Actions
  fetchMessages: (teacherId: string, filters?: FeedbackFilters) => Promise<void>;
  sendFeedback: (input: SendFeedbackInput) => Promise<TeacherFeedbackMessage>;
  replyToMessage: (parentMessageId: string, message: string) => Promise<TeacherFeedbackMessage>;
  markAsRead: (messageId: string) => Promise<void>;
  acknowledgeMessage: (messageId: string) => Promise<void>;
  archiveMessage: (messageId: string) => Promise<void>;
  fetchUnreadCount: (teacherId: string) => Promise<void>;
  fetchStats: (teacherId: string) => Promise<void>;
  setFilters: (filters: FeedbackFilters) => void;
  setCurrentMessage: (message: TeacherFeedbackMessage | null) => void;
  clearMessages: () => void;
  clearError: () => void;
}

export const useTeacherFeedbackStore = create<TeacherFeedbackState>((set, get) => ({
  messages: [],
  totalMessages: 0,
  currentPage: 1,
  pageSize: 20,
  isLoading: false,
  error: null,
  currentMessage: null,
  unreadCount: 0,
  stats: null,
  statsLoading: false,
  filters: {},
  isSending: false,

  fetchMessages: async (teacherId: string, filters?: FeedbackFilters) => {
    const currentFilters = filters || get().filters;
    set({ isLoading: true, error: null, filters: currentFilters });
    try {
      const result = await teacherFeedbackApi.getForTeacher(teacherId, currentFilters);
      set({
        messages: result.messages,
        totalMessages: result.total,
        currentPage: result.page,
        pageSize: result.pageSize,
        isLoading: false,
      });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch messages', isLoading: false });
    }
  },

  sendFeedback: async (input: SendFeedbackInput) => {
    set({ isSending: true, error: null });
    try {
      const message = await teacherFeedbackApi.send(input);
      set((state) => ({
        messages: [message, ...state.messages],
        totalMessages: state.totalMessages + 1,
        isSending: false,
      }));
      return message;
    } catch (err: any) {
      set({ error: err.message || 'Failed to send feedback', isSending: false });
      throw err;
    }
  },

  replyToMessage: async (parentMessageId: string, message: string) => {
    set({ isSending: true, error: null });
    try {
      const reply = await teacherFeedbackApi.reply(parentMessageId, message);
      set((state) => ({
        messages: [reply, ...state.messages],
        totalMessages: state.totalMessages + 1,
        isSending: false,
      }));
      return reply;
    } catch (err: any) {
      set({ error: err.message || 'Failed to send reply', isSending: false });
      throw err;
    }
  },

  markAsRead: async (messageId: string) => {
    set({ error: null });
    try {
      const updated = await teacherFeedbackApi.markAsRead(messageId);
      set((state) => ({
        messages: state.messages.map((m) => (m.id === messageId ? updated : m)),
        currentMessage: state.currentMessage?.id === messageId ? updated : state.currentMessage,
        unreadCount: Math.max(0, state.unreadCount - 1),
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to mark as read' });
    }
  },

  acknowledgeMessage: async (messageId: string) => {
    set({ error: null });
    try {
      const updated = await teacherFeedbackApi.acknowledge(messageId);
      set((state) => ({
        messages: state.messages.map((m) => (m.id === messageId ? updated : m)),
        currentMessage: state.currentMessage?.id === messageId ? updated : state.currentMessage,
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to acknowledge message' });
      throw err;
    }
  },

  archiveMessage: async (messageId: string) => {
    set({ error: null });
    try {
      const updated = await teacherFeedbackApi.archive(messageId);
      set((state) => ({
        messages: state.messages.map((m) => (m.id === messageId ? updated : m)),
        currentMessage: state.currentMessage?.id === messageId ? updated : state.currentMessage,
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to archive message' });
      throw err;
    }
  },

  fetchUnreadCount: async (teacherId: string) => {
    try {
      const result = await teacherFeedbackApi.getUnreadCount(teacherId);
      set({ unreadCount: result.unreadCount });
    } catch (err: any) {
      // Silent fail for unread count
      console.error('Failed to fetch unread count:', err);
    }
  },

  fetchStats: async (teacherId: string) => {
    set({ statsLoading: true });
    try {
      const stats = await teacherFeedbackApi.getStats(teacherId);
      set({ stats, statsLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch stats', statsLoading: false });
    }
  },

  setFilters: (filters: FeedbackFilters) => {
    set({ filters });
  },

  setCurrentMessage: (message: TeacherFeedbackMessage | null) => {
    set({ currentMessage: message });
  },

  clearMessages: () => {
    set({
      messages: [],
      totalMessages: 0,
      currentMessage: null,
      stats: null,
      unreadCount: 0,
      filters: {},
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
