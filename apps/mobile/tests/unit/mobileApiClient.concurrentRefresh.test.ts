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

describe('mobile api client concurrent refresh', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://localhost:3000';
    process.env.EXPO_PUBLIC_AUTH_API_URL = 'http://localhost:3000';
    loadAuthSessionMock.mockResolvedValue(storedSession as never);
  });

  it('shares one in-flight refresh across two clients racing after the access token expires', async () => {
    // Simulate cross-module usage: two independent flows (e.g. sync queue and a
    // push-triggered reminder fetch) each build their own client instance, the
    // way syncQueueProcessor.ts and fetchReminder.ts do in production.
    let refreshResolve: (value: unknown) => void = () => {};
    refreshMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          refreshResolve = resolve;
        }),
    );

    let fetchCall = 0;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fetchCall += 1;
      if (fetchCall <= 2) {
        return new Response(JSON.stringify({ message: 'expired' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const { createDefaultMobileApiClient } = await import('../../src/api/httpClient');
    const clientA = createDefaultMobileApiClient();
    const clientB = createDefaultMobileApiClient();

    const requestA = clientA.requestJson('/api/notes');
    const requestB = clientB.requestJson('/api/reminders/r1');

    // Let both requests reach the 401 -> refresh call before resolving refresh.
    // A real macrotask boundary drains any number of pending microtask hops,
    // unlike a fixed count of `await Promise.resolve()`.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refreshMock).toHaveBeenCalledTimes(1);

    refreshResolve({
      userId: 'account-user-1',
      username: 'alice',
      accessToken: 'fresh-access-token',
      refreshToken: 'fresh-refresh-token',
    });

    await Promise.all([requestA, requestB]);

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(saveAuthSessionMock).toHaveBeenCalledTimes(1);

    fetchMock.mockRestore();
  });
});
