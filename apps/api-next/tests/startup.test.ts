import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReadinessStatus } from "@backend/health/readiness";

import { runInitialStartupChecks } from "../src/server/startup";

const healthyReadiness = (): ReadinessStatus => ({
  ok: true,
  service: "backend",
  checks: { database: "up", migrations: "up" },
});

const unhealthyReadiness = (): ReadinessStatus => ({
  ok: false,
  service: "backend",
  checks: { database: "down", migrations: "down" },
});

test("runInitialStartupChecks retries before failing", async () => {
  let attempts = 0;

  await assert.rejects(
    () =>
      runInitialStartupChecks(async () => {
        attempts += 1;
        return unhealthyReadiness();
      }, { maxAttempts: 3, retryDelayMs: 0 }),
    /database connectivity and schema_migrations are required/,
  );

  assert.equal(attempts, 3);
});

test("runInitialStartupChecks includes actionable detail when migrations are missing", async () => {
  await assert.rejects(
    () =>
      runInitialStartupChecks(async () => ({
        ok: false,
        service: "backend",
        checks: { database: "up", migrations: "down" },
      })),
    /schema_migrations missing/,
  );
});

test("runInitialStartupChecks succeeds once readiness becomes healthy", async () => {
  let attempts = 0;

  await runInitialStartupChecks(async () => {
    attempts += 1;
    return attempts < 2 ? unhealthyReadiness() : healthyReadiness();
  }, { maxAttempts: 3, retryDelayMs: 0 });

  assert.equal(attempts, 2);
});