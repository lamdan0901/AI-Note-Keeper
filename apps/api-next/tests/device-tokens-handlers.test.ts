import assert from "node:assert/strict";
import { test } from "node:test";

import type { DeviceTokenRecord } from "@backend/device-tokens/contracts.js";
import type { DeviceTokensService } from "@backend/device-tokens/service";
import { AppError } from "@backend/middleware/error-middleware";

import { createDeleteDeviceTokenHandler } from "../src/handlers/device-tokens/delete";
import { createUpsertDeviceTokenHandler } from "../src/handlers/device-tokens/upsert";
import type { AuthenticatedContext } from "../src/http/types";

const AUTH_USER_ID = "auth-user-123";

const sampleDeviceToken = (): DeviceTokenRecord => ({
  id: "token-1",
  userId: AUTH_USER_ID,
  deviceId: "device-1",
  fcmToken: "fcm-token-abc",
  platform: "android",
  createdAt: new Date("2026-06-26T00:00:00.000Z"),
  updatedAt: new Date("2026-06-26T00:00:00.000Z"),
});

const createAuthContext = (
  input: Readonly<{
    body?: unknown;
    params?: Readonly<Record<string, string>>;
  }> = {},
): AuthenticatedContext => ({
  request: {} as AuthenticatedContext["request"],
  method: "POST",
  url: new URL("http://localhost/api/device-tokens"),
  headers: new Headers(),
  body: input.body ?? null,
  params: input.params ?? {},
  query: {},
  cookies: {},
  clientIp: null,
  forwardedProto: null,
  authUser: { userId: AUTH_USER_ID, username: "alice" },
});

const createDeviceTokensServiceDouble = () => {
  const calls: Array<Readonly<{ method: string; args: Record<string, unknown> }>> = [];

  const deviceTokensService: DeviceTokensService = {
    upsert: async (input) => {
      calls.push({ method: "upsert", args: input as Record<string, unknown> });
      return sampleDeviceToken();
    },
    deleteByDeviceId: async (input) => {
      calls.push({ method: "deleteByDeviceId", args: input as Record<string, unknown> });
      return true;
    },
  };

  return { deviceTokensService, calls };
};

test("createUpsertDeviceTokenHandler delegates to deviceTokensService.upsert with auth userId", async () => {
  const { deviceTokensService, calls } = createDeviceTokensServiceDouble();
  const handler = createUpsertDeviceTokenHandler(deviceTokensService);

  const result = await handler(
    createAuthContext({
      body: {
        deviceId: "device-1",
        fcmToken: "fcm-token-abc",
        platform: "android",
      },
    }),
  );

  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    deviceId: "device-1",
    fcmToken: "fcm-token-abc",
    platform: "android",
  });
  assert.deepStrictEqual(result, { token: sampleDeviceToken() });
});

test("createDeleteDeviceTokenHandler delegates to deviceTokensService.deleteByDeviceId with auth userId", async () => {
  const { deviceTokensService, calls } = createDeviceTokensServiceDouble();
  const handler = createDeleteDeviceTokenHandler(deviceTokensService);

  const result = await handler(
    createAuthContext({
      params: { deviceId: "device-1" },
    }),
  );

  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    deviceId: "device-1",
  });
  assert.deepStrictEqual(result, { deleted: true });
});

test("createDeleteDeviceTokenHandler propagates forbidden AppError from service", async () => {
  const deviceTokensService: DeviceTokensService = {
    upsert: async () => sampleDeviceToken(),
    deleteByDeviceId: async () => {
      throw new AppError({
        code: "forbidden",
        message: "Device token does not belong to authenticated user",
      });
    },
  };

  const handler = createDeleteDeviceTokenHandler(deviceTokensService);

  await assert.rejects(
    async () =>
      handler(
        createAuthContext({
          params: { deviceId: "device-other-user" },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "forbidden");
      return true;
    },
  );
});