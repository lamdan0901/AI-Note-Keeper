import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const loadAuthSessionMock = jest.fn();
const saveAuthSessionMock = jest.fn(async () => undefined);
const clearAuthSessionMock = jest.fn(async () => undefined);
const getOrCreateDeviceIdMock = jest.fn(async () => 'device-1');
const resolveCurrentUserIdMock = jest.fn(async () => 'device-1');
const isLogoutTransitionActiveMock = jest.fn(() => false);
const refreshMock = jest.fn();

jest.mock('../../src/auth/session', () => ({
  getOrCreateDeviceId: getOrCreateDeviceIdMock,
  loadAuthSession: loadAuthSessionMock,
  resolveCurrentUserId: resolveCurrentUserIdMock,
  saveAuthSession: saveAuthSessionMock,
  clearAuthSession: clearAuthSessionMock,
}));

jest.mock('../../src/auth/logoutState', () => ({
  isLogoutTransitionActive: isLogoutTransitionActiveMock,
}));

jest.mock('../../src/auth/httpClient', () => {
  const actual = jest.requireActual('../../src/auth/httpClient') as Record<string, unknown>;
  return {
    ...actual,
    createMobileAuthHttpClient: () => ({
      refresh: refreshMock,
    }),
  };
});

const storedSession = {
  userId: 'account-user-1',
  username: 'alice',
  accessToken: 'stale-access-token',
  refreshToken: 'refresh-token-1',
};

const respond401 = () =>
  new Response(JSON.stringify({ message: 'expired' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

describe('mobile api client session expiry', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://localhost:3000';
    process.env.EXPO_PUBLIC_AUTH_API_URL = 'http://localhost:3000';
    loadAuthSessionMock.mockResolvedValue(storedSession as never);
  });

  it('clears session and notifies listeners when refresh is rejected as unauthorized', async () => {
    const { MobileAuthApiError } = await import('../../src/auth/httpClient');
    refreshMock.mockRejectedValue(new MobileAuthApiError('expired', 401) as never);

    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(respond401());

    const { onSessionExpired } = await import('../../src/auth/sessionExpired');
    const expiredListener = jest.fn();
    onSessionExpired(expiredListener);

    const { createDefaultMobileApiClient, MobileApiError } = await import(
      '../../src/api/httpClient'
    );
    const client = createDefaultMobileApiClient();

    await expect(client.requestJson('/api/notes')).rejects.toBeInstanceOf(MobileApiError);

    expect(clearAuthSessionMock).toHaveBeenCalledTimes(1);
    expect(expiredListener).toHaveBeenCalledTimes(1);

    fetchMock.mockRestore();
  });

  it('keeps session when refresh fails with a network error', async () => {
    refreshMock.mockRejectedValue(new TypeError('Network request failed') as never);

    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(respond401());

    const { onSessionExpired } = await import('../../src/auth/sessionExpired');
    const expiredListener = jest.fn();
    onSessionExpired(expiredListener);

    const { createDefaultMobileApiClient, MobileApiError } = await import(
      '../../src/api/httpClient'
    );
    const client = createDefaultMobileApiClient();

    await expect(client.requestJson('/api/notes')).rejects.toBeInstanceOf(MobileApiError);

    expect(clearAuthSessionMock).not.toHaveBeenCalled();
    expect(expiredListener).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });
});
