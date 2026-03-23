import { create } from 'zustand';
import { videoApi } from '@/services/api';
import type { VideoAnalysis } from '@/types';

interface VideoState {
  // Current video analysis
  currentAnalysis: VideoAnalysis | null;
  isLoading: boolean;
  error: string | null;

  // Video list for a teacher
  teacherVideos: Array<{
    id: string;
    teacherId: string;
    filename: string;
    status: string;
    uploadedAt: string;
    processedAt?: string;
  }>;

  // Upload state
  uploadProgress: number;
  isUploading: boolean;

  // Actions
  fetchAnalysis: (videoId: string) => Promise<void>;
  uploadVideo: (teacherId: string, classId?: string, filename?: string) => Promise<string>;
  checkStatus: (videoId: string) => Promise<any>;
  clearAnalysis: () => void;
  clearError: () => void;
}

export const useVideoStore = create<VideoState>((set, get) => ({
  currentAnalysis: null,
  isLoading: false,
  error: null,
  teacherVideos: [],
  uploadProgress: 0,
  isUploading: false,

  fetchAnalysis: async (videoId: string) => {
    set({ isLoading: true, error: null });
    try {
      const analysis = await videoApi.getAnalysis(videoId);
      set({ currentAnalysis: analysis, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch analysis', isLoading: false });
    }
  },

  uploadVideo: async (teacherId: string, classId?: string, filename?: string) => {
    set({ isUploading: true, uploadProgress: 0, error: null });
    try {
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        set((state) => ({
          uploadProgress: Math.min(state.uploadProgress + 10, 90),
        }));
      }, 200);

      const result = await videoApi.upload(teacherId, classId, filename);

      clearInterval(progressInterval);
      set({ uploadProgress: 100, isUploading: false });

      return result.videoId;
    } catch (err: any) {
      set({ error: err.message || 'Failed to upload video', isUploading: false });
      throw err;
    }
  },

  checkStatus: async (videoId: string) => {
    try {
      return await videoApi.getStatus(videoId);
    } catch (err: any) {
      set({ error: err.message || 'Failed to check status' });
      throw err;
    }
  },

  clearAnalysis: () => {
    set({ currentAnalysis: null, error: null });
  },

  clearError: () => {
    set({ error: null });
  },
}));
