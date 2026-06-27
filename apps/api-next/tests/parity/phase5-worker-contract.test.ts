import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, test } from "node:test";

import {
  attachSoftPoolErrorHandling,
  resetPoolErrorStateForTests,
  type PoolErrorEventTarget,
} from "../../src/db/pool";
import { startMergeTestServer } from "../support/merge-test-server";

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

const mergePreflightBody = (): string =>
  JSON.stringify({
    toUserId: "target-user",
    username: "alice",
    password: "password",
  });

afterEach(() => {
  resetPoolErrorStateForTests();
});

test("phase-5 worker contract: merge routes stay behind dependency gate and auth middleware ordering", async () => {
  const server = await startMergeTestServer();

  try {
    const healthyResponse = await server.fetch("/api/merge/preflight", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: mergePreflightBody(),
    });

    assert.equal(healthyResponse.status, 401);
    const healthyPayload = (await healthyResponse.json()) as {
      code: string;
      status: number;
    };
    assert.equal(healthyPayload.code, "auth");
    assert.equal(healthyPayload.status, 401);

    const mockPool = createMockPool();
    attachSoftPoolErrorHandling(mockPool);
    mockPool.emit(new Error("idle client connection lost"));

    const degradedResponse = await server.fetch("/api/merge/preflight", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: mergePreflightBody(),
    });

    assert.equal(degradedResponse.status, 500);
    const degradedPayload = (await degradedResponse.json()) as {
      code: string;
      status: number;
    };
    assert.equal(degradedPayload.code, "internal");
    assert.equal(degradedPayload.status, 500);
  } finally {
    await server.close();
  }
});