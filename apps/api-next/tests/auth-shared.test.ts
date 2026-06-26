import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "@backend/middleware/error-middleware";
import {
  authCredentialsSchema,
  logoutSchema,
  refreshSchema,
  upgradeSessionSchema,
} from "@backend/auth/http.js";

import {
  buildAuthResponse,
  toAuthError,
  toDeviceId,
} from "../src/handlers/auth/shared";

test("toAuthError returns AppError with auth code and message", () => {
  const error = toAuthError("Invalid credentials");

  assert.ok(error instanceof AppError);
  assert.equal(error.code, "auth");
  assert.equal(error.status, 401);
  assert.equal(error.message, "Invalid credentials");
});

test("toDeviceId returns trimmed string or null", () => {
  assert.equal(toDeviceId("device-1"), "device-1");
  assert.equal(toDeviceId("  device-2  "), "  device-2  ");
  assert.equal(toDeviceId(""), null);
  assert.equal(toDeviceId("   "), null);
  assert.equal(toDeviceId(undefined), null);
  assert.equal(toDeviceId(null), null);
  assert.equal(toDeviceId(42), null);
});

test("buildAuthResponse returns Express-compatible auth payload keys", () => {
  const payload = buildAuthResponse({
    userId: "user-123",
    username: "alice",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    transport: "cookie",
  });

  assert.deepStrictEqual(Object.keys(payload).sort(), [
    "accessToken",
    "refreshToken",
    "transport",
    "userId",
    "username",
  ]);
  assert.deepStrictEqual(payload, {
    userId: "user-123",
    username: "alice",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    transport: "cookie",
  });
});

test("shared module re-exports auth schemas from backend http module", () => {
  assert.equal(typeof authCredentialsSchema.safeParse, "function");
  assert.equal(typeof refreshSchema.safeParse, "function");
  assert.equal(typeof logoutSchema.safeParse, "function");
  assert.equal(typeof upgradeSessionSchema.safeParse, "function");

  const credentials = authCredentialsSchema.safeParse({
    username: "alice",
    password: "password123",
  });
  assert.equal(credentials.success, true);
});