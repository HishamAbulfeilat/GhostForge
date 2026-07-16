import { create } from 'zustand';

interface AppStore {
  locale: 'ar' | 'en';
  sidebarOpen: boolean;
  setLocale: (locale: 'ar' | 'en') => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  locale: 'ar',
  sidebarOpen: true,
  setLocale: (locale) => set({ locale }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen }))
}));
