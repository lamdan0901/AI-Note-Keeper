import assert from "node:assert/strict";
import { test } from "node:test";

import type { AuthenticatedContext } from "../src/http/types";
import {
  deviceIdParamsSchema,
  requireAuthUserId,
  upsertBodySchema,
} from "../src/handlers/device-tokens/shared";

const buildAuthContext = (userId: string): AuthenticatedContext => {
  return {
    request: {} as AuthenticatedContext["request"],
    method: "POST",
    url: new URL("http://localhost/api/device-tokens"),
    headers: new Headers(),
    body: null,
    params: {},
    query: {},
    cookies: {},
    clientIp: null,
    forwardedProto: null,
    authUser: { userId, username: "alice" },
  };
};

const minimalUpsertBody = () => ({
  deviceId: "device-1",
  fcmToken: "fcm-token-abc",
  platform: "android" as const,
});

test("upsertBodySchema accepts android platform literal", () => {
  const parsed = upsertBodySchema.safeParse(minimalUpsertBody());

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.platform, "android");
  }
});

test("upsertBodySchema rejects non-android platform", () => {
  assert.equal(
    upsertBodySchema.safeParse({ ...minimalUpsertBody(), platform: "ios" }).success,
    false,
  );
  assert.equal(
    upsertBodySchema.safeParse({ ...minimalUpsertBody(), platform: "web" }).success,
    false,
  );
});

test("upsertBodySchema rejects empty deviceId and fcmToken", () => {
  assert.equal(
    upsertBodySchema.safeParse({ ...minimalUpsertBody(), deviceId: "" }).success,
    false,
  );
  assert.equal(
    upsertBodySchema.safeParse({ ...minimalUpsertBody(), fcmToken: "" }).success,
    false,
  );
  assert.equal(upsertBodySchema.safeParse({}).success, false);
});

test("deviceIdParamsSchema requires non-empty deviceId", () => {
  assert.equal(deviceIdParamsSchema.safeParse({ deviceId: "device-1" }).success, true);
  assert.equal(deviceIdParamsSchema.safeParse({ deviceId: "" }).success, false);
  assert.equal(deviceIdParamsSchema.safeParse({}).success, false);
});

test("requireAuthUserId reads userId from authenticated context", () => {
  const ctx = buildAuthContext("auth-user-123");

  assert.equal(requireAuthUserId(ctx), "auth-user-123");
});