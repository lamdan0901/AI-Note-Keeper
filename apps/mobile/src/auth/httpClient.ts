export type MobileAuthApiSession = Readonly<{
  userId: string;
  username: string;
  accessToken: string;
  refreshToken?: string;
}>;

type AuthCredentials = Readonly<{
  username: string;
  password: string;
  deviceId?: string;
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

const AUTH_API_URL = process.env.EXPO_PUBLIC_AUTH_API_URL;

const normalizeBaseUrl = (baseUrl: string): string => {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
};

const parseErrorMessage = async (response: Response): Promise<string> => {
  const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;

  if (payload && typeof payload.message === 'string') {
    return payload.message;
  }

  return `Auth request failed (${response.status})`;
};

const postJson = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
  if (!AUTH_API_URL) {
    throw new Error('EXPO_PUBLIC_AUTH_API_URL is required for mobile auth API client');
  }

  const response = await fetch(`${normalizeBaseUrl(AUTH_API_URL)}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-client-platform': 'mobile',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

export type MobileAuthHttpClient = Readonly<{
  login: (input: AuthCredentials) => Promise<MobileAuthApiSession>;
  register: (input: AuthCredentials) => Promise<MobileAuthApiSession>;
  refresh: (input: RefreshInput) => Promise<MobileAuthApiSession>;
  logout: (refreshToken?: string) => Promise<void>;
  upgradeSession: (input: UpgradeSessionInput) => Promise<MobileAuthApiSession>;
}>;

export const createMobileAuthHttpClient = (): MobileAuthHttpClient | null => {
  if (!AUTH_API_URL) {
    return null;
  }

  return {
    login: async (input) => {
      return await postJson<MobileAuthApiSession>('/api/auth/login', input);
    },
    register: async (input) => {
      return await postJson<MobileAuthApiSession>('/api/auth/register', input);
    },
    refresh: async (input) => {
      return await postJson<MobileAuthApiSession>('/api/auth/refresh', input);
    },
    logout: async (refreshToken) => {
      await postJson<void>('/api/auth/logout', refreshToken ? { refreshToken } : {});
    },
    upgradeSession: async (input) => {
      return await postJson<MobileAuthApiSession>('/api/auth/upgrade-session', input);
    },
  };
};
