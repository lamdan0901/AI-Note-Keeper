import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getStoredThemeMode,
  getSystemPrefersDark,
  isThemeMode,
  resolveThemeMode,
  SYSTEM_DARK_QUERY,
} from '../src/services/theme';

type MockMediaQueryList = {
  matches: boolean;
  addEventListener: () => void;
  removeEventListener: () => void;
};

type MockWindow = {
  localStorage: {
    getItem: (key: string) => string | null;
  };
  matchMedia: (query: string) => MockMediaQueryList;
};

function setMockWindow(storedValue: string | null, prefersDark: boolean): void {
  const mockWindow: MockWindow = {
    localStorage: {
      getItem: vi.fn().mockReturnValue(storedValue),
    },
    matchMedia: vi.fn().mockImplementation((query: string) => {
      if (query !== SYSTEM_DARK_QUERY) {
        throw new Error(`Unexpected media query: ${query}`);
      }

      return {
        matches: prefersDark,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
    }),
  };

  vi.stubGlobal('window', mockWindow as unknown as Window & typeof globalThis);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isThemeMode', () => {
  it('accepts light and dark only', () => {
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('auto')).toBe(false);
  });
});

describe('getStoredThemeMode', () => {
  it('returns null when no browser window is available', () => {
    expect(getStoredThemeMode()).toBeNull();
  });

  it('returns null when storage value is missing', () => {
    setMockWindow(null, false);
    expect(getStoredThemeMode()).toBeNull();
  });

  it('returns null when storage value is invalid', () => {
    setMockWindow('auto', false);
    expect(getStoredThemeMode()).toBeNull();
  });

  it('returns stored light/dark values', () => {
    setMockWindow('light', false);
    expect(getStoredThemeMode()).toBe('light');

    setMockWindow('dark', false);
    expect(getStoredThemeMode()).toBe('dark');
  });
});

describe('getSystemPrefersDark', () => {
  it('falls back to light when no browser window is available', () => {
    expect(getSystemPrefersDark()).toBe(false);
  });

  it('reads system preference from matchMedia', () => {
    setMockWindow(null, true);
    expect(getSystemPrefersDark()).toBe(true);

    setMockWindow(null, false);
    expect(getSystemPrefersDark()).toBe(false);
  });
});

describe('resolveThemeMode', () => {
  it('follows system preference when no user choice is stored', () => {
    expect(resolveThemeMode(null, true)).toBe('dark');
    expect(resolveThemeMode(null, false)).toBe('light');
  });

  it('uses explicit user choice regardless of system preference', () => {
    expect(resolveThemeMode('dark', false)).toBe('dark');
    expect(resolveThemeMode('light', true)).toBe('light');
  });
});
