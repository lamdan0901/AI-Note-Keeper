const WEB_AUTH_SESSION_KEY = 'web-auth-session';
const WEB_LOCAL_USER_KEY = 'web-local-user-id';

export type WebAuthSession = {
  userId: string;
  username: string;
};

export const getOrCreateWebLocalUserId = (): string => {
  const existing = window.localStorage.getItem(WEB_LOCAL_USER_KEY);
  if (existing) {
    return existing;
  }
  const next = crypto.randomUUID();
  window.localStorage.setItem(WEB_LOCAL_USER_KEY, next);
  return next;
};

export const loadWebAuthSession = (): WebAuthSession | null => {
  const raw = window.localStorage.getItem(WEB_AUTH_SESSION_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<WebAuthSession>;
  if (!parsed.userId || !parsed.username) {
    return null;
  }
  return {
    userId: parsed.userId,
    username: parsed.username,
  };
};

export const saveWebAuthSession = (session: WebAuthSession): void => {
  window.localStorage.setItem(WEB_AUTH_SESSION_KEY, JSON.stringify(session));
};

export const clearWebAuthSession = (): void => {
  window.localStorage.removeItem(WEB_AUTH_SESSION_KEY);
};
