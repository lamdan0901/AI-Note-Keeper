import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createTokenFactory } from "@backend/auth/tokens";

import { resetGuestRateLimitStateForTests } from "../src/http/auth/require-access";
import { createDeviceTokensServiceDouble } from "./support/device-tokens-service-double";
import {
  authHeaders,
  jsonAuthHeaders,
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

/**
 * Device-token portion of backend phase3.http.contract.test.ts
 * "subscriptions and device-token mutations reject cross-user ownership violations".
 */
test("device-token mutations reject cross-user ownership violations", async () => {
  const service = createDeviceTokensServiceDouble();
  const server = await startDeviceTokensTestServer({ deviceTokensService: service });
  const ownerToken = await createAccessToken("owner-user");
  const otherToken = await createAccessToken("other-user");

  try {
    const ownerUpsert = await server.fetch("/api/device-tokens", {
      method: "POST",
      headers: jsonAuthHeaders(ownerToken),
      body: JSON.stringify({
        deviceId: "shared-device",
        fcmToken: "owner-token",
        platform: "android",
      }),
    });

    assert.equal(ownerUpsert.status, 200);

    const crossUserDelete = await server.fetch("/api/device-tokens/shared-device", {
      method: "DELETE",
      headers: authHeaders(otherToken),
    });

    assert.equal(crossUserDelete.status, 403);
    const devicePayload = (await crossUserDelete.json()) as {
      code: string;
      message: string;
      status: number;
    };
    assert.deepEqual(Object.keys(devicePayload).sort(), ["code", "message", "status"]);
    assert.equal(devicePayload.code, "forbidden");
    assert.equal(devicePayload.status, 403);
  } finally {
    await server.close();
  }
});

/**
 * Mirrors backend phase3.http.contract.test.ts
 * "device-token upsert allows same-device claim transfer while delete remains ownership protected".
 */
test("device-token upsert allows same-device claim transfer while delete remains ownership protected", async () => {
  const service = createDeviceTokensServiceDouble();
  const server = await startDeviceTokensTestServer({ deviceTokensService: service });
  const firstUserToken = await createAccessToken("first-user");
  const secondUserToken = await createAccessToken("second-user");

  try {
    const firstUpsert = await server.fetch("/api/device-tokens", {
      method: "POST",
      headers: jsonAuthHeaders(firstUserToken),
      body: JSON.stringify({
        deviceId: "claim-device",
        fcmToken: "first-token",
        platform: "android",
      }),
    });

    assert.equal(firstUpsert.status, 200);
    const firstPayload = (await firstUpsert.json()) as {
      token: { id: string; userId: string; deviceId: string; fcmToken: string };
    };
    assert.equal(firstPayload.token.userId, "first-user");
    assert.equal(firstPayload.token.deviceId, "claim-device");
    assert.equal(firstPayload.token.fcmToken, "first-token");

    const claimedUpsert = await server.fetch("/api/device-tokens", {
      method: "POST",
      headers: jsonAuthHeaders(secondUserToken),
      body: JSON.stringify({
        deviceId: "claim-device",
        fcmToken: "second-token",
        platform: "android",
      }),
    });

    assert.equal(claimedUpsert.status, 200);
    const claimedPayload = (await claimedUpsert.json()) as {
      token: { id: string; userId: string; deviceId: string; fcmToken: string };
    };
    assert.equal(claimedPayload.token.id, firstPayload.token.id);
    assert.equal(claimedPayload.token.userId, "second-user");
    assert.equal(claimedPayload.token.deviceId, "claim-device");
    assert.equal(claimedPayload.token.fcmToken, "second-token");

    const staleOwnerDelete = await server.fetch("/api/device-tokens/claim-device", {
      method: "DELETE",
      headers: authHeaders(firstUserToken),
    });

    assert.equal(staleOwnerDelete.status, 403);
    const staleOwnerPayload = (await staleOwnerDelete.json()) as {
      code: string;
      message: string;
      status: number;
    };
    assert.deepEqual(Object.keys(staleOwnerPayload).sort(), ["code", "message", "status"]);
    assert.equal(staleOwnerPayload.code, "forbidden");
    assert.equal(staleOwnerPayload.status, 403);

    const currentOwnerDelete = await server.fetch("/api/device-tokens/claim-device", {
      method: "DELETE",
      headers: authHeaders(secondUserToken),
    });

    assert.equal(currentOwnerDelete.status, 200);
    assert.deepEqual(await currentOwnerDelete.json(), { deleted: true });
  } finally {
    await server.close();
  }
});