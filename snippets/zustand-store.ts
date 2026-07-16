import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

interface UserProfile {
  id: string;
  name: string;
  email: string;
}

interface AppState {
  user: UserProfile | null;
  locale: 'ar' | 'en';
  sidebarOpen: boolean;
  setUser: (user: UserProfile | null) => void;
  setLocale: (locale: 'ar' | 'en') => void;
  toggleSidebar: () => void;
  reset: () => void;
}

const initialState = {
  user: null,
  locale: 'ar' as const,
  sidebarOpen: true
};

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,
        setUser: (user) => set({ user }, false, 'app/setUser'),
        setLocale: (locale) => set({ locale }, false, 'app/setLocale'),
        toggleSidebar: () =>
          set((state) => ({ sidebarOpen: !state.sidebarOpen }), false, 'app/toggleSidebar'),
        reset: () => set(initialState, false, 'app/reset')
      }),
      {
        name: 'app-store',
        partialize: (state) => ({
          locale: state.locale,
          sidebarOpen: state.sidebarOpen
        })
      }
    ),
    {
      name: 'AppStore'
    }
  )
);

export const appSelectors = {
  user: (state: AppState) => state.user,
  locale: (state: AppState) => state.locale,
  sidebarOpen: (state: AppState) => state.sidebarOpen,
  layout: (state: AppState) => ({
    locale: state.locale,
    sidebarOpen: state.sidebarOpen
  })
};

export function useAppLayout() {
  return useAppStore(useShallow(appSelectors.layout));
}
