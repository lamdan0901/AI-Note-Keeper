import type {
  ApiErrorPayload,
  HttpRequestOptions,
  RefreshAccessToken,
  TokenProvider,
  WebApiClient,
} from './contracts';

const WEB_LOCAL_USER_KEY = 'web-local-user-id';

const inFlightGetRequests = new Map<string, Promise<unknown>>();

const normalizeBaseUrl = (baseUrl: string): string => {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
};

const getBaseUrl = (): string => {
  return normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL ?? '');
};

const toApiUrl = (path: string): string => {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    throw new Error('VITE_API_BASE_URL is required for web API transport');
  }

  if (path.startsWith('/')) {
    return `${baseUrl}${path}`;
  }

  return `${baseUrl}/${path}`;
};

const readGuestUserId = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const value = window.localStorage.getItem(WEB_LOCAL_USER_KEY);
    if (!value || value.length === 0) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
};

const toErrorMessage = (status: number, payload: ApiErrorPayload | null): string => {
  if (payload && typeof payload.message === 'string' && payload.message.length > 0) {
    return payload.message;
  }

  return `Request failed (${status})`;
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

export class WebApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: Readonly<Record<string, unknown>>;

  public constructor(
    message: string,
    input: Readonly<{ status: number; code?: string; details?: Readonly<Record<string, unknown>> }>,
  ) {
    super(message);
    this.name = 'WebApiError';
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
  }
}

type ClientInput = Readonly<{
  getAccessToken: TokenProvider;
  refreshAccessToken: RefreshAccessToken;
  onUnauthorized?: () => void;
}>;

const buildHeaders = (
  headers: Readonly<Record<string, string>>,
  accessToken: string | null | undefined,
  hasBody: boolean,
): Record<string, string> => {
  const nextHeaders: Record<string, string> = {
    'x-client-platform': 'web',
    ...headers,
  };

  if (hasBody && !nextHeaders['content-type']) {
    nextHeaders['content-type'] = 'application/json';
  }

  if (accessToken) {
    nextHeaders.authorization = `Bearer ${accessToken}`;
  } else {
    const guestUserId = readGuestUserId();
    if (guestUserId && !nextHeaders['x-guest-user-id']) {
      nextHeaders['x-guest-user-id'] = guestUserId;
    }
  }

  return nextHeaders;
};

const executeRequestInternal = async <T>(
  input: Readonly<{
    path: string;
    options: HttpRequestOptions;
    getAccessToken: TokenProvider;
    refreshAccessToken: RefreshAccessToken;
    onUnauthorized?: () => void;
    hasRetried: boolean;
  }>,
): Promise<T> => {
  const method = input.options.method ?? 'GET';
  const hasBody = input.options.body !== undefined;
  const accessToken = input.getAccessToken();

  const response = await fetch(toApiUrl(input.path), {
    method,
    credentials: 'include',
    headers: buildHeaders(input.options.headers ?? {}, accessToken, hasBody),
    body: hasBody ? JSON.stringify(input.options.body) : undefined,
  });

  if (response.status === 401 && input.options.retryOnUnauthorized !== false && !input.hasRetried) {
    try {
      const refreshedAccessToken = await input.refreshAccessToken();
      if (refreshedAccessToken) {
        return await executeRequestInternal<T>({
          ...input,
          hasRetried: true,
        });
      }
    } catch {
      // Fall through to auth-required error below.
    }

    if (input.onUnauthorized) {
      input.onUnauthorized();
    }

    throw new WebApiError('Authentication required', {
      status: 401,
      code: 'auth',
    });
  }

  const payload = (await parseResponsePayload(response)) as ApiErrorPayload | unknown;

  if (!response.ok) {
    const errorPayload = (
      payload && typeof payload === 'object' ? payload : null
    ) as ApiErrorPayload | null;

    throw new WebApiError(toErrorMessage(response.status, errorPayload), {
      status: response.status,
      code: errorPayload?.code,
      details: errorPayload?.details,
    });
  }

  return payload as T;
};

const shouldCoalesceGetRequest = (method: string, hasBody: boolean): boolean => {
  return method.toUpperCase() === 'GET' && !hasBody;
};

const toRequestDedupeKey = (
  path: string,
  method: string,
  accessToken: string | null | undefined,
): string => {
  const guestUserId = readGuestUserId();
  const principal = accessToken ?? `guest:${guestUserId ?? 'none'}`;
  return `${method.toUpperCase()}::${toApiUrl(path)}::${principal}`;
};

const executeRequest = async <T>(
  input: Readonly<{
    path: string;
    options: HttpRequestOptions;
    getAccessToken: TokenProvider;
    refreshAccessToken: RefreshAccessToken;
    onUnauthorized?: () => void;
    hasRetried: boolean;
  }>,
): Promise<T> => {
  const method = input.options.method ?? 'GET';
  const hasBody = input.options.body !== undefined;

  if (!shouldCoalesceGetRequest(method, hasBody)) {
    return await executeRequestInternal<T>(input);
  }

  const dedupeKey = toRequestDedupeKey(input.path, method, input.getAccessToken());
  const inFlightRequest = inFlightGetRequests.get(dedupeKey);

  if (inFlightRequest) {
    return (await inFlightRequest) as T;
  }

  const requestPromise = executeRequestInternal<T>(input).finally(() => {
    inFlightGetRequests.delete(dedupeKey);
  });

  inFlightGetRequests.set(dedupeKey, requestPromise as Promise<unknown>);
  return await requestPromise;
};

export const createWebApiClient = (input: ClientInput): WebApiClient => {
  return {
    requestJson: async <T>(path: string, options: HttpRequestOptions = {}): Promise<T> => {
      return await executeRequest<T>({
        path,
        options,
        getAccessToken: input.getAccessToken,
        refreshAccessToken: input.refreshAccessToken,
        onUnauthorized: input.onUnauthorized,
        hasRetried: false,
      });
    },
  };
};
