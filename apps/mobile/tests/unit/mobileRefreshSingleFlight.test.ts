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

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const respond401 = () =>
  new Response(JSON.stringify({ message: 'expired' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

const respond200 = () =>
  new Response(JSON.stringify({ notes: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('mobile refresh single flight', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://localhost:3000';
    process.env.EXPO_PUBLIC_AUTH_API_URL = 'http://localhost:3000';
    loadAuthSessionMock.mockResolvedValue(storedSession as never);
  });

  it('shares one in-flight refresh between the auth bootstrap and an API 401 retry', async () => {
    let resolveRefresh: (value: unknown) => void = () => {};
    refreshMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(respond401())
      .mockResolvedValueOnce(respond200());

    const { createDefaultMobileApiClient, refreshMobileSession } = await import(
      '../../src/api/httpClient'
    );

    const apiCall = createDefaultMobileApiClient().requestJson('/api/notes');
    await flush();
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // The bootstrap path must join the in-flight refresh instead of replaying
    // the same single-use refresh token.
    const bootstrap = refreshMobileSession();
    expect(refreshMock).toHaveBeenCalledTimes(1);

    resolveRefresh({
      userId: 'account-user-1',
      username: 'alice',
      accessToken: 'fresh-access-token',
      refreshToken: 'refresh-token-2',
    });

    await expect(bootstrap).resolves.toEqual({
      userId: 'account-user-1',
      username: 'alice',
      accessToken: 'fresh-access-token',
      refreshToken: 'refresh-token-2',
    });
    await expect(apiCall).resolves.toEqual({ notes: [] });
    expect(clearAuthSessionMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it('keeps the session when a 401 refresh loses a race to another refresh', async () => {
    const { MobileAuthApiError } = await import('../../src/auth/httpClient');
    refreshMock.mockRejectedValue(new MobileAuthApiError('replay detected', 401) as never);

    // The stored refresh token was rotated by another flow while this refresh
    // was in flight, so the 401 is stale rather than a dead session.
    loadAuthSessionMock
      .mockResolvedValueOnce(storedSession as never)
      .mockResolvedValue({ ...storedSession, refreshToken: 'refresh-token-2' } as never);

    const { onSessionExpired } = await import('../../src/auth/sessionExpired');
    const expiredListener = jest.fn();
    onSessionExpired(expiredListener);

    const { refreshMobileSession } = await import('../../src/api/httpClient');

    await expect(refreshMobileSession()).resolves.toBeNull();

    expect(clearAuthSessionMock).not.toHaveBeenCalled();
    expect(expiredListener).not.toHaveBeenCalled();
  });
});
