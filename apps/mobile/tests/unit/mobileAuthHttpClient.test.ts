import { beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('mobile auth http client', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.EXPO_PUBLIC_AUTH_API_URL;
  });

  it('returns null when EXPO_PUBLIC_AUTH_API_URL is missing', async () => {
    const module = await import('../../src/auth/httpClient');

    expect(module.createMobileAuthHttpClient()).toBeNull();
  });

  it('calls auth endpoints with expected payload and headers', async () => {
    process.env.EXPO_PUBLIC_AUTH_API_URL = 'http://localhost:3000/';

    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          userId: 'user-1',
          username: 'alice',
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    });

    const module = await import('../../src/auth/httpClient');
    const client = module.createMobileAuthHttpClient();
    if (!client) {
      throw new Error('Expected auth client');
    }

    await client.login({ username: 'alice', password: 'secret', deviceId: 'device-1' });
    await client.refresh({ refreshToken: 'refresh-1', deviceId: 'device-1' });
    await client.logout('refresh-1');
    await client.upgradeSession({
      userId: 'legacy-user',
      legacySessionToken: 'legacy',
      deviceId: 'device-1',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3000/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-client-platform': 'mobile',
        }),
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3000/api/auth/refresh',
      expect.objectContaining({
        method: 'POST',
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:3000/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'http://localhost:3000/api/auth/upgrade-session',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('throws normalized API error message for failed auth responses', async () => {
    process.env.EXPO_PUBLIC_AUTH_API_URL = 'http://localhost:3000';

    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'invalid_credentials',
        }),
        {
          status: 401,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );

    const module = await import('../../src/auth/httpClient');
    const client = module.createMobileAuthHttpClient();
    if (!client) {
      throw new Error('Expected auth client');
    }

    await expect(client.login({ username: 'alice', password: 'bad' })).rejects.toThrow(
      'invalid_credentials',
    );
  });
});
