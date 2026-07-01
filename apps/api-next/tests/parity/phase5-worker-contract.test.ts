import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, test } from "node:test";

process.env.DATABASE_URL ??= "postgres://localhost:5432/ai-note-keeper-test";

import { NextRequest } from "next/server";

import { createHealthStatus } from "@backend/health.js";
import type {
  PushDeliveryRequest,
  PushDeliveryResult,
  PushJobPayload,
  PushRetryScheduler,
} from "@backend/jobs/push/contracts";
import { createPushJobHandler } from "@backend/jobs/push/push-job-handler";
import { createSubscriptionReminderDispatchJob } from "@backend/jobs/subscriptions/dispatch-due-subscription-reminders";

import { GET as remindersRepairCronGet } from "../../app/cron/reminders-repair/route";
import { GET as subscriptionsDispatchCronGet } from "../../app/cron/subscriptions-dispatch/route";
import { POST as pushRetryRoutePost } from "../../app/internal/push/retry/route";
import {
  attachSoftPoolErrorHandling,
  resetPoolErrorStateForTests,
  type PoolErrorEventTarget,
} from "../../src/db/pool";
import {
  composeServices,
  resetComposedServicesForTests,
  setComposedServicesForTests,
} from "../../src/server/compose-services-impl";
import { getMaintenanceTelemetry } from "../../src/server/maintenance-telemetry";
import {
  createInMemoryJobKeyDeduper,
  createSubscriptionPushEnqueueBridge,
} from "../../src/server/push-dispatch";
import { getHealthLive, getHealthReady, startNextTestServer } from "../support/next-test-server";
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

const qstashEnv = {
  provider: "qstash",
  callbackBaseUrl: "https://api.example.test",
  token: "qstash-token",
  currentSigningKey: "current-signing-key",
  nextSigningKey: "next-signing-key",
} as const;

const saveQstashEnv = (): Record<string, string | undefined> => ({
  provider: process.env.REMINDER_SCHEDULER_PROVIDER,
  callbackBaseUrl: process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL,
  token: process.env.QSTASH_TOKEN,
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
});

const restoreQstashEnv = (saved: Record<string, string | undefined>): void => {
  for (const [key, value] of Object.entries(saved)) {
    const envKey =
      key === "provider"
        ? "REMINDER_SCHEDULER_PROVIDER"
        : key === "callbackBaseUrl"
          ? "REMINDER_SCHEDULER_CALLBACK_BASE_URL"
          : key === "token"
            ? "QSTASH_TOKEN"
            : key === "currentSigningKey"
              ? "QSTASH_CURRENT_SIGNING_KEY"
              : "QSTASH_NEXT_SIGNING_KEY";

    if (value === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = value;
    }
  }
};

const applyQstashEnv = (): void => {
  process.env.REMINDER_SCHEDULER_PROVIDER = qstashEnv.provider;
  process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL = qstashEnv.callbackBaseUrl;
  process.env.QSTASH_TOKEN = qstashEnv.token;
  process.env.QSTASH_CURRENT_SIGNING_KEY = qstashEnv.currentSigningKey;
  process.env.QSTASH_NEXT_SIGNING_KEY = qstashEnv.nextSigningKey;
};

const notFoundPayload = {
  code: "not_found",
  message: "Not found",
  status: 404,
} as const;

