type SessionReadStorage = Pick<Storage, 'getItem'>;
type SessionWriteStorage = Pick<Storage, 'setItem'>;

export const LANDING_DISMISSED_KEY = 'ai-note-keeper-landing-dismissed';

export const getSessionStorageSafely = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export const isLandingDismissedInSession = (storage: SessionReadStorage | null): boolean => {
  if (!storage) {
    return false;
  }

  try {
    return storage.getItem(LANDING_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
};

export const dismissLandingForSession = (storage: SessionWriteStorage | null): void => {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(LANDING_DISMISSED_KEY, '1');
  } catch {
    // Ignore storage write failures and continue; landing state is still dismissed in memory.
  }
};

type LandingVisibilityInput = {
  hasDismissedLanding: boolean;
  isAuthenticated: boolean;
  isAuthLoading: boolean;
};

export const shouldShowLanding = ({
  hasDismissedLanding,
  isAuthenticated,
  isAuthLoading,
}: LandingVisibilityInput): boolean => !hasDismissedLanding && !isAuthenticated && !isAuthLoading;
