import assert from "node:assert/strict";
import { test } from "node:test";

import { createHealthStatus } from "@backend/health";

import { handleCorsPreflight } from "../src/http/cors";
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
import { EventEmitter } from "node:events";

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

test("Phase 0 exit: /health/live matches createHealthStatus contract", async () => {
  const server: NextTestServer = await startNextTestServer();

  try {
    const response = await getHealthLive(server);
    const payload = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.deepStrictEqual(payload, createHealthStatus());
  } finally {
    await server.close();
  }
});

test("Phase 0 exit: pool idle error does not call process.exit and readiness returns 503", async () => {
  const server: NextTestServer = await startNextTestServer();
  const mockPool = createMockPool();
  const exitCalls: number[] = [];
  const originalExit = process.exit;

  try {
    mockPool.on("error", () => {
      process.exit(-1);
    });
    attachSoftPoolErrorHandling(mockPool);
    process.exit = ((code?: number) => {
      exitCalls.push(code ?? 0);
    }) as typeof process.exit;

    mockPool.emit(new Error("idle client connection lost"));

    const response = await getHealthReady(server);
    const payload = (await response.json()) as Record<string, unknown>;

    assert.deepEqual(exitCalls, []);
    assert.equal(response.status, 503);
    assert.equal(payload.ok, false);
    assert.deepStrictEqual(payload.checks, {
      database: "down",
      migrations: "down",
    });
  } finally {
    process.exit = originalExit;
    resetPoolErrorStateForTests();
    await server.close();
  }
});

test("Phase 0 exit: CORS preflight from localhost:5173 succeeds with credentials headers", () => {
  const snapshot = {
    nodeEnv: process.env.NODE_ENV,
    corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS,
  };

  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.NODE_ENV;

  try {
    const request = new Request("http://localhost:3001/health/live", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
      },
    });

    const response = handleCorsPreflight(request);

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
    assert.ok(response.headers.get("Access-Control-Allow-Methods")?.includes("GET"));
  } finally {
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
  }
});