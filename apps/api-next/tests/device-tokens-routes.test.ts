import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";

import { createTokenFactory } from "@backend/auth/tokens";

import { resetGuestRateLimitStateForTests } from "../src/http/auth/require-access";
import { createDeviceTokensServiceDouble } from "./support/device-tokens-service-double";
import {
  authHeaders,
  jsonAuthHeaders,
  jsonGuestHeaders,
  startDeviceTokensTestServer,
} from "./support/device-tokens-test-server";

const createAccessToken = async (userId: string): Promise<string> => {
  const tokenFactory = createTokenFactory();
  const pair = await tokenFactory.issueTokenPair({
    userId,
    username: userId,
  });

  return pair.accessToken;
};

afterEach(() => {
  resetGuestRateLimitStateForTests();
});

test("device token route upsert is idempotent, allows same-device reassignment, and delete missing token is no-op", async () => {
  const service = createDeviceTokensServiceDouble();
  const server = await startDeviceTokensTestServer({ deviceTokensService: service });
  const token = await createAccessToken("user-1");

  try {
    const first = await server.fetch("/api/device-tokens", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        deviceId: "device-1",
        fcmToken: "fcm-1",
        platform: "android",
      }),
    });

    assert.equal(first.status, 200);
    assert.equal(service.tokens.size, 1);

    const second = await server.fetch("/api/device-tokens", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        deviceId: "device-1",
        fcmToken: "fcm-2",
        platform: "android",
      }),
    });

    assert.equal(second.status, 200);
    assert.equal(service.tokens.size, 1);
    assert.equal(service.tokens.get("device-1")?.fcmToken, "fcm-2");
    assert.equal(service.tokens.get("device-1")?.userId, "user-1");

    const otherUserToken = await createAccessToken("user-2");
    const reassigned = await server.fetch("/api/device-tokens", {
      method: "POST",
      headers: jsonAuthHeaders(otherUserToken),
      body: JSON.stringify({
        deviceId: "device-1",
        fcmToken: "fcm-3",
        platform: "android",
      }),
    });

    assert.equal(reassigned.status, 200);
    assert.equal(service.tokens.size, 1);
    assert.equal(service.tokens.get("device-1")?.fcmToken, "fcm-3");
    assert.equal(service.tokens.get("device-1")?.userId, "user-2");

    const deletedMissing = await server.fetch("/api/device-tokens/missing-device", {
      method: "DELETE",
      headers: authHeaders(token),
    });

    assert.equal(deletedMissing.status, 200);
    assert.deepEqual(await deletedMissing.json(), { deleted: false });
  } finally {
    await server.close();
  }
});

test("device token route accepts guest-authenticated mobile requests", async () => {
  const service = createDeviceTokensServiceDouble();
  const server = await startDeviceTokensTestServer({ deviceTokensService: service });

  try {
    const response = await server.fetch("/api/device-tokens", {
      method: "POST",
      headers: jsonGuestHeaders("123e4567-e89b-12d3-a456-426614174000", "mobile"),
      body: JSON.stringify({
        deviceId: "device-guest",
        fcmToken: "fcm-guest",
        platform: "android",
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(
      service.tokens.get("device-guest")?.userId,
      "123e4567-e89b-12d3-a456-426614174000",
    );
  } finally {
    await server.close();
  }
});

test("device token route rejects invalid platform payloads", async () => {
  const service = createDeviceTokensServiceDouble();
  const server = await startDeviceTokensTestServer({ deviceTokensService: service });
  const token = await createAccessToken("user-1");

  try {
    const invalid = await server.fetch("/api/device-tokens", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        deviceId: "device-1",
        fcmToken: "fcm-1",
        platform: "ios",
      }),
    });

    assert.equal(invalid.status, 400);
    const payload = (await invalid.json()) as { code: string; status: number };
    assert.equal(payload.code, "validation");
    assert.equal(payload.status, 400);
  } finally {
    await server.close();
  }
});

test("notification_ledger remains excluded from api-next device-tokens routes", async () => {
  const routeSources = await Promise.all([
    readFile(new URL("../app/api/device-tokens/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/device-tokens/[deviceId]/route.ts", import.meta.url), "utf8"),
  ]);

  for (const source of routeSources) {
    assert.equal(source.includes("notification-ledger"), false);
    assert.equal(source.includes("notification_ledger"), false);
  }
});