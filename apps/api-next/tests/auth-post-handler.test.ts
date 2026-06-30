import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest, NextResponse } from "next/server";

import { createLoginHandler } from "../src/handlers/auth/login";
import { createLogoutHandler } from "../src/handlers/auth/logout";
import type { AuthHandlerResult } from "../src/handlers/auth/shared";
import {
  applyAuthTransport,
  createAuthPostHandler,
  isAuthHandlerResult,
} from "../src/http/auth/post-handler";
import { EMPTY_ROUTE_CONTEXT, type RequestContext } from "../src/http/types";
import { withApiHandler } from "../src/http/with-api-handler";

const createTokenPair = () =>
  ({
    accessToken: "access-token",
    refreshToken: "refresh-token-value",
    accessExpiresAt: Date.now() + 3_600_000,
    refreshExpiresAt: Date.now() + 86_400_000,
  }) as const;

const createContext = (headers?: HeadersInit): RequestContext => {
  const request = new NextRequest("http://localhost:3001/api/auth/login", {
    headers,
  });

  return {
    request,
    method: request.method,
    url: request.nextUrl,
    headers: request.headers,
    body: undefined,
    params: {},
    query: {},
    cookies: {},
    clientIp: "127.0.0.1",
    forwardedProto: null,
  };
};

test("isAuthHandlerResult identifies auth handler results", () => {
  const result: AuthHandlerResult = {
    status: 200,
    body: { ok: true },
    tokens: createTokenPair(),
  };

  assert.equal(isAuthHandlerResult(result), true);
  assert.equal(isAuthHandlerResult({ ok: true }), false);
  assert.equal(isAuthHandlerResult(null), false);
});

test("applyAuthTransport sets cookie and updates transport field for web clients", () => {
  const ctx = createContext({ origin: "http://localhost:5173" });
  const result: AuthHandlerResult = {
    status: 200,
    body: {
      userId: "user-1",
      username: "alice",
      accessToken: "access-token",
      refreshToken: "refresh-token-value",
      transport: "json",
    },
    tokens: createTokenPair(),
  };
  const response = NextResponse.json(result.body, { status: result.status });

  const nextResponse = applyAuthTransport(ctx, response, result);
  const setCookie = nextResponse.headers.get("set-cookie");

  assert.ok(setCookie?.includes("ank_refresh_token=refresh-token-value"));
  assert.equal(nextResponse.status, 200);
});

test("applyAuthTransport clears cookie when clearTransport is set", () => {
  const ctx = createContext({ origin: "http://localhost:5173" });
  const result: AuthHandlerResult = {
    status: 204,
    body: {},
    clearTransport: true,
  };
  const response = new NextResponse(null, { status: 204 });

  const nextResponse = applyAuthTransport(ctx, response, result);
  const setCookie = nextResponse.headers.get("set-cookie");

  assert.equal(nextResponse.status, 204);
  assert.ok(setCookie?.includes("ank_refresh_token="));
  assert.ok(setCookie?.includes("Max-Age=0"));
});

test("withApiHandler and createAuthPostHandler set cookie while preserving JSON body fields", async () => {
  const authResult: AuthHandlerResult = {
    status: 200,
    body: {
      userId: "user-1",
      username: "alice",
      accessToken: "access-token",
      refreshToken: "refresh-token-value",
      transport: "json",
    },
    tokens: createTokenPair(),
  };

  const handler = withApiHandler(async () => authResult, {
    cors: false,
    postHandler: createAuthPostHandler(),
  });

  const request = new NextRequest("http://localhost:3001/api/auth/login", {
    method: "POST",
    headers: { origin: "http://localhost:5173" },
  });
  const response = await handler(request, EMPTY_ROUTE_CONTEXT);
  const payload = (await response.json()) as Record<string, unknown>;
  const setCookie = response.headers.get("set-cookie");

  assert.equal(response.status, 200);
  assert.equal(payload.transport, "cookie");
  assert.equal(payload.refreshToken, "refresh-token-value");
  assert.ok(setCookie?.includes("ank_refresh_token=refresh-token-value"));
});

test("withApiHandler and createAuthPostHandler clear cookie on logout result", async () => {
  const authResult: AuthHandlerResult = {
    status: 204,
    body: {},
    clearTransport: true,
  };

  const handler = withApiHandler(async () => authResult, {
    cors: false,
    postHandler: createAuthPostHandler(),
  });

  const request = new NextRequest("http://localhost:3001/api/auth/logout", {
    method: "POST",
    headers: { origin: "http://localhost:5173" },
  });
  const response = await handler(request, EMPTY_ROUTE_CONTEXT);
  const setCookie = response.headers.get("set-cookie");

  assert.equal(response.status, 204);
  assert.ok(setCookie?.includes("ank_refresh_token="));
  assert.ok(setCookie?.includes("Max-Age=0"));
});

test("withApiHandler wires auth handlers end-to-end with cookie transport", async () => {
  const authService = {
    login: async () => ({
      userId: "user-login",
      username: "bob",
      tokens: createTokenPair(),
    }),
    register: async () => ({
      userId: "user-register",
      username: "bob",
      tokens: createTokenPair(),
    }),
    refresh: async () => ({
      userId: "user-refresh",
      username: "bob",
      tokens: createTokenPair(),
    }),
    logout: async () => undefined,
    upgradeSession: async () => ({
      userId: "legacy-user-id",
      username: "legacy-user",
      tokens: createTokenPair(),
    }),
  };

  const loginHandler = withApiHandler(createLoginHandler(authService), {
    cors: false,
    postHandler: createAuthPostHandler(),
  });
  const logoutHandler = withApiHandler(createLogoutHandler(authService), {
    cors: false,
    postHandler: createAuthPostHandler(),
  });

  const loginRequest = new NextRequest("http://localhost:3001/api/auth/login", {
    method: "POST",
    headers: {
      origin: "http://localhost:5173",
      "content-type": "application/json",
    },
    body: JSON.stringify({ username: "bob", password: "password123" }),
  });
  const loginResponse = await loginHandler(loginRequest, EMPTY_ROUTE_CONTEXT);
  const loginPayload = (await loginResponse.json()) as Record<string, unknown>;

  assert.equal(loginResponse.status, 200);
  assert.equal(loginPayload.transport, "cookie");
  assert.ok(loginResponse.headers.get("set-cookie")?.includes("ank_refresh_token="));

  const logoutRequest = new NextRequest("http://localhost:3001/api/auth/logout", {
    method: "POST",
    headers: {
      origin: "http://localhost:5173",
      "content-type": "application/json",
    },
    body: JSON.stringify({ refreshToken: "refresh-token-value" }),
  });
  const logoutResponse = await logoutHandler(logoutRequest, EMPTY_ROUTE_CONTEXT);

  assert.equal(logoutResponse.status, 204);
  assert.ok(logoutResponse.headers.get("set-cookie")?.includes("Max-Age=0"));
});