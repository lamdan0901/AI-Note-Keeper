export type ApiErrorPayload = Readonly<{
  code?: string;
  message?: string;
  status?: number;
  details?: Readonly<Record<string, unknown>>;
}>;

export type TokenProvider = () => Promise<string | null | undefined> | string | null | undefined;

export type RefreshAccessToken = () => Promise<string | null | undefined>;

export type HttpRequestOptions = Readonly<{
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
  retryOnUnauthorized?: boolean;
}>;

export type MobileApiClient = Readonly<{
  requestJson: <T>(path: string, options?: HttpRequestOptions) => Promise<T>;
}>;
