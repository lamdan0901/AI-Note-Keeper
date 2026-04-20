import { uuidv4 } from '../../../../packages/shared/utils/uuid';

const WEB_AUTH_SESSION_KEY = 'web-auth-session';
const WEB_LOCAL_USER_KEY = 'web-local-user-id';

export type WebAuthSession = {
  userId: string;
  username: string;
  accessToken?: string;
};

export type LegacyWebUpgradeSession = {
  userId: string;
  legacySessionToken?: string;
};

export const getOrCreateWebLocalUserId = (): string => {
  const existing = window.localStorage.getItem(WEB_LOCAL_USER_KEY);
  if (existing) {
    return existing;
  }
  const next = uuidv4();
  window.localStorage.setItem(WEB_LOCAL_USER_KEY, next);
  return next;
};

export const loadWebAuthSession = (): WebAuthSession | null => {
  const raw = window.localStorage.getItem(WEB_AUTH_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WebAuthSession>;
    if (!parsed.userId || !parsed.username) {
      return null;
    }

    return {
      userId: parsed.userId,
      username: parsed.username,
      accessToken: parsed.accessToken,
    };
  } catch {
    window.localStorage.removeItem(WEB_AUTH_SESSION_KEY);
    return null;
  }
};

export const loadLegacyWebAuthUpgradeSession = (): LegacyWebUpgradeSession | null => {
  const raw = window.localStorage.getItem(WEB_AUTH_SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WebAuthSession>;
    if (typeof parsed.userId !== 'string' || parsed.userId.length === 0) {
      return null;
    }

    if (typeof parsed.username === 'string' && parsed.username.length > 0) {
      return null;
    }

    return {
      userId: parsed.userId,
      legacySessionToken:
        typeof parsed.accessToken === 'string' && parsed.accessToken.length > 0
          ? parsed.accessToken
          : undefined,
    };
  } catch {
    window.localStorage.removeItem(WEB_AUTH_SESSION_KEY);
    return null;
  }
};

export const saveWebAuthSession = (session: WebAuthSession): void => {
  window.localStorage.setItem(WEB_AUTH_SESSION_KEY, JSON.stringify(session));
};

export const clearWebAuthSession = (): void => {
  window.localStorage.removeItem(WEB_AUTH_SESSION_KEY);
};
