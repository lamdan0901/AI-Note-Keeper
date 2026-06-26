import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, before, afterEach, test } from "node:test";

import { createHealthStatus } from "@backend/health.js";

import {
  attachSoftPoolErrorHandling,
  resetPoolErrorStateForTests,
  type PoolErrorEventTarget,
} from "../src/db/pool";
import {
  getHealthLive,
  getHealthReady,
  startNextTestServer,
  type NextTestServer,
} from "./support/next-test-server";

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

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  return (await response.json()) as Record<string, unknown>;
};

let server: NextTestServer;

before(async () => {
  server = await startNextTestServer();
});

after(async () => {
  await server.close();
});

afterEach(() => {
  resetPoolErrorStateForTests();
});

test("GET /health/live returns createHealthStatus payload via in-process Next handler", async () => {
  const response = await getHealthLive(server);
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepStrictEqual(payload, createHealthStatus());
});

test("GET /health/ready returns 503 when dependencyDegraded is mocked", async () => {
  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);
  mockPool.emit(new Error("Connection terminated unexpectedly"));

  const response = await getHealthReady(server);
  const payload = await readJson(response);

  assert.equal(response.status, 503);
  assert.equal(payload.ok, false);
  assert.equal(payload.service, "backend");
  assert.deepStrictEqual(payload.checks, {
    database: "down",
    migrations: "down",
  });
});