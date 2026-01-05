import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@claude-code-webui/shared';
import { api, setTokenGetter } from '@/services/api';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  _hasHydrated: boolean;
  setToken: (token: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  setHasHydrated: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: true,
      _hasHydrated: false,

      setHasHydrated: (value: boolean) => {
        set({ _hasHydrated: value });
      },

      setToken: async (token: string) => {
        set({ token, isLoading: true });
        try {
          const response = await api.get<{ success: boolean; data: User }>('/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.data.success && response.data.data) {
            set({ user: response.data.data, isAuthenticated: true, isLoading: false });
          } else {
            set({ token: null, isAuthenticated: false, isLoading: false });
          }
        } catch {
          set({ token: null, isAuthenticated: false, isLoading: false });
        }
      },

      logout: () => {
        set({ user: null, token: null, isAuthenticated: false });
        api.post('/auth/logout').catch(() => {});
      },

      checkAuth: async () => {
        const { token } = get();
        if (!token) {
          set({ isLoading: false });
          return;
        }

        try {
          const response = await api.get<{ success: boolean; data: User }>('/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.data.success && response.data.data) {
            set({ user: response.data.data, isAuthenticated: true, isLoading: false });
          } else {
            set({ token: null, user: null, isAuthenticated: false, isLoading: false });
          }
        } catch {
          set({ token: null, user: null, isAuthenticated: false, isLoading: false });
        }
      },
    }),
    {
      name: 'claude-webui-auth',
      partialize: (state) => ({ token: state.token }),
      onRehydrateStorage: () => (state) => {
        // Mark as hydrated and trigger auth check
        if (state) {
          state.setHasHydrated(true);
          if (state.token) {
            state.checkAuth();
          }
          // If no token, the setTimeout at module level will handle setting isLoading false
        }
      },
    }
  )
);

// Set the token getter for the API client to avoid circular dependency
setTokenGetter(() => useAuthStore.getState().token);

// Initialize auth check after store is created
// This runs once when the module loads
if (typeof window !== 'undefined') {
  // Wait for next tick to ensure store is fully initialized
  setTimeout(() => {
    const state = useAuthStore.getState();
    // If already hydrated with a token, checkAuth was already called
    // If hydrated without token, just set isLoading false
    if (state._hasHydrated && !state.token && state.isLoading) {
      useAuthStore.setState({ isLoading: false });
    }
  }, 0);
}
