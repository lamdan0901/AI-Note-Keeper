import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, test } from "node:test";

import {
  attachSoftPoolErrorHandling,
  isDependencyDegraded,
  resetPoolErrorStateForTests,
  type PoolErrorEventTarget,
} from "../src/db/pool";

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

let exitCalls: number[] = [];
const originalExit = process.exit;

afterEach(() => {
  process.exit = originalExit;
  exitCalls = [];
  resetPoolErrorStateForTests();
});

test("attachSoftPoolErrorHandling replaces fatal listener and sets degraded flag", () => {
  const mockPool = createMockPool();
  let degraded = false;

  mockPool.on("error", () => {
    process.exit(-1);
  });

  attachSoftPoolErrorHandling(mockPool, {
    onDependencyDegraded: () => {
      degraded = true;
    },
  });

  process.exit = ((code?: number) => {
    exitCalls.push(code ?? 0);
  }) as typeof process.exit;

  mockPool.emit(new Error("idle client connection lost"));

  assert.deepEqual(exitCalls, []);
  assert.equal(degraded, true);
  assert.equal(isDependencyDegraded(), true);
});

test("attachSoftPoolErrorHandling logs default degraded message when no callback", () => {
  const mockPool = createMockPool();
  const logged: Array<{ message: string; error: unknown }> = [];

  attachSoftPoolErrorHandling(mockPool, {
    logger: {
      error: (message, error) => {
        logged.push({ message, error });
      },
    },
  });

  const idleError = new Error("idle client connection lost");
  mockPool.emit(idleError);

  assert.equal(logged.length, 1);
  assert.equal(logged[0]?.message, "[backend] database dependency degraded");
  assert.equal(logged[0]?.error, idleError);
});