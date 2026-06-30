import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";

import { AppError } from "@backend/middleware/error-middleware";
import { createHealthStatus } from "@backend/health";

import {
  attachSoftPoolErrorHandling,
  resetPoolErrorStateForTests,
  type PoolErrorEventTarget,
} from "../src/db/pool";
import { EMPTY_ROUTE_CONTEXT } from "../src/http/types";
import { withApiHandler } from "../src/http/with-api-handler";
import { createReadinessProbe } from "../src/server/compose-services";
import { assertHealthyDependencies } from "../src/server/dependency-gate";

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

afterEach(() => {
  resetPoolErrorStateForTests();
});

test("assertHealthyDependencies passes when dependencies are healthy", () => {
  assert.doesNotThrow(() => assertHealthyDependencies());
});

test("assertHealthyDependencies throws internal AppError when pool is degraded", () => {
  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);

  mockPool.emit(new Error("idle client connection lost"));

  assert.throws(
    () => assertHealthyDependencies(),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "internal");
      assert.equal(error.status, 500);
      return true;
    },
  );
});

test("degraded dependencies keep health handlers online and fail gated API handlers", async () => {
  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);

  const gatedApiHandler = withApiHandler(async () => ({ message: "ok" }), {
    requireHealthyDependencies: true,
    cors: false,
  });
  const liveHandler = withApiHandler(async () => createHealthStatus(), { cors: false });
  const readinessProbe = createReadinessProbe();

  const healthyApiResponse = await gatedApiHandler(
    new NextRequest("http://localhost:3001/api/sample"),
    EMPTY_ROUTE_CONTEXT,
  );
  assert.equal(healthyApiResponse.status, 200);

  mockPool.emit(new Error("idle client connection lost"));

  const liveResponse = await liveHandler(
    new NextRequest("http://localhost:3001/health/live"),
    EMPTY_ROUTE_CONTEXT,
  );
  const livePayload = await readJson(liveResponse);
  assert.equal(liveResponse.status, 200);
  assert.deepStrictEqual(livePayload, {
    ok: true,
    service: "backend",
  });

  const readyStatus = await readinessProbe();
  assert.equal(readyStatus.ok, false);
  assert.equal(readyStatus.checks.database, "down");
  assert.equal(readyStatus.checks.migrations, "down");

  const degradedApiResponse = await gatedApiHandler(
    new NextRequest("http://localhost:3001/api/sample"),
    EMPTY_ROUTE_CONTEXT,
  );
  const degradedApiPayload = await readJson(degradedApiResponse);
  assert.equal(degradedApiResponse.status, 500);
  assert.deepStrictEqual(degradedApiPayload, {
    code: "internal",
    message: "Internal server error",
    status: 500,
  });
});