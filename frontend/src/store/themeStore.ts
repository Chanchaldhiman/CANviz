/**
 * themeStore.ts
 * -------------
 * Global theme state. Persists to localStorage and applies the
 * data-theme attribute on <html> so every CSS variable override
 * in index.css takes effect immediately.
 *
 * Usage:
 *   const { theme, toggle } = useThemeStore();
 */

import { create } from 'zustand';

export type Theme = 'dark' | 'light';

interface ThemeStore {
  theme: Theme;
  toggle: () => void;
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('canviz-theme', theme);
}

// Initialise from localStorage on module load (before first render)
const initialTheme: Theme =
  (localStorage.getItem('canviz-theme') as Theme | null) ?? 'dark';
applyTheme(initialTheme);

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: initialTheme,
  toggle: () =>
    set((s) => {
      const next: Theme = s.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return { theme: next };
    }),
}));
