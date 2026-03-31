import { describe, expect, it } from 'vitest';

import {
  LANDING_DISMISSED_KEY,
  dismissLandingForSession,
  isLandingDismissedInSession,
  shouldShowLanding,
} from '../src/services/landingSession';

describe('landingSession', () => {
  it('shows landing only when auth is not loading, user is unauthenticated, and landing is not dismissed', () => {
    expect(
      shouldShowLanding({
        hasDismissedLanding: false,
        isAuthenticated: false,
        isAuthLoading: false,
      }),
    ).toBe(true);

    expect(
      shouldShowLanding({
        hasDismissedLanding: true,
        isAuthenticated: false,
        isAuthLoading: false,
      }),
    ).toBe(false);

    expect(
      shouldShowLanding({
        hasDismissedLanding: false,
        isAuthenticated: true,
        isAuthLoading: false,
      }),
    ).toBe(false);

    expect(
      shouldShowLanding({
        hasDismissedLanding: false,
        isAuthenticated: false,
        isAuthLoading: true,
      }),
    ).toBe(false);
  });

  it('stores and reads session dismissal flag', () => {
    const storage = new Map<string, string>();

    const readStorage = {
      getItem: (key: string): string | null => storage.get(key) ?? null,
    };

    const writeStorage = {
      setItem: (key: string, value: string): void => {
        storage.set(key, value);
      },
    };

    expect(isLandingDismissedInSession(readStorage)).toBe(false);

    dismissLandingForSession(writeStorage);

    expect(storage.get(LANDING_DISMISSED_KEY)).toBe('1');
    expect(isLandingDismissedInSession(readStorage)).toBe(true);
  });

  it('fails safely when storage read or write throws', () => {
    const readStorage = {
      getItem: (): string | null => {
        throw new Error('Storage blocked');
      },
    };

    const writeStorage = {
      setItem: (): void => {
        throw new Error('Storage blocked');
      },
    };

    expect(isLandingDismissedInSession(readStorage)).toBe(false);
    expect(() => dismissLandingForSession(writeStorage)).not.toThrow();
  });

  it('fails safely when storage is unavailable', () => {
    expect(isLandingDismissedInSession(null)).toBe(false);
    expect(() => dismissLandingForSession(null)).not.toThrow();
  });
});
