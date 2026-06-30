import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createTokenFactory } from "@backend/auth/tokens";

import { resetGuestRateLimitStateForTests } from "../src/http/auth/require-access";
import { createDeviceTokensServiceDouble } from "./support/device-tokens-service-double";
import {
  authHeaders,
  DEFAULT_AUTH_USER_ID,
  deviceTokensRouteRegistrations,
  guestHeaders,
  jsonAuthHeaders,
  jsonGuestHeaders,
  startDeviceTokensTestServer,
} from "./support/device-tokens-test-server";

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  return (await response.json()) as Record<string, unknown>;
};

afterEach(() => {
  resetGuestRateLimitStateForTests();
});

test("device-tokens test harness binds an ephemeral port instead of :3001", async () => {
  const server = await startDeviceTokensTestServer();

  try {
    assert.notEqual(server.port, 3001);
    assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await server.close();
  }
});

test("device-tokens test harness registers POST and DELETE routes", () => {
  const methodsByPath = new Map<string, Set<string>>();

  for (const route of deviceTokensRouteRegistrations) {
    const path = route.pattern ?? route.pathname;
    const methods = methodsByPath.get(path) ?? new Set<string>();
    methods.add(route.method);
    methodsByPath.set(path, methods);
  }

  assert.deepEqual([...methodsByPath.keys()].sort(), [
    "/api/device-tokens",
    "/api/device-tokens/:deviceId",
  ]);
  assert.deepEqual([...(methodsByPath.get("/api/device-tokens") ?? [])], ["POST"]);
  assert.deepEqual([...(methodsByPath.get("/api/device-tokens/:deviceId") ?? [])], ["DELETE"]);
});

test("device-tokens test harness dispatches dynamic [deviceId] DELETE routing", async () => {
  const service = createDeviceTokensServiceDouble();
  await service.upsert({
    userId: DEFAULT_AUTH_USER_ID,
    deviceId: "device-dynamic",
    fcmToken: "fcm-dynamic",
    platform: "android",
  });

  const server = await startDeviceTokensTestServer({ deviceTokensService: service });

  try {
    const response = await server.fetch("/api/device-tokens/device-dynamic", {
      method: "DELETE",
      headers: authHeaders(server.accessToken),
    });
    const payload = await readJson(response);

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { deleted: true });
    assert.equal(service.tokens.has("device-dynamic"), false);
  } finally {
    await server.close();
  }
});

test("device-tokens test harness dispatches POST /api/device-tokens in-process", async () => {
  const server = await startDeviceTokensTestServer();

  try {
    const response = await server.fetch("/api/device-tokens", {
      method: "POST",
      headers: jsonAuthHeaders(server.accessToken),
      body: JSON.stringify({
        deviceId: "device-harness",
        fcmToken: "fcm-harness",
        platform: "android",
      }),
    });
    const payload = await readJson(response);

    assert.equal(response.status, 200);
    const token = payload.token as Record<string, unknown>;
    assert.equal(token.deviceId, "device-harness");
    assert.equal(token.userId, server.authUserId);
  } finally {
    await server.close();
  }
});

test("device-tokens test harness accepts mobile guest headers without database", async () => {
  const guestUserId = "123e4567-e89b-12d3-a456-426614174000";
  const server = await startDeviceTokensTestServer();

  try {
    const response = await server.fetch("/api/device-tokens", {
      method: "POST",
      headers: jsonGuestHeaders(guestUserId, "mobile"),
      body: JSON.stringify({
        deviceId: "device-guest-harness",
        fcmToken: "fcm-guest",
        platform: "android",
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(
      server.deviceTokensService.tokens.get("device-guest-harness")?.userId,
      guestUserId,
    );
  } finally {
    await server.close();
  }
});

test("device-tokens test harness authHeaders and guestHeaders helpers shape requests", async () => {
  const tokenFactory = createTokenFactory();
  const tokens = await tokenFactory.issueTokenPair({
    userId: "helper-user",
    username: "helper-user",
  });

  assert.equal(authHeaders(tokens.accessToken).get("authorization"), `Bearer ${tokens.accessToken}`);
  assert.equal(guestHeaders("guest-uuid", "mobile").get("x-client-platform"), "mobile");
  assert.equal(guestHeaders("guest-uuid", "web").get("x-guest-user-id"), "guest-uuid");
});