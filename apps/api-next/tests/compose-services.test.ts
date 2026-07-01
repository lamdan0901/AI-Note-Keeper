import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReminderSchedulerRuntime } from "@backend/reminders/runtime";

import type { SubscriptionReminderDispatchJob } from "@backend/jobs/subscriptions/dispatch-due-subscription-reminders";

import { createReadinessProbe } from "../src/server/compose-services";
import {
  composeServices,
  getComposedServices,
  resetComposedServicesForTests,
  setComposedServicesForTests,
  type ComposedServices,
} from "../src/server/compose-services-impl";
import { createComposedReminderRepairJob } from "../src/server/reminder-repair";

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
    assert.equal(services.reminderRepairJob, undefined);
    assert.equal(services.subscriptionReminderDispatchJob, undefined);
    assert.equal(services.pushJobHandler, undefined);
    assert.equal(services.pushRetryScheduler, undefined);
    assert.equal(services.pushQstashVerifierConfig, undefined);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.REMINDER_SCHEDULER_PROVIDER;
    } else {
      process.env.REMINDER_SCHEDULER_PROVIDER = previousProvider;
    }
  }
});

test("composeServices exposes reminder repair job when qstash scheduler is enabled", () => {
  const previousEnv = {
    provider: process.env.REMINDER_SCHEDULER_PROVIDER,
    callbackBaseUrl: process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL,
    token: process.env.QSTASH_TOKEN,
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
  };

  process.env.REMINDER_SCHEDULER_PROVIDER = "qstash";
  process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL = "https://api.example.test";
  process.env.QSTASH_TOKEN = "qstash-token";
  process.env.QSTASH_CURRENT_SIGNING_KEY = "current-signing-key";
  process.env.QSTASH_NEXT_SIGNING_KEY = "next-signing-key";

  try {
    const services = composeServices();

    assert.ok(services.reminderRepairJob);
    assert.equal(typeof services.reminderRepairJob.run, "function");
    assert.ok(services.reminderScheduledTaskExecutor);
    assert.ok(services.reminderQstashVerifierConfig);
    assert.ok(services.subscriptionReminderDispatchJob);
    assert.equal(typeof services.subscriptionReminderDispatchJob.run, "function");
    assert.ok(services.pushJobHandler);
    assert.equal(typeof services.pushJobHandler.handle, "function");
    assert.ok(services.pushRetryScheduler);
    assert.equal(typeof services.pushRetryScheduler.scheduleRetry, "function");
    assert.ok(services.pushQstashVerifierConfig);
    assert.equal(
      services.pushQstashVerifierConfig.callbackUrl,
      "https://api.example.test/internal/push/retry",
    );
  } finally {
    if (previousEnv.provider === undefined) {
      delete process.env.REMINDER_SCHEDULER_PROVIDER;
    } else {
      process.env.REMINDER_SCHEDULER_PROVIDER = previousEnv.provider;
    }

    if (previousEnv.callbackBaseUrl === undefined) {
      delete process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL;
    } else {
      process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL = previousEnv.callbackBaseUrl;
    }

    if (previousEnv.token === undefined) {
      delete process.env.QSTASH_TOKEN;
    } else {
      process.env.QSTASH_TOKEN = previousEnv.token;
    }

    if (previousEnv.currentSigningKey === undefined) {
      delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    } else {
      process.env.QSTASH_CURRENT_SIGNING_KEY = previousEnv.currentSigningKey;
    }

    if (previousEnv.nextSigningKey === undefined) {
      delete process.env.QSTASH_NEXT_SIGNING_KEY;
    } else {
      process.env.QSTASH_NEXT_SIGNING_KEY = previousEnv.nextSigningKey;
    }
  }
});

test("createComposedReminderRepairJob reuses runtime executor and scheduler service instances", async () => {
  const executed: string[] = [];
  const scheduled: string[] = [];
  const now = new Date("2026-06-13T10:10:00.000Z");
  const executor = {
    execute: async (payload: { reminderId: string; deliveryKey: string }) => {
      executed.push(`${payload.reminderId}:${payload.deliveryKey}`);
      return { status: "sent" as const };
    },
  };
  const schedulerService = {
    scheduleNextOccurrence: async () => {
      scheduled.push("next");
      return { scheduled: true };
    },
    cancelCurrentSchedule: async () => undefined,
    clearScheduleMetadata: async () => undefined,
  };
  const runtime = {
    remindersRepository: {
      listRepairCandidates: async () => [
        {
          id: "reminder-1",
          userId: "user-1",
          title: "Reminder",
          triggerAt: new Date("2026-06-13T10:00:00.000Z"),
          done: null,
          repeatRule: "none",
          repeatConfig: null,
          repeat: null,
          snoozedUntil: null,
          active: true,
          scheduleStatus: "scheduled",
          timezone: "UTC",
          baseAtLocal: null,
          startAt: null,
          nextTriggerAt: new Date("2026-06-13T10:05:00.000Z"),
          lastFiredAt: null,
          lastAcknowledgedAt: null,
          version: 2,
          scheduleProvider: null,
          scheduleTargetId: null,
          scheduleTargetVersion: null,
          scheduleTargetFireAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      findById: async () => null,
    },
    scheduledTaskExecutor: executor,
    schedulerService,
  } satisfies Pick<
    ReminderSchedulerRuntime,
    "remindersRepository" | "scheduledTaskExecutor" | "schedulerService"
  >;

  const repairJob = createComposedReminderRepairJob(runtime);
  const result = await repairJob.run();

  assert.equal(result.candidates, 1);
  assert.equal(result.executed, 1);
  assert.equal(executed.length, 1);
  assert.equal(scheduled.length, 0);
});

test("createReadinessProbe returns a callable readiness function", () => {
  const probe = createReadinessProbe();

  assert.equal(typeof probe, "function");
});

test("setComposedServicesForTests can inject subscriptionReminderDispatchJob double", async () => {
  resetComposedServicesForTests();

  const dispatchJob: SubscriptionReminderDispatchJob = {
    run: async () => ({
      cronKey: "check-subscription-reminders",
      since: new Date("2026-06-01T00:00:00.000Z"),
      now: new Date("2026-06-02T00:00:00.000Z"),
      scanned: 2,
      enqueued: 1,
      duplicates: 1,
    }),
  };

  const base = composeServices();
  setComposedServicesForTests({
    ...base,
    subscriptionReminderDispatchJob: dispatchJob,
  });

  const services = getComposedServices();
  const result = await services.subscriptionReminderDispatchJob?.run();

  assert.deepEqual(result, {
    cronKey: "check-subscription-reminders",
    since: new Date("2026-06-01T00:00:00.000Z"),
    now: new Date("2026-06-02T00:00:00.000Z"),
    scanned: 2,
    enqueued: 1,
    duplicates: 1,
  });

  resetComposedServicesForTests();
});