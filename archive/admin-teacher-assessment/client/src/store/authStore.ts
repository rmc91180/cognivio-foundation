import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, LoginCredentials } from '@/types';
import { authApi } from '@/services/api';

interface SetAuthParams {
  token: string;
  refreshToken?: string;
  user: {
    id: string;
    email: string;
    name: string;
    roles: string[];
    activeRole: string;
  };
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  setUser: (user: User) => void;
  setAuth: (params: SetAuthParams) => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (credentials) => {
        set({ isLoading: true, error: null });
        try {
          const response = await authApi.login(credentials);
          set({
            user: response.user,
            token: response.token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Login failed',
            isLoading: false,
          });
          throw error;
        }
      },

      logout: () => {
        authApi.logout();
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          error: null,
        });
      },

      setUser: (user) => {
        set({ user });
      },

      setAuth: (params) => {
        // Map incoming roles to valid UserRole values
        type ValidRole = 'admin' | 'principal' | 'department_head' | 'teacher' | 'observer';
        const validRoleValues: ValidRole[] = ['admin', 'principal', 'department_head', 'teacher', 'observer'];
        const validRoles = params.user.roles.filter((r): r is ValidRole =>
          validRoleValues.includes(r as ValidRole)
        );
        const activeRole: ValidRole = validRoleValues.includes(params.user.activeRole as ValidRole)
          ? (params.user.activeRole as ValidRole)
          : validRoles[0] || 'teacher';

        const user: User = {
          id: params.user.id,
          email: params.user.email,
          name: params.user.name,
          roles: validRoles.length > 0 ? validRoles : ['teacher'],
          activeRole,
          schoolId: null,
          schoolName: null,
          defaultRoute: '/dashboard',
          preferences: {},
        };
        set({
          user,
          token: params.token,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      },

      clearError: () => {
        set({ error: null });
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
