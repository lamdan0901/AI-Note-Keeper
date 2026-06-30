import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  buildAuthRequestInit,
  startAuthTestServer,
  type AuthTestServer,
} from "./support/auth-test-server";
import { createAuthServiceDouble } from "./support/auth-service-double";

const loginBody = {
  username: "alice",
  password: "password-123",
} as const;

let server: AuthTestServer;

after(async () => {
  if (server) {
    await server.close();
  }
});

test("auth test harness binds an ephemeral port instead of :3001", async () => {
  server = await startAuthTestServer();

  assert.notEqual(server.port, 3001);
  assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

  const response = await server.fetch(
    "/api/auth/login",
    buildAuthRequestInit(loginBody, { clientPlatform: "mobile" }),
  );

  assert.equal(response.status, 200);
});

test("auth test harness injects mock AuthService and records service calls", async () => {
  const double = createAuthServiceDouble();
  const isolatedServer = await startAuthTestServer(double);

  try {
    const response = await isolatedServer.fetch(
      "/api/auth/login",
      buildAuthRequestInit(loginBody, { clientPlatform: "mobile" }),
    );

    assert.equal(response.status, 200);
    assert.equal(double.calls.length, 1);
    assert.equal(double.calls[0]?.method, "login");
    assert.deepStrictEqual(double.calls[0]?.args, {
      username: "alice",
      password: "password-123",
      deviceId: null,
    });
  } finally {
    await isolatedServer.close();
  }
});

test("auth test harness forwards x-client-platform, origin, x-forwarded-proto, and Cookie headers", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  const isolatedServer = await startAuthTestServer();

  try {
    const webResponse = await isolatedServer.fetch(
      "/api/auth/login",
      buildAuthRequestInit(loginBody, { clientPlatform: "web" }),
    );
    const webPayload = (await webResponse.json()) as Record<string, unknown>;
    const webCookie = webResponse.headers.get("set-cookie") ?? "";

    assert.equal(webPayload.transport, "cookie");
    assert.match(webCookie, /HttpOnly/i);

    const productionResponse = await isolatedServer.fetch(
      "/api/auth/login",
      buildAuthRequestInit(loginBody, {
        origin: "https://app.example.com",
        forwardedProto: "https",
      }),
    );
    const productionCookie = productionResponse.headers.get("set-cookie") ?? "";

    assert.match(productionCookie, /SameSite=None/i);
    assert.match(productionCookie, /Secure/i);

    const cookieResponse = await isolatedServer.fetch(
      "/api/auth/refresh",
      buildAuthRequestInit({}, { cookie: "ank_refresh_token=harness-cookie-token" }),
    );
    const cookiePayload = (await cookieResponse.json()) as Record<string, unknown>;

    assert.equal(cookieResponse.status, 200);
    assert.equal(cookiePayload.accessToken, "access-refresh");
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    await isolatedServer.close();
  }
});