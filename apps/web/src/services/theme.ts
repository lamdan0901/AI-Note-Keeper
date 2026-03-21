export type ThemeMode = 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme-mode';
export const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

const THEME_MODES: ThemeMode[] = ['light', 'dark'];

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && THEME_MODES.includes(value as ThemeMode);
}

export function getStoredThemeMode(): ThemeMode | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeMode(stored) ? stored : null;
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

export function resolveThemeMode(mode: ThemeMode | null, prefersDark: boolean): ResolvedTheme {
  if (mode == null) {
    return prefersDark ? 'dark' : 'light';
  }

  return mode;
}
