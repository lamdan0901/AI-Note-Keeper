import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, afterEach, before, test } from "node:test";

import { createHealthStatus } from "@backend/health";

import {
  attachSoftPoolErrorHandling,
  resetPoolErrorStateForTests,
  type PoolErrorEventTarget,
} from "../src/db/pool";
import { createAuthServiceDouble } from "./support/auth-service-double";
import { startAuthTestServer, type AuthTestServer } from "./support/auth-test-server";
import {
  getHealthLive,
  getHealthReady,
  getSample,
} from "./support/next-test-server";

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  return (await response.json()) as Record<string, unknown>;
};

const createMockPool = (): PoolErrorEventTarget & Readonly<{ emit: (error: Error) => void }> => {
  const emitter = new EventEmitter();

  return {
    removeAllListeners: (event?: string | symbol) => emitter.removeAllListeners(event),
    on: (event: "error", listener: (error: Error) => void) => emitter.on(event, listener),
    emit: (error: Error) => {
      emitter.emit("error", error);
    },
  };
};

const internalErrorPayload = {
  code: "internal",
  message: "Internal server error",
  status: 500,
} as const;

let server: AuthTestServer;

before(async () => {
  const { authService } = createAuthServiceDouble();
  server = await startAuthTestServer(authService);
});

after(async () => {
  await server.close();
});

afterEach(() => {
  resetPoolErrorStateForTests();
});

test("degraded dependencies keep health endpoints online and fail gated API routes", async () => {
  const healthyApiResponse = await getSample(server);
  assert.equal(healthyApiResponse.status, 200);

  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);
  mockPool.emit(new Error("idle client connection lost"));

  const liveResponse = await getHealthLive(server);
  const livePayload = await readJson(liveResponse);
  assert.equal(liveResponse.status, 200);
  assert.deepStrictEqual(livePayload, createHealthStatus());

  const readyResponse = await getHealthReady(server);
  const readyPayload = await readJson(readyResponse);
  assert.equal(readyResponse.status, 503);
  assert.equal(readyPayload.ok, false);

  const degradedSampleResponse = await getSample(server);
  const degradedSamplePayload = await readJson(degradedSampleResponse);
  assert.equal(degradedSampleResponse.status, 500);
  assert.deepStrictEqual(degradedSamplePayload, internalErrorPayload);
});

test("degraded dependencies return 500 internal for gated auth routes", async () => {
  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);
  mockPool.emit(new Error("idle client connection lost"));

  const loginResponse = await server.fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-client-platform": "mobile",
    },
    body: JSON.stringify({ username: "alice", password: "password-123" }),
  });
  const loginPayload = await readJson(loginResponse);

  assert.equal(loginResponse.status, 500);
  assert.deepStrictEqual(loginPayload, internalErrorPayload);
});