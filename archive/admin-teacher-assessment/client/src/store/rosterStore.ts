import { create } from 'zustand';
import { rosterApi, teachersApi } from '@/services/api';
import type { RosterRow, RosterTotals, TeacherDetail, StatusColor } from '@/types';

interface RosterState {
  // Roster data
  rows: RosterRow[];
  totals: RosterTotals;
  isLoading: boolean;
  error: string | null;

  // Pagination
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;

  // Sorting
  sortField: string;
  sortOrder: 'asc' | 'desc';

  // Filters
  searchTerm: string;
  selectedSubjects: string[];
  selectedGrades: string[];
  selectedStatuses: StatusColor[];
  gradebookIssuesOnly: boolean;

  // Current teacher detail
  currentTeacher: TeacherDetail | null;
  teacherLoading: boolean;

  // Actions
  fetchRoster: (templateId: string) => Promise<void>;
  fetchTeacherDetail: (teacherId: string, templateId: string, start: string, end: string) => Promise<void>;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSort: (field: string, order: 'asc' | 'desc') => void;
  setSearchTerm: (term: string) => void;
  setSubjectFilter: (subjects: string[]) => void;
  setGradeFilter: (grades: string[]) => void;
  setStatusFilter: (statuses: StatusColor[]) => void;
  setGradebookIssuesOnly: (value: boolean) => void;
  clearFilters: () => void;
  clearTeacher: () => void;
  clearError: () => void;
}

const initialTotals: RosterTotals = {
  total: 0,
  green: 0,
  yellow: 0,
  red: 0,
  missingGradebook: 0,
};

export const useRosterStore = create<RosterState>((set, get) => ({
  rows: [],
  totals: initialTotals,
  isLoading: false,
  error: null,
  page: 1,
  pageSize: 25,
  totalPages: 1,
  totalItems: 0,
  sortField: 'name',
  sortOrder: 'asc',
  searchTerm: '',
  selectedSubjects: [],
  selectedGrades: [],
  selectedStatuses: [],
  gradebookIssuesOnly: false,
  currentTeacher: null,
  teacherLoading: false,

  fetchRoster: async (templateId: string) => {
    const {
      page,
      pageSize,
      sortField,
      sortOrder,
      searchTerm,
      selectedSubjects,
      selectedGrades,
      selectedStatuses,
      gradebookIssuesOnly,
    } = get();

    set({ isLoading: true, error: null });

    try {
      const result = await rosterApi.getRoster({
        templateId,
        page,
        pageSize,
        sort: sortField,
        order: sortOrder,
        search: searchTerm || undefined,
        subjects: selectedSubjects.length > 0 ? selectedSubjects : undefined,
        grades: selectedGrades.length > 0 ? selectedGrades : undefined,
        status: selectedStatuses.length > 0 ? selectedStatuses : undefined,
        gradebookIssues: gradebookIssuesOnly || undefined,
      });

      set({
        rows: result.rows,
        totals: result.totals,
        totalPages: result.meta?.totalPages || 1,
        totalItems: result.meta?.totalItems || result.rows.length,
        isLoading: false,
      });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch roster', isLoading: false });
    }
  },

  fetchTeacherDetail: async (teacherId: string, templateId: string, start: string, end: string) => {
    set({ teacherLoading: true, error: null });

    try {
      const detail = await teachersApi.getDetail(teacherId, templateId, start, end);
      set({ currentTeacher: detail, teacherLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch teacher detail', teacherLoading: false });
    }
  },

  setPage: (page: number) => {
    set({ page });
  },

  setPageSize: (size: number) => {
    set({ pageSize: size, page: 1 });
  },

  setSort: (field: string, order: 'asc' | 'desc') => {
    set({ sortField: field, sortOrder: order, page: 1 });
  },

  setSearchTerm: (term: string) => {
    set({ searchTerm: term, page: 1 });
  },

  setSubjectFilter: (subjects: string[]) => {
    set({ selectedSubjects: subjects, page: 1 });
  },

  setGradeFilter: (grades: string[]) => {
    set({ selectedGrades: grades, page: 1 });
  },

  setStatusFilter: (statuses: StatusColor[]) => {
    set({ selectedStatuses: statuses, page: 1 });
  },

  setGradebookIssuesOnly: (value: boolean) => {
    set({ gradebookIssuesOnly: value, page: 1 });
  },

  clearFilters: () => {
    set({
      searchTerm: '',
      selectedSubjects: [],
      selectedGrades: [],
      selectedStatuses: [],
      gradebookIssuesOnly: false,
      page: 1,
    });
  },

  clearTeacher: () => {
    set({ currentTeacher: null });
  },

  clearError: () => {
    set({ error: null });
  },
}));
