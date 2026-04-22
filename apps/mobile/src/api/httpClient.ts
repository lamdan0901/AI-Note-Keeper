import type {
  ApiErrorPayload,
  HttpRequestOptions,
  MobileApiClient,
  RefreshAccessToken,
  TokenProvider,
} from './contracts';
import { createMobileAuthHttpClient } from '../auth/httpClient';
import {
  getOrCreateDeviceId,
  loadAuthSession,
  resolveCurrentUserId,
  saveAuthSession,
} from '../auth/session';

const readApiBaseUrl = (): string | undefined => {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? process.env.EXPO_PUBLIC_AUTH_API_URL;
};

const normalizeBaseUrl = (baseUrl: string): string => {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
};

const toApiUrl = (path: string): string => {
  const baseUrl = normalizeBaseUrl(readApiBaseUrl() ?? '');
  if (!baseUrl) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL is required for mobile API transport');
  }

  if (path.startsWith('/')) {
    return `${baseUrl}${path}`;
  }

  return `${baseUrl}/${path}`;
};

const parseResponsePayload = async (response: Response): Promise<unknown> => {
  if (response.status === 204) {
    return undefined;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return undefined;
  }

  return await response.json().catch(() => undefined);
};

const toErrorMessage = (status: number, payload: ApiErrorPayload | null): string => {
  if (payload?.message && typeof payload.message === 'string') {
    return payload.message;
  }

  return `Request failed (${status})`;
};

export class MobileApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: Readonly<Record<string, unknown>>;

  public constructor(
    message: string,
    input: Readonly<{ status: number; code?: string; details?: Readonly<Record<string, unknown>> }>,
  ) {
    super(message);
    this.name = 'MobileApiError';
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
  }
}

type ClientInput = Readonly<{
  getAccessToken: TokenProvider;
  refreshAccessToken: RefreshAccessToken;
  getGuestUserId?: () => Promise<string | null>;
  onUnauthorized?: () => void;
}>;

const buildHeaders = (
  headers: Readonly<Record<string, string>>,
  accessToken: string | null | undefined,
  guestUserId: string | null | undefined,
  hasBody: boolean,
): Record<string, string> => {
  const nextHeaders: Record<string, string> = {
    'x-client-platform': 'mobile',
    ...headers,
  };

  if (hasBody && !nextHeaders['content-type']) {
    nextHeaders['content-type'] = 'application/json';
  }

  if (accessToken) {
    nextHeaders.authorization = `Bearer ${accessToken}`;
  }

  if (!accessToken && guestUserId) {
    nextHeaders['x-guest-user-id'] = guestUserId;
  }

  return nextHeaders;
};

const executeRequest = async <T>(
  input: Readonly<{
    path: string;
    options: HttpRequestOptions;
    getAccessToken: TokenProvider;
    refreshAccessToken: RefreshAccessToken;
    getGuestUserId?: () => Promise<string | null>;
    onUnauthorized?: () => void;
    hasRetried: boolean;
  }>,
): Promise<T> => {
  const method = input.options.method ?? 'GET';
  const hasBody = input.options.body !== undefined;
  const accessToken = await input.getAccessToken();
  const guestUserId =
    accessToken || !input.getGuestUserId ? null : await input.getGuestUserId();

  const response = await fetch(toApiUrl(input.path), {
    method,
    headers: buildHeaders(input.options.headers ?? {}, accessToken, guestUserId, hasBody),
    body: hasBody ? JSON.stringify(input.options.body) : undefined,
  });

  if (response.status === 401 && input.options.retryOnUnauthorized !== false && !input.hasRetried) {
    try {
      const refreshedAccessToken = await input.refreshAccessToken();
      if (refreshedAccessToken) {
        return await executeRequest<T>({
          ...input,
          hasRetried: true,
        });
      }
    } catch {
      // Fall through to auth-required error handling.
    }

    if (input.onUnauthorized) {
      input.onUnauthorized();
    }

    throw new MobileApiError('Authentication required', {
      status: 401,
      code: 'auth',
    });
  }

  const payload = (await parseResponsePayload(response)) as ApiErrorPayload | unknown;

  if (!response.ok) {
    const errorPayload = (
      payload && typeof payload === 'object' ? payload : null
    ) as ApiErrorPayload | null;

    throw new MobileApiError(toErrorMessage(response.status, errorPayload), {
      status: response.status,
      code: errorPayload?.code,
      details: errorPayload?.details,
    });
  }

  return payload as T;
};

export const createMobileApiClient = (input: ClientInput): MobileApiClient => {
  return {
    requestJson: async <T>(path: string, options: HttpRequestOptions = {}): Promise<T> => {
      return await executeRequest<T>({
        path,
        options,
        getAccessToken: input.getAccessToken,
        refreshAccessToken: input.refreshAccessToken,
        getGuestUserId: input.getGuestUserId,
        onUnauthorized: input.onUnauthorized,
        hasRetried: false,
      });
    },
  };
};

export const createDefaultMobileApiClient = (): MobileApiClient => {
  const authClient = createMobileAuthHttpClient();

  return createMobileApiClient({
    getAccessToken: async () => {
      const session = await loadAuthSession();
      return session?.accessToken ?? null;
    },
    getGuestUserId: async () => {
      const session = await loadAuthSession();
      if (session) {
        return null;
      }

      return await resolveCurrentUserId();
    },
    refreshAccessToken: async () => {
      if (!authClient) {
        return null;
      }

      const currentSession = await loadAuthSession();
      if (!currentSession?.refreshToken) {
        return null;
      }

      try {
        const refreshed = await authClient.refresh({
          refreshToken: currentSession.refreshToken,
          deviceId: await getOrCreateDeviceId(),
        });

        await saveAuthSession({
          userId: refreshed.userId,
          username: refreshed.username,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
        });

        return refreshed.accessToken;
      } catch {
        return null;
      }
    },
  });
};