afterEach(() => {
  resetPoolErrorStateForTests();
  resetComposedServicesForTests();
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

test("phase-5 worker contract: maintenance cron paths configured without worker bootstrap", () => {
  const saved = saveQstashEnv();
  applyQstashEnv();
  resetComposedServicesForTests();

  try {
    const services = composeServices();
    const telemetry = getMaintenanceTelemetry(services);

    assert.deepEqual(telemetry, {
      remindersRepair: true,
      subscriptionsDispatch: true,
      pushRetryCallback: true,
    });
    assert.equal(typeof services.reminderRepairJob?.run, "function");
    assert.equal(typeof services.subscriptionReminderDispatchJob?.run, "function");
    assert.equal(typeof services.pushJobHandler?.handle, "function");
    assert.equal(typeof services.pushRetryScheduler?.scheduleRetry, "function");
  } finally {
    restoreQstashEnv(saved);
    resetComposedServicesForTests();
  }
});

test("phase-5 worker contract: maintenance cron routes return 404 when scheduler is disabled", async () => {
  const saved = saveQstashEnv();
  process.env.REMINDER_SCHEDULER_PROVIDER = "disabled";
  resetComposedServicesForTests();
  setComposedServicesForTests(composeServices());

  try {
    const repairResponse = await remindersRepairCronGet(
      new NextRequest("http://localhost/cron/reminders-repair"),
    );
    assert.equal(repairResponse.status, 404);
    assert.deepEqual(await repairResponse.json(), notFoundPayload);

    const dispatchResponse = await subscriptionsDispatchCronGet(
      new NextRequest("http://localhost/cron/subscriptions-dispatch"),
    );
    assert.equal(dispatchResponse.status, 404);
    assert.deepEqual(await dispatchResponse.json(), notFoundPayload);

    const pushRetryResponse = await pushRetryRoutePost(
      new NextRequest("http://localhost/internal/push/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attempt: 1 }),
      }),
    );
    assert.equal(pushRetryResponse.status, 404);
    assert.deepEqual(await pushRetryResponse.json(), notFoundPayload);

    assert.deepEqual(getMaintenanceTelemetry(composeServices()), {
      remindersRepair: false,
      subscriptionsDispatch: false,
      pushRetryCallback: false,
    });
  } finally {
    restoreQstashEnv(saved);
    resetComposedServicesForTests();
  }
});

test("phase-5 worker contract: /health/ready shape excludes maintenance telemetry", async () => {
  const server = await startNextTestServer();
  const mockPool = createMockPool();

  try {
    attachSoftPoolErrorHandling(mockPool);
    mockPool.emit(new Error("idle client connection lost"));

    const response = await getHealthReady(server);
    const payload = (await response.json()) as Record<string, unknown>;

    assert.deepEqual(Object.keys(payload).sort(), ["checks", "ok", "service"]);
    assert.equal(typeof payload.ok, "boolean");
    assert.equal(payload.service, "backend");

    const checks = payload.checks as Record<string, unknown>;
    assert.deepEqual(Object.keys(checks).sort(), ["database", "migrations"]);
    assert.ok(checks.database === "up" || checks.database === "down");
    assert.ok(checks.migrations === "up" || checks.migrations === "down");
  } finally {
    await server.close();
  }
});

test("phase-5 worker contract: /health/live serves 200 without worker process", async () => {
  const server = await startNextTestServer();

  try {
    const response = await getHealthLive(server);
    const payload = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.deepEqual(payload, createHealthStatus());
  } finally {
    await server.close();
  }
});

const createIdempotentDispatchFixture = () => {
  const handled: PushJobPayload[] = [];
  const scheduledRetries: Array<{ delayMs: number }> = [];

  const deliveryService = {
    deliverToToken: async (request: PushDeliveryRequest): Promise<PushDeliveryResult> => {
      if (request.attempt === 0) {
        return { classification: "transient_failure", statusCode: 429 };
      }

      return { classification: "delivered" };
    },
  };

  const retryScheduler: PushRetryScheduler = {
    scheduleRetry: async (input) => {
      scheduledRetries.push({ delayMs: input.delayMs });
    },
  };

  const pushJobHandler = createPushJobHandler({
    deliveryService,
    deviceTokensRepository: {
      deleteByDeviceIdForUser: async () => true,
    },
    retryScheduler,
    terminalFailureRecorder: {
      record: async () => undefined,
    },
  });

  const jobKeyDeduper = createInMemoryJobKeyDeduper();
  const subscriptionQueue = createSubscriptionPushEnqueueBridge({
    pushJobHandler: {
      handle: async (job) => {
        handled.push(job);
        return pushJobHandler.handle(job);
      },
    },
    deviceTokensRepository: {
      listByUserId: async () => [
        {
          id: "token-row-1",
          deviceId: "device-1",
          fcmToken: "token-1",
          userId: "user-1",
          platform: "android",
          createdAt: new Date("2026-05-20T12:00:00.000Z"),
          updatedAt: new Date("2026-05-20T12:00:00.000Z"),
        },
      ],
    },
    jobKeyDeduper,
  });

  const dispatchJob = createSubscriptionReminderDispatchJob({
    now: () => new Date("2026-05-24T12:00:00.000Z"),
    cronStateRepository: {
      getLastCheckedAt: async () => new Date("2026-05-24T11:58:00.000Z"),
      upsertLastCheckedAt: async () => undefined,
    },
    scanner: {
      scanDueReminders: async ({ now, lastCheckedAt }) => ({
        now,
        since: lastCheckedAt ?? now,
        reminders: [
          {
            subscriptionId: "sub-1",
            userId: "user-1",
            kind: "billing",
            triggerTime: new Date("2026-05-24T12:00:00.000Z"),
            anchorDate: new Date("2026-05-27T12:00:00.000Z"),
            title: "Netflix billing reminder",
            body: "Netflix bills in 3 days ($19.99).",
          },
        ],
      }),
    },
    queue: subscriptionQueue,
    stateRepository: {
      markBillingReminderSent: async () => undefined,
      markTrialReminderSent: async () => undefined,
    },
  });

  return {
    dispatchJob,
    handled,
    scheduledRetries,
  };
};

test("phase-5 worker contract: restart and retry simulation preserves idempotent dispatch side effects", async () => {
  const { dispatchJob, handled, scheduledRetries } = createIdempotentDispatchFixture();

  const firstRun = await dispatchJob.run();
  const secondRun = await dispatchJob.run();

  assert.equal(firstRun.enqueued, 1);
  assert.equal(firstRun.duplicates, 0);
  assert.equal(secondRun.enqueued, 0);
  assert.equal(secondRun.duplicates, 1);
  assert.equal(handled.length, 1);
  assert.equal(scheduledRetries.length, 1);
  assert.equal(scheduledRetries[0]?.delayMs, 30_000);
});