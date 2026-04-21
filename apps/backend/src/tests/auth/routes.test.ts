import assert from 'node:assert/strict';
import type { Server } from 'node:net';
import test from 'node:test';

import type { AuthService } from '../../auth/service.js';
import { AppError } from '../../middleware/error-middleware.js';
import { createApiServer } from '../../runtime/createApiServer.js';

const createAuthServiceDouble = () => {
  const calls: Array<Readonly<{ method: string; args: Record<string, unknown> }>> = [];

  const authService: AuthService = {
    register: async (input) => {
      calls.push({ method: 'register', args: input as Record<string, unknown> });
      return {
        userId: 'u-register',
        username: input.username,
        tokens: {
          accessToken: 'access-register',
          refreshToken: 'refresh-register',
          accessExpiresAt: Date.now() + 60_000,
          refreshExpiresAt: Date.now() + 120_000,
        },
      };
    },
    login: async (input) => {
      calls.push({ method: 'login', args: input as Record<string, unknown> });
      return {
        userId: 'u-login',
        username: input.username,
        tokens: {
          accessToken: 'access-login',
          refreshToken: 'refresh-login',
          accessExpiresAt: Date.now() + 60_000,
          refreshExpiresAt: Date.now() + 120_000,
        },
      };
    },
    upgradeSession: async (input) => {
      calls.push({ method: 'upgradeSession', args: input as Record<string, unknown> });
      return {
        userId: input.userId,
        username: 'legacy-user',
        tokens: {
          accessToken: 'access-upgrade',
          refreshToken: 'refresh-upgrade',
          accessExpiresAt: Date.now() + 60_000,
          refreshExpiresAt: Date.now() + 120_000,
        },
      };
    },
    refresh: async (input) => {
      calls.push({ method: 'refresh', args: input as Record<string, unknown> });
      return {
        userId: 'u-refresh',
        username: 'alice',
        tokens: {
          accessToken: 'access-refresh',
          refreshToken: 'refresh-refresh',
          accessExpiresAt: Date.now() + 60_000,
          refreshExpiresAt: Date.now() + 120_000,
        },
      };
    },
    logout: async (input) => {
      calls.push({ method: 'logout', args: input as Record<string, unknown> });
    },
  };

  return {
    authService,
    calls,
  };
};

const startServer = async (
  authService: AuthService,
): Promise<Readonly<{ baseUrl: string; close: () => Promise<void> }>> => {
  const app = createApiServer({
    authService,
    isDependencyDegraded: () => false,
    readinessProbe: async () => ({
      ok: true,
      service: 'backend',
      checks: {
        database: 'up',
        migrations: 'up',
      },
    }),
  });

  const server = await new Promise<Server>((resolve, reject) => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
    running.once('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected address info from test server');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
};

test('web transport sets httpOnly cookie session artifacts on auth success', async () => {
  const { authService } = createAuthServiceDouble();
  const server = await startServer(authService);

  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-platform': 'web',
      },
      body: JSON.stringify({ username: 'alice', password: 'password-123' }),
    });

    const payload = (await response.json()) as Record<string, unknown>;
    const cookie = response.headers.get('set-cookie') ?? '';

    assert.equal(response.status, 200);
    assert.equal(payload.transport, 'cookie');
    assert.equal('refreshToken' in payload, false);
    assert.match(cookie, /ank_refresh_token=refresh-login/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  } finally {
    await server.close();
  }
});

test('production web transport sets SameSite=None secure refresh cookie', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  const { authService } = createAuthServiceDouble();
  const server = await startServer(authService);

  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://app.example.com',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({ username: 'alice', password: 'password-123' }),
    });

    const payload = (await response.json()) as Record<string, unknown>;
    const cookie = response.headers.get('set-cookie') ?? '';

    assert.equal(response.status, 200);
    assert.equal(payload.transport, 'cookie');
    assert.match(cookie, /SameSite=None/i);
    assert.match(cookie, /Secure/i);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    await server.close();
  }
});

test('mobile transport returns token payload for secure storage flows', async () => {
  const { authService } = createAuthServiceDouble();
  const server = await startServer(authService);

  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-platform': 'mobile',
      },
      body: JSON.stringify({
        username: 'alice',
        password: 'password-123',
        deviceId: 'device-1',
      }),
    });

    const payload = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(payload.transport, 'json');
    assert.equal(payload.refreshToken, 'refresh-login');
  } finally {
    await server.close();
  }
});

