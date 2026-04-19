import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebApiClient, WebApiError } from '../src/api/httpClient';

describe('web api http client', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('attaches bearer access token when available', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const client = createWebApiClient({
      getAccessToken: () => 'access-token-1',
      refreshAccessToken: async () => null,
    });

    await client.requestJson('/api/notes');

    const call = fetchSpy.mock.calls[0];
    expect(call).toBeDefined();
    const requestInit = call?.[1] as RequestInit;
    expect(requestInit.credentials).toBe('include');
    expect((requestInit.headers as Record<string, string>).authorization).toBe(
      'Bearer access-token-1',
    );
  });

  it('retries exactly once after refresh on 401', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

    let accessToken = 'expired-token';
    const refreshSpy = vi.fn(async () => {
      accessToken = 'fresh-token';
      return accessToken;
    });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'auth', message: 'Invalid access token' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ notes: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const client = createWebApiClient({
      getAccessToken: () => accessToken,
      refreshAccessToken: refreshSpy,
    });

    await expect(client.requestJson('/api/notes')).resolves.toEqual({ notes: [] });

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondCallHeaders = (fetchSpy.mock.calls[1]?.[1]?.headers ?? {}) as Record<
      string,
      string
    >;
    expect(secondCallHeaders.authorization).toBe('Bearer fresh-token');
  });

  it('throws auth error after repeated 401 and does not loop', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

    const refreshSpy = vi.fn(async () => 'still-invalid');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'auth', message: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'auth', message: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const client = createWebApiClient({
      getAccessToken: () => 'expired-token',
      refreshAccessToken: refreshSpy,
    });

    await expect(client.requestJson('/api/notes')).rejects.toEqual(
      expect.objectContaining<WebApiError>({
        status: 401,
      }),
    );

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
