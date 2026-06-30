import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, before, afterEach, test } from "node:test";

import {
  attachSoftPoolErrorHandling,
  resetPoolErrorStateForTests,
  type PoolErrorEventTarget,
} from "../src/db/pool";
import { AppError } from "@backend/middleware/error-middleware";
import type { AuthService } from "@backend/auth/service";

import { resetAuthServiceForTests, setAuthServiceForTests } from "../src/server/auth-service";
import { createAuthServiceDouble } from "./support/auth-service-double";
import { startAuthTestServer, type AuthTestServer } from "./support/auth-test-server";

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  return (await response.json()) as Record<string, unknown>;
};

const createMockPool = (): PoolErrorEventTarget & Readonly<{ emit: (error: Error) => void }> => {
  const emitter = new EventEmitter();

  return {
    removeAllListeners: (event?: string | symbol) => emitter.removeAllListeners(event),
    on: (event: "error", listener: (error: Error) => void) => emitter.on(event, listener),
    emit: (error: Error) => {
      emitter.emit("error", error);
    },
  };
};

const registerBody = {
  username: "alice",
  password: "password-123",
} as const;

let server: AuthTestServer;
let sharedAuthService: AuthService;

before(async () => {
  const { authService } = createAuthServiceDouble();
  sharedAuthService = authService;
  server = await startAuthTestServer(authService);
});

after(async () => {
  await server.close();
  resetAuthServiceForTests();
});

afterEach(() => {
  resetPoolErrorStateForTests();
});

test("POST /api/auth/register returns 429 rate_limit when limit exceeded", async () => {
  const { authService } = createAuthServiceDouble();
  const isolatedServer = await startAuthTestServer(authService);

  try {
    const headers = {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.55",
      "x-client-platform": "mobile",
    };

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await isolatedServer.fetch("/api/auth/register", {
        method: "POST",
        headers,
        body: JSON.stringify(registerBody),
      });
      assert.equal(response.status, 201);
    }

    const limitedResponse = await isolatedServer.fetch("/api/auth/register", {
      method: "POST",
      headers,
      body: JSON.stringify(registerBody),
    });
    const payload = await readJson(limitedResponse);

    assert.equal(limitedResponse.status, 429);
    assert.equal(payload.code, "rate_limit");
    assert.equal(typeof payload.details, "object");
  } finally {
    await isolatedServer.close();
    setAuthServiceForTests(sharedAuthService);
  }
});

test("POST /api/auth/register returns 201 with auth response body", async () => {
  const response = await server.fetch("/api/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-client-platform": "mobile",
    },
    body: JSON.stringify(registerBody),
  });

  const payload = await readJson(response);

  assert.equal(response.status, 201);
  assert.equal(payload.userId, "u-register");
  assert.equal(payload.username, "alice");
  assert.equal(payload.accessToken, "access-register");
  assert.equal(payload.refreshToken, "refresh-register");
  assert.equal(payload.transport, "json");
});

test("POST /api/auth/register returns 400 validation error for invalid body", async () => {
  const response = await server.fetch("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ab", password: "short" }),
  });

  const payload = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(payload.code, "validation");
});

test("POST /api/auth/register returns 500 internal when dependencies are degraded", async () => {
  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);
  mockPool.emit(new Error("idle client connection lost"));

  const response = await server.fetch("/api/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-client-platform": "mobile",
    },
    body: JSON.stringify(registerBody),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 500);
  assert.deepStrictEqual(payload, {
    code: "internal",
    message: "Internal server error",
    status: 500,
  });
});

test("POST /api/auth/register forwards guestUserId for guest-to-account data sync", async () => {
  const { authService, calls } = createAuthServiceDouble();
  const guestServer = await startAuthTestServer(authService);

  try {
    const response = await guestServer.fetch("/api/auth/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-client-platform": "mobile",
      },
      body: JSON.stringify({
        ...registerBody,
        deviceId: "device-1",
        guestUserId: "web-guest-123e4567-e89b-12d3-a456-426614174000",
      }),
    });

    assert.equal(response.status, 201);

    const registerCall = calls.find((entry) => entry.method === "register");
    assert.deepStrictEqual(registerCall?.args, {
      username: "alice",
      password: "password-123",
      deviceId: "device-1",
      guestUserId: "web-guest-123e4567-e89b-12d3-a456-426614174000",
    });
  } finally {
    await guestServer.close();
    setAuthServiceForTests(sharedAuthService);
  }
});

test("POST /api/auth/login sets httpOnly cookie for web transport", async () => {
  const response = await server.fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-client-platform": "web",
    },
    body: JSON.stringify(registerBody),
  });

  const payload = await readJson(response);
  const cookie = response.headers.get("set-cookie") ?? "";

  assert.equal(response.status, 200);
  assert.equal(payload.transport, "cookie");
  assert.equal(payload.refreshToken, "refresh-login");
  assert.match(cookie, /ank_refresh_token=refresh-login/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
});

test("POST /api/auth/login sets SameSite=None secure cookie in production HTTPS", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  try {
    const response = await server.fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.example.com",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify(registerBody),
    });

    const payload = await readJson(response);
    const cookie = response.headers.get("set-cookie") ?? "";

    assert.equal(response.status, 200);
    assert.equal(payload.transport, "cookie");
    assert.equal(payload.refreshToken, "refresh-login");
    assert.match(cookie, /SameSite=None/i);
    assert.match(cookie, /Secure/i);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test("POST /api/auth/login returns json transport for mobile clients", async () => {
  const response = await server.fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-client-platform": "mobile",
    },
    body: JSON.stringify({
      ...registerBody,
      deviceId: "device-1",
    }),
  });

  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(payload.transport, "json");
  assert.equal(payload.refreshToken, "refresh-login");
  assert.equal(response.headers.get("set-cookie"), null);
});

test("POST /api/auth/refresh returns 401 when refresh token is missing", async () => {
  const response = await server.fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });

  const payload = await readJson(response);

  assert.equal(response.status, 401);
  assert.deepStrictEqual(payload, {
    code: "auth",
    message: "Refresh token is required",
    status: 401,
  });
});

test("POST /api/auth/refresh prefers body refreshToken over cookie", async () => {
  const { authService, calls } = createAuthServiceDouble();
  const isolatedServer = await startAuthTestServer(authService);

  try {
    const response = await isolatedServer.fetch("/api/auth/refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "ank_refresh_token=from-cookie",
      },
      body: JSON.stringify({ refreshToken: "from-body" }),
    });

    const payload = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(calls[0]?.args.refreshToken, "from-body");
    assert.equal(payload.refreshToken, "refresh-refresh");
  } finally {
    await isolatedServer.close();
    setAuthServiceForTests(sharedAuthService);
  }
});

test("POST /api/auth/refresh works with cookie-only request", async () => {
  const { authService, calls } = createAuthServiceDouble();
  const isolatedServer = await startAuthTestServer(authService);

  try {
    const response = await isolatedServer.fetch("/api/auth/refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "ank_refresh_token=cookie-only-token",
      },
      body: JSON.stringify({}),
    });

    const payload = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(calls[0]?.args.refreshToken, "cookie-only-token");
    assert.equal(payload.accessToken, "access-refresh");
    assert.equal(payload.refreshToken, "refresh-refresh");
  } finally {
    await isolatedServer.close();
    setAuthServiceForTests(sharedAuthService);
  }
});

test("POST /api/auth/refresh returns rotated token in body and Set-Cookie for web transport", async () => {
  const response = await server.fetch("/api/auth/refresh", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:5173",
    },
    body: JSON.stringify({ refreshToken: "refresh-current" }),
  });

  const payload = await readJson(response);
  const cookie = response.headers.get("set-cookie") ?? "";

  assert.equal(response.status, 200);
  assert.equal(payload.transport, "cookie");
  assert.equal(payload.refreshToken, "refresh-refresh");
  assert.match(cookie, /ank_refresh_token=refresh-refresh/);
  assert.match(cookie, /HttpOnly/i);
});

test("POST /api/auth/logout returns 401 when refresh token is missing", async () => {
  const response = await server.fetch("/api/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });

  const payload = await readJson(response);

  assert.equal(response.status, 401);
  assert.deepStrictEqual(payload, {
    code: "auth",
    message: "Refresh token is required",
    status: 401,
  });
});

test("POST /api/auth/upgrade-session exchanges legacy session for JWT-compatible response", async () => {
  const { authService, calls } = createAuthServiceDouble();
  const isolatedServer = await startAuthTestServer(authService);

  try {
    const response = await isolatedServer.fetch("/api/auth/upgrade-session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-client-platform": "mobile",
      },
      body: JSON.stringify({
        userId: "legacy-user-id",
        legacySessionToken: "legacy-token-proof",
        deviceId: "device-1",
      }),
    });

    const payload = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(payload.userId, "legacy-user-id");
    assert.equal(payload.transport, "json");
    assert.equal(payload.refreshToken, "refresh-upgrade");
    assert.equal(response.headers.get("set-cookie"), null);

    const upgradeCall = calls.find((entry) => entry.method === "upgradeSession");
    assert.deepStrictEqual(upgradeCall?.args, {
      userId: "legacy-user-id",
      legacySessionToken: "legacy-token-proof",
      deviceId: "device-1",
    });
  } finally {
    await isolatedServer.close();
    setAuthServiceForTests(sharedAuthService);
  }
});

test("POST /api/auth/upgrade-session returns 401 when legacy token is missing", async () => {
  const authService: AuthService = {
    register: async () => {
      throw new Error("Not used in this test");
    },
    login: async () => {
      throw new Error("Not used in this test");
    },
    refresh: async () => {
      throw new Error("Not used in this test");
    },
    logout: async () => {
      throw new Error("Not used in this test");
    },
    upgradeSession: async (input) => {
      if (!input.legacySessionToken) {
        throw new AppError({
          code: "auth",
          message: "Legacy session token is required for upgrade-session",
        });
      }

      return {
        userId: input.userId,
        username: "legacy-user",
        tokens: {
          accessToken: "access-upgrade",
          refreshToken: "refresh-upgrade",
          accessExpiresAt: Date.now() + 60_000,
          refreshExpiresAt: Date.now() + 120_000,
        },
      };
    },
  };

  const isolatedServer = await startAuthTestServer(authService);

  try {
    const response = await isolatedServer.fetch("/api/auth/upgrade-session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-client-platform": "mobile",
      },
      body: JSON.stringify({
        userId: "legacy-user-id",
        deviceId: "device-1",
      }),
    });

    const payload = await readJson(response);

    assert.equal(response.status, 401);
    assert.deepStrictEqual(payload, {
      code: "auth",
      message: "Legacy session token is required for upgrade-session",
      status: 401,
    });
  } finally {
    await isolatedServer.close();
    setAuthServiceForTests(sharedAuthService);
  }
});

test("POST /api/auth/logout returns 204 with empty body and clears cookie", async () => {
  const { authService, calls } = createAuthServiceDouble();
  const isolatedServer = await startAuthTestServer(authService);

  try {
    const response = await isolatedServer.fetch("/api/auth/logout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:5173",
      },
      body: JSON.stringify({ refreshToken: "logout-token" }),
    });

    const cookie = response.headers.get("set-cookie") ?? "";
    const body = await response.text();

    assert.equal(response.status, 204);
    assert.equal(body, "");
    assert.equal(calls[0]?.args.refreshToken, "logout-token");
    assert.match(cookie, /ank_refresh_token=/);
    assert.match(cookie, /Max-Age=0/i);
  } finally {
    await isolatedServer.close();
    setAuthServiceForTests(sharedAuthService);
  }
});