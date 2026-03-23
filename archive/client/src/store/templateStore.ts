import { create } from 'zustand';
import type { RubricTemplate, Domain, TemplateColumn, AggregationMode } from '@/types';
import { rubricsApi } from '@/services/api';

interface TemplateState {
  templates: RubricTemplate[];
  activeTemplate: RubricTemplate | null;
  domains: Domain[];
  columns: TemplateColumn[];
  isLoading: boolean;
  error: string | null;
  fetchTemplates: () => Promise<void>;
  fetchElements: (templateId: string) => Promise<void>;
  fetchColumns: (templateId: string) => Promise<void>;
  selectTemplate: (templateId: string, setAsDefault?: boolean) => Promise<void>;
  setActiveTemplate: (template: RubricTemplate | null) => void;
  createTemplate: (data: {
    name: string;
    description?: string;
    aggregationMode: AggregationMode;
    columns: { name: string; weight: number; enabled: boolean; elementIds: string[] }[];
  }) => Promise<string>;
  clearError: () => void;
}

export const useTemplateStore = create<TemplateState>((set, get) => ({
  templates: [],
  activeTemplate: null,
  domains: [],
  columns: [],
  isLoading: false,
  error: null,

  fetchTemplates: async () => {
    set({ isLoading: true, error: null });
    try {
      const templates = await rubricsApi.getTemplates();
      set({ templates, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch templates',
        isLoading: false,
      });
    }
  },

  fetchElements: async (templateId: string) => {
    set({ isLoading: true, error: null });
    try {
      const data = await rubricsApi.getElements(templateId);
      set({ domains: data.domains, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch elements',
        isLoading: false,
      });
    }
  },

  fetchColumns: async (templateId: string) => {
    try {
      const columns = await rubricsApi.getColumns(templateId);
      set({ columns });
    } catch (error) {
      console.error('Failed to fetch columns:', error);
    }
  },

  selectTemplate: async (templateId: string, setAsDefault = false) => {
    set({ isLoading: true, error: null });
    try {
      await rubricsApi.selectTemplate(templateId, setAsDefault);
      const template = get().templates.find((t) => t.id === templateId);
      set({ activeTemplate: template || null, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to select template',
        isLoading: false,
      });
    }
  },

  setActiveTemplate: (template) => {
    set({ activeTemplate: template });
  },

  createTemplate: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const result = await rubricsApi.createTemplate(data);
      // Refresh templates list
      await get().fetchTemplates();
      set({ isLoading: false });
      return result.id;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create template',
        isLoading: false,
      });
      throw error;
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));