test('logout and refresh failures produce stable auth error contract payloads', async () => {
  const { authService } = createAuthServiceDouble();
  const server = await startServer(authService);

  try {
    const refreshResponse = await fetch(`${server.baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const refreshPayload = (await refreshResponse.json()) as Record<string, unknown>;
    assert.equal(refreshResponse.status, 401);
    assert.deepStrictEqual(refreshPayload, {
      code: 'auth',
      message: 'Refresh token is required',
      status: 401,
    });

    const logoutResponse = await fetch(`${server.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const logoutPayload = (await logoutResponse.json()) as Record<string, unknown>;
    assert.equal(logoutResponse.status, 401);
    assert.deepStrictEqual(logoutPayload, {
      code: 'auth',
      message: 'Refresh token is required',
      status: 401,
    });
  } finally {
    await server.close();
  }
});

test('upgrade-session endpoint exchanges legacy user id to JWT-compatible session response', async () => {
  const { authService, calls } = createAuthServiceDouble();
  const server = await startServer(authService);

  try {
    const response = await fetch(`${server.baseUrl}/api/auth/upgrade-session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-platform': 'mobile',
      },
      body: JSON.stringify({
        userId: 'legacy-user-id',
        legacySessionToken: 'legacy-token-proof',
        deviceId: 'device-1',
      }),
    });

    const payload = (await response.json()) as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.equal(payload.userId, 'legacy-user-id');
    assert.equal(payload.transport, 'json');
    assert.equal(payload.refreshToken, 'refresh-upgrade');

    const upgradeCall = calls.find((entry) => entry.method === 'upgradeSession');
    assert.deepStrictEqual(upgradeCall?.args, {
      userId: 'legacy-user-id',
      legacySessionToken: 'legacy-token-proof',
      deviceId: 'device-1',
    });
  } finally {
    await server.close();
  }
});

test('upgrade-session rejects tokenless legacy upgrade requests by default', async () => {
  const authService: AuthService = {
    register: async () => {
      throw new Error('Not used in this test');
    },
    login: async () => {
      throw new Error('Not used in this test');
    },
    refresh: async () => {
      throw new Error('Not used in this test');
    },
    logout: async () => {
      throw new Error('Not used in this test');
    },
    upgradeSession: async (input) => {
      if (!input.legacySessionToken) {
        throw new AppError({
          code: 'auth',
          message: 'Legacy session token is required for upgrade-session',
        });
      }

      return {
        userId: input.userId,
        username: 'legacy-user',
        tokens: {
          accessToken: 'access-upgrade',
          refreshToken: 'refresh-upgrade',
          accessExpiresAt: Date.now() + 60_000,
          refreshExpiresAt: Date.now() + 120_000,
        },
      };
    },
  };

  const server = await startServer(authService);

  try {
    const response = await fetch(`${server.baseUrl}/api/auth/upgrade-session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-platform': 'mobile',
      },
      body: JSON.stringify({
        userId: 'legacy-user-id',
        deviceId: 'device-1',
      }),
    });

    const payload = (await response.json()) as Record<string, unknown>;
    assert.equal(response.status, 401);
    assert.deepStrictEqual(payload, {
      code: 'auth',
      message: 'Legacy session token is required for upgrade-session',
      status: 401,
    });
  } finally {
    await server.close();
  }
});

test('register forwards guestUserId for guest-to-account data sync', async () => {
  const { authService, calls } = createAuthServiceDouble();
  const server = await startServer(authService);

  try {
    const response = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-platform': 'mobile',
      },
      body: JSON.stringify({
        username: 'alice',
        password: 'password-123',
        deviceId: 'device-1',
        guestUserId: 'web-guest-123e4567-e89b-12d3-a456-426614174000',
      }),
    });

    assert.equal(response.status, 201);

    const registerCall = calls.find((entry) => entry.method === 'register');
    assert.deepStrictEqual(registerCall?.args, {
      username: 'alice',
      password: 'password-123',
      deviceId: 'device-1',
      guestUserId: 'web-guest-123e4567-e89b-12d3-a456-426614174000',
    });
  } finally {
    await server.close();
  }
});
