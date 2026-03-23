import { useAuthStore } from '../authStore';

// Reset store before each test
beforeEach(() => {
  useAuthStore.setState({
    user: null,
    token: null,
    isAuthenticated: false,
  });
  localStorage.clear();
});

describe('authStore', () => {
  const mockUser = {
    id: 'test-user-id',
    email: 'admin@test.com',
    name: 'Test Admin',
    roles: ['admin'] as const,
    activeRole: 'admin' as const,
  };

  const mockToken = 'mock-jwt-token';

  describe('login', () => {
    it('sets user and token', () => {
      useAuthStore.getState().login(mockUser, mockToken);

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.token).toBe(mockToken);
      expect(state.isAuthenticated).toBe(true);
    });

    it('persists token to localStorage', () => {
      useAuthStore.getState().login(mockUser, mockToken);

      expect(localStorage.getItem('auth_token')).toBe(mockToken);
    });
  });

  describe('logout', () => {
    it('clears user and token', () => {
      // First login
      useAuthStore.getState().login(mockUser, mockToken);

      // Then logout
      useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });

    it('removes token from localStorage', () => {
      useAuthStore.getState().login(mockUser, mockToken);
      useAuthStore.getState().logout();

      expect(localStorage.getItem('auth_token')).toBeNull();
    });
  });

  describe('setActiveRole', () => {
    it('updates active role', () => {
      useAuthStore.getState().login(
        { ...mockUser, roles: ['admin', 'observer'] },
        mockToken
      );

      useAuthStore.getState().setActiveRole('observer');

      const state = useAuthStore.getState();
      expect(state.user?.activeRole).toBe('observer');
    });

    it('does nothing if user is not logged in', () => {
      useAuthStore.getState().setActiveRole('admin');

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
    });
  });

  describe('isAuthenticated', () => {
    it('returns true when user is logged in', () => {
      useAuthStore.getState().login(mockUser, mockToken);

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });

    it('returns false when user is logged out', () => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });
});
