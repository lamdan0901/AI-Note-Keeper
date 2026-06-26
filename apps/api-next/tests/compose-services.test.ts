import assert from "node:assert/strict";
import { test } from "node:test";

import {
  composeServices,
  createReadinessProbe,
  type ComposedServices,
} from "../src/server/compose-services";

const requiredServiceKeys: Array<keyof ComposedServices> = [
  "authService",
  "notesService",
  "remindersService",
  "subscriptionsService",
  "expensesService",
  "deviceTokensService",
  "mergeService",
  "aiService",
  "aiRateLimiter",
];

test("composeServices returns the full default service graph", () => {
  const services = composeServices();

  for (const key of requiredServiceKeys) {
    assert.ok(services[key], `expected composed service "${key}"`);
  }
});

test("composeServices omits reminder callback wiring when scheduler is disabled", () => {
  const previousProvider = process.env.REMINDER_SCHEDULER_PROVIDER;
  process.env.REMINDER_SCHEDULER_PROVIDER = "disabled";

  try {
    const services = composeServices();

    assert.equal(services.reminderScheduledTaskExecutor, undefined);
    assert.equal(services.reminderQstashVerifierConfig, undefined);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.REMINDER_SCHEDULER_PROVIDER;
    } else {
      process.env.REMINDER_SCHEDULER_PROVIDER = previousProvider;
    }
  }
});

test("createReadinessProbe returns a callable readiness function", () => {
  const probe = createReadinessProbe();

  assert.equal(typeof probe, "function");
});