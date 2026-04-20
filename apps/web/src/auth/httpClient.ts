export type WebAuthApiSession = Readonly<{
  userId: string;
  username: string;
  accessToken: string;
  refreshToken?: string;
}>;

type AuthCredentials = Readonly<{
  username: string;
  password: string;
  deviceId?: string;
  guestUserId?: string;
}>;

type UpgradeSessionInput = Readonly<{
  userId: string;
  legacySessionToken?: string;
  deviceId?: string;
}>;

type RefreshInput = Readonly<{
  refreshToken?: string;
  deviceId?: string;
}>;

const AUTH_BASE_URL = import.meta.env.VITE_AUTH_API_BASE_URL as string | undefined;

const normalizeBaseUrl = (baseUrl: string): string => {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
};

export class WebAuthHttpError extends Error {
  public readonly status: number;

  public constructor(message: string, status: number) {
    super(message);
    this.name = 'WebAuthHttpError';
    this.status = status;
  }
}

const parseErrorMessage = async (response: Response): Promise<string> => {
  const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;

  if (payload && typeof payload.message === 'string') {
    return payload.message;
  }

  return `Auth request failed (${response.status})`;
};

const postJson = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
  if (!AUTH_BASE_URL) {
    throw new Error('VITE_AUTH_API_BASE_URL is required for web auth API client');
  }

  const response = await fetch(`${normalizeBaseUrl(AUTH_BASE_URL)}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-client-platform': 'web',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new WebAuthHttpError(await parseErrorMessage(response), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

export type WebAuthHttpClient = Readonly<{
  login: (input: AuthCredentials) => Promise<WebAuthApiSession>;
  register: (input: AuthCredentials) => Promise<WebAuthApiSession>;
  refresh: (input?: RefreshInput) => Promise<WebAuthApiSession>;
  logout: (refreshToken?: string) => Promise<void>;
  upgradeSession: (input: UpgradeSessionInput) => Promise<WebAuthApiSession>;
}>;

export const createWebAuthHttpClient = (): WebAuthHttpClient | null => {
  if (!AUTH_BASE_URL) {
    return null;
  }

  return {
    login: async (input) => {
      return await postJson<WebAuthApiSession>('/api/auth/login', input);
    },
    register: async (input) => {
      return await postJson<WebAuthApiSession>('/api/auth/register', input);
    },
    refresh: async (input = {}) => {
      return await postJson<WebAuthApiSession>('/api/auth/refresh', input);
    },
    logout: async (refreshToken) => {
      await postJson<void>('/api/auth/logout', refreshToken ? { refreshToken } : {});
    },
    upgradeSession: async (input) => {
      return await postJson<WebAuthApiSession>('/api/auth/upgrade-session', input);
    },
  };
};
