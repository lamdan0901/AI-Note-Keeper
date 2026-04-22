import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const loadAuthSessionMock = jest.fn();
const saveAuthSessionMock = jest.fn(async () => undefined);
const getOrCreateDeviceIdMock = jest.fn(async () => 'device-1');
const resolveCurrentUserIdMock = jest.fn(async () => 'device-1');
const isLogoutTransitionActiveMock = jest.fn(() => false);
const refreshMock = jest.fn();

jest.mock('../../src/auth/session', () => ({
  getOrCreateDeviceId: getOrCreateDeviceIdMock,
  loadAuthSession: loadAuthSessionMock,
  resolveCurrentUserId: resolveCurrentUserIdMock,
  saveAuthSession: saveAuthSessionMock,
}));

jest.mock('../../src/auth/logoutState', () => ({
  isLogoutTransitionActive: isLogoutTransitionActiveMock,
}));

jest.mock('../../src/auth/httpClient', () => ({
  createMobileAuthHttpClient: () => ({
    refresh: refreshMock,
  }),
}));

describe('default mobile api client logout race', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://localhost:3000';
    process.env.EXPO_PUBLIC_AUTH_API_URL = 'http://localhost:3000';
  });

  it('does not persist a refreshed auth session after logout starts', async () => {
    let logoutActive = false;
    isLogoutTransitionActiveMock.mockImplementation(() => logoutActive);

    (loadAuthSessionMock as any)
      .mockResolvedValueOnce({
        userId: 'account-user-1',
        username: 'alice',
        accessToken: 'stale-access-token',
        refreshToken: 'refresh-token-1',
      })
      .mockResolvedValueOnce({
        userId: 'account-user-1',
        username: 'alice',
        accessToken: 'stale-access-token',
        refreshToken: 'refresh-token-1',
      })
      .mockResolvedValueOnce(null);

    (refreshMock as any).mockImplementation(async () => {
      logoutActive = true;
      return {
        userId: 'account-user-1',
        username: 'alice',
        accessToken: 'fresh-access-token',
        refreshToken: 'fresh-refresh-token',
      };
    });

    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: 'expired',
          }),
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const { createDefaultMobileApiClient, MobileApiError } = await import('../../src/api/httpClient');
    const client = createDefaultMobileApiClient();

    await expect(client.requestJson('/api/notes')).rejects.toBeInstanceOf(MobileApiError);
    expect(refreshMock).toHaveBeenCalledWith({
      refreshToken: 'refresh-token-1',
      deviceId: 'device-1',
    });
    expect(saveAuthSessionMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockRestore();
  });
});
