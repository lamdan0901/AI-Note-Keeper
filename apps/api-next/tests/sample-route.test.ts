import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, afterEach, before, test } from "node:test";

import {
  attachSoftPoolErrorHandling,
  resetPoolErrorStateForTests,
  type PoolErrorEventTarget,
} from "../src/db/pool";
import {
  getSample,
  startNextTestServer,
  type NextTestServer,
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

const restoreEnv = (
  snapshot: Readonly<{ nodeEnv?: string; corsAllowedOrigins?: string }>,
): void => {
  if (snapshot.nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = snapshot.nodeEnv;
  }

  if (snapshot.corsAllowedOrigins === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = snapshot.corsAllowedOrigins;
  }
};

const snapshotEnv = (): Readonly<{ nodeEnv?: string; corsAllowedOrigins?: string }> => ({
  nodeEnv: process.env.NODE_ENV,
  corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS,
});

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

test("GET /api/sample returns Express-compatible hello payload when dependencies are healthy", async () => {
  const response = await getSample(server);
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepStrictEqual(payload, { message: "Hello from the backend API!" });
});

test("GET /api/sample returns 500 internal when dependencies are degraded", async () => {
  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);
  mockPool.emit(new Error("idle client connection lost"));

  const response = await getSample(server);
  const payload = await readJson(response);

  assert.equal(response.status, 500);
  assert.deepStrictEqual(payload, {
    code: "internal",
    message: "Internal server error",
    status: 500,
  });
});

test("GET /api/sample includes CORS headers for allowed dev origins", async () => {
  const snapshot = snapshotEnv();
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.NODE_ENV;

  try {
    const response = await server.fetch("/api/sample", {
      headers: { Origin: "http://localhost:5173" },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  } finally {
    restoreEnv(snapshot);
  }
});