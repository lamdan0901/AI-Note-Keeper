import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextRequest, NextResponse } from "next/server";

import {
  clearAuthTransport,
  isSecureCookieRequest,
  parseCookies,
  resolveRefreshCookieSameSite,
  resolveRefreshToken,
  shouldUseCookieTransport,
  writeAuthTransport,
} from "../src/http/auth/transport";
import { EMPTY_ROUTE_CONTEXT } from "../src/http/types";
import { withApiHandler } from "../src/http/with-api-handler";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

const createTokenPair = () =>
  ({
    accessToken: "access-token",
    refreshToken: "refresh-token-value",
    accessExpiresAt: Date.now() + 3_600_000,
    refreshExpiresAt: Date.now() + 86_400_000,
  }) as const;

test("writeAuthTransport sets ank_refresh_token cookie when Origin is present", () => {
  const request = new NextRequest("http://localhost:3001/api/auth/login", {
    headers: { origin: "http://localhost:5173" },
  });
  const response = NextResponse.json({ ok: true });

  const transport = writeAuthTransport(request, response, createTokenPair());
  const setCookie = response.headers.get("set-cookie");

  assert.equal(transport.transport, "cookie");
  assert.ok(setCookie?.includes("ank_refresh_token=refresh-token-value"));
  assert.ok(setCookie?.includes("HttpOnly"));
  assert.ok(setCookie?.includes("Path=/"));
  assert.match(setCookie ?? "", /SameSite=(Lax|None)/i);
});

test("resolveRefreshToken reads ank_refresh_token from Cookie header", () => {
  const request = new NextRequest("http://localhost:3001/api/auth/refresh", {
    headers: { cookie: "ank_refresh_token=abc" },
  });

  assert.equal(resolveRefreshToken(request, undefined), "abc");
});

test("resolveRefreshToken prefers explicit body token over cookie", () => {
  const request = new NextRequest("http://localhost:3001/api/auth/refresh", {
    headers: { cookie: "ank_refresh_token=from-cookie" },
  });

  assert.equal(resolveRefreshToken(request, "from-body"), "from-body");
});

test("parseCookies decodes URI-encoded cookie values", () => {
  const request = new NextRequest("http://localhost:3001/api/auth/refresh", {
    headers: { cookie: "ank_refresh_token=token%2Bvalue; other=1" },
  });

  assert.deepStrictEqual(parseCookies(request), {
    ank_refresh_token: "token+value",
    other: "1",
  });
});

test("writeAuthTransport returns json transport when cookie transport is disabled", () => {
  process.env.NODE_ENV = "test";

  const request = new NextRequest("http://localhost:3001/api/auth/login", {
    headers: { "x-client-platform": "mobile" },
  });
  const response = NextResponse.json({ ok: true });

  const transport = writeAuthTransport(request, response, createTokenPair());

  assert.equal(transport.transport, "json");
  assert.equal(response.headers.get("set-cookie"), null);
});

test("clearAuthTransport clears ank_refresh_token with matching flags", () => {
  const request = new NextRequest("http://localhost:3001/api/auth/logout", {
    headers: { origin: "http://localhost:5173" },
  });
  const response = new NextResponse(null, { status: 204 });

  clearAuthTransport(request, response);
  const setCookie = response.headers.get("set-cookie");

  assert.ok(setCookie?.includes("ank_refresh_token="));
  assert.ok(setCookie?.includes("Max-Age=0"));
  assert.ok(setCookie?.includes("HttpOnly"));
  assert.ok(setCookie?.includes("Path=/"));
});

test("isSecureCookieRequest is true in production", () => {
  process.env.NODE_ENV = "production";

  const request = new NextRequest("http://localhost:3001/api/auth/login");
  assert.equal(isSecureCookieRequest(request), true);
});

test("resolveRefreshCookieSameSite is none in production and lax in development", () => {
  process.env.NODE_ENV = "production";
  assert.equal(resolveRefreshCookieSameSite(), "none");

  process.env.NODE_ENV = "development";
  assert.equal(resolveRefreshCookieSameSite(), "lax");
});

test("shouldUseCookieTransport defaults to true without origin or platform hint", () => {
  const request = new NextRequest("http://localhost:3001/api/auth/login");
  assert.equal(shouldUseCookieTransport(request), true);
});

test("withApiHandler postHandler can apply auth transport cookies", async () => {
  const handler = withApiHandler(
    async () => ({
      accessToken: "access-token",
      transport: "cookie",
    }),
    {
      cors: false,
      postHandler: (ctx, response) => {
        writeAuthTransport(ctx.request, response, createTokenPair());
      },
    },
  );

  const request = new NextRequest("http://localhost:3001/api/auth/login", {
    headers: { origin: "http://localhost:5173" },
  });
  const response = await handler(request, EMPTY_ROUTE_CONTEXT);
  const setCookie = response.headers.get("set-cookie");

  assert.equal(response.status, 200);
  assert.ok(setCookie?.includes("ank_refresh_token=refresh-token-value"));
});