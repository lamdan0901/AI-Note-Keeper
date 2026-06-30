import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";

import { AppError } from "@backend/middleware/error-middleware";
import type { AuthService } from "@backend/auth/service";

import { createLoginHandler } from "../src/handlers/auth/login";
import { createLogoutHandler } from "../src/handlers/auth/logout";
import { createRefreshHandler } from "../src/handlers/auth/refresh";
import { createRegisterHandler } from "../src/handlers/auth/register";
import { createUpgradeSessionHandler } from "../src/handlers/auth/upgrade-session";
import type { RequestContext } from "../src/http/types";

const createTokenPair = () =>
  ({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    accessExpiresAt: Date.now() + 60_000,
    refreshExpiresAt: Date.now() + 120_000,
  }) as const;

const createAuthServiceDouble = () => {
  const calls: Array<Readonly<{ method: string; args: Record<string, unknown> }>> = [];

  const authService: AuthService = {
    register: async (input) => {
      calls.push({ method: "register", args: input as Record<string, unknown> });
      return {
        userId: "user-register",
        username: input.username,
        tokens: createTokenPair(),
      };
    },
    login: async (input) => {
      calls.push({ method: "login", args: input as Record<string, unknown> });
      return {
        userId: "user-login",
        username: input.username,
        tokens: createTokenPair(),
      };
    },
    upgradeSession: async (input) => {
      calls.push({ method: "upgradeSession", args: input as Record<string, unknown> });
      return {
        userId: input.userId,
        username: "legacy-user",
        tokens: createTokenPair(),
      };
    },
    refresh: async (input) => {
      calls.push({ method: "refresh", args: input as Record<string, unknown> });
      return {
        userId: "user-refresh",
        username: "alice",
        tokens: createTokenPair(),
      };
    },
    logout: async (input) => {
      calls.push({ method: "logout", args: input as Record<string, unknown> });
    },
  };

  return { authService, calls };
};

const createContext = (
  input: Readonly<{
    body?: unknown;
    cookie?: string;
  }>,
): RequestContext => {
  const request = new NextRequest("http://localhost:3001/api/auth/login", {
    method: "POST",
    headers: input.cookie ? { cookie: input.cookie } : undefined,
  });

  return {
    request,
    method: request.method,
    url: request.nextUrl,
    headers: request.headers,
    body: input.body,
    params: {},
    query: {},
    cookies: {},
    clientIp: "127.0.0.1",
    forwardedProto: null,
  };
};

test("createRegisterHandler forwards guestUserId when present and returns 201 with tokens", async () => {
  const { authService, calls } = createAuthServiceDouble();
  const handler = createRegisterHandler(authService);

  const result = await handler(
    createContext({
      body: {
        username: "alice",
        password: "password123",
        deviceId: "device-1",
        guestUserId: "web-guest-550e8400-e29b-41d4-a716-446655440000",
      },
    }),
  );

  assert.equal(result.status, 201);
  assert.deepStrictEqual(result.body, {
    userId: "user-register",
    username: "alice",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    transport: "json",
  });
  assert.ok(result.tokens);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "register");
  assert.equal(calls[0]?.args.guestUserId, "web-guest-550e8400-e29b-41d4-a716-446655440000");
  assert.equal(calls[0]?.args.deviceId, "device-1");
});

test("createRegisterHandler omits guestUserId when not a string", async () => {
  const { authService, calls } = createAuthServiceDouble();
  const handler = createRegisterHandler(authService);

  await handler(
    createContext({
      body: {
        username: "alice",
        password: "password123",
        guestUserId: 42,
      },
    }),
  );

  assert.equal(calls[0]?.args.guestUserId, undefined);
});

test("createLoginHandler returns 200 auth payload with tokens", async () => {
  const { authService } = createAuthServiceDouble();
  const handler = createLoginHandler(authService);

  const result = await handler(
    createContext({
      body: {
        username: "bob",
        password: "password123",
        deviceId: "  ",
      },
    }),
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.username, "bob");
  assert.ok(result.tokens);
});

test("createRefreshHandler prefers body refreshToken over cookie", async () => {
  const { authService, calls } = createAuthServiceDouble();
  const handler = createRefreshHandler(authService);

  const result = await handler(
    createContext({
      body: { refreshToken: "from-body", deviceId: "device-2" },
      cookie: "ank_refresh_token=from-cookie",
    }),
  );

  assert.equal(result.status, 200);
  assert.equal(calls[0]?.args.refreshToken, "from-body");
  assert.equal(calls[0]?.args.deviceId, "device-2");
  assert.ok(result.tokens);
});

test("createRefreshHandler uses cookie when body token is absent", async () => {
  const { authService, calls } = createAuthServiceDouble();
  const handler = createRefreshHandler(authService);

  await handler(
    createContext({
      body: {},
      cookie: "ank_refresh_token=cookie-token",
    }),
  );

  assert.equal(calls[0]?.args.refreshToken, "cookie-token");
});

test("createRefreshHandler throws auth error when refresh token is missing", async () => {
  const { authService } = createAuthServiceDouble();
  const handler = createRefreshHandler(authService);

  await assert.rejects(
    async () => handler(createContext({ body: {} })),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "auth");
      assert.equal(error.message, "Refresh token is required");
      return true;
    },
  );
});

test("createLogoutHandler clears transport and returns 204", async () => {
  const { authService, calls } = createAuthServiceDouble();
  const handler = createLogoutHandler(authService);

  const result = await handler(
    createContext({
      body: { refreshToken: "logout-token" },
    }),
  );

  assert.equal(result.status, 204);
  assert.deepStrictEqual(result.body, {});
  assert.equal(result.clearTransport, true);
  assert.equal(calls[0]?.args.refreshToken, "logout-token");
});

test("createLogoutHandler throws auth error when refresh token is missing", async () => {
  const { authService } = createAuthServiceDouble();
  const handler = createLogoutHandler(authService);

  await assert.rejects(
    async () => handler(createContext({ body: {} })),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "auth");
      assert.equal(error.message, "Refresh token is required");
      return true;
    },
  );
});

test("createUpgradeSessionHandler returns upgraded session payload", async () => {
  const { authService, calls } = createAuthServiceDouble();
  const handler = createUpgradeSessionHandler(authService);

  const result = await handler(
    createContext({
      body: {
        userId: "legacy-user-id",
        legacySessionToken: "legacy-token",
        deviceId: "device-3",
      },
    }),
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.userId, "legacy-user-id");
  assert.equal(result.body.username, "legacy-user");
  assert.ok(result.tokens);
  assert.equal(calls[0]?.method, "upgradeSession");
  assert.equal(calls[0]?.args.userId, "legacy-user-id");
  assert.equal(calls[0]?.args.legacySessionToken, "legacy-token");
});