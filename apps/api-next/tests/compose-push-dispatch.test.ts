import assert from "node:assert/strict";
import { test } from "node:test";

import type { PushJobPayload } from "@backend/jobs/push/contracts";
import { createReminderSchedulerRuntime } from "@backend/reminders/runtime";
import { createReminderDeliveryKey } from "@backend/reminders/scheduler-service";

import { composePushDispatchServices } from "../src/server/compose-push-dispatch";

const withQstashEnv = <T>(run: () => T): T => {
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
    return run();
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
};

test("composePushDispatchServices re-instantiates scheduled task executor with retry-aware sender", () => {
  withQstashEnv(() => {
    const reminderRuntime = createReminderSchedulerRuntime();
    const composed = composePushDispatchServices({ reminderRuntime });

    assert.notEqual(
      composed.reminderScheduledTaskExecutor,
      reminderRuntime.scheduledTaskExecutor,
    );
    assert.equal(typeof composed.reminderScheduledTaskExecutor.execute, "function");
    assert.ok(composed.pushJobHandler);
    assert.ok(composed.pushRetryScheduler);
    assert.equal(
      composed.pushQstashVerifierConfig.callbackUrl,
      "https://api.example.test/internal/push/retry",
    );
  });
});

test("composePushDispatchServices reminder executor delegates multi-token push to injected handler", async () => {
  await withQstashEnv(async () => {
    const handled: PushJobPayload[] = [];
    const reminderRuntime = createReminderSchedulerRuntime();
    const composed = composePushDispatchServices({
      reminderRuntime,
      pushJobHandler: {
        handle: async (job) => {
          handled.push(job);
          return {
            processed: job.tokens.length,
            delivered: job.tokens.length,
            retriesScheduled: 0,
            unregisteredRemoved: 0,
            terminalFailures: 0,
          };
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
        listUserIdsWithTokens: async () => [],
        deleteByDeviceIdForUser: async () => true,
      },
    });

    const reminder = {
      id: "reminder-1",
      userId: "user-1",
      title: "Buy milk",
      content: null,
      contentType: "text" as const,
      triggerAt: new Date("2026-06-13T10:05:00.000Z"),
      done: false,
      repeatRule: null,
      repeatConfig: null,
      repeat: null,
      snoozedUntil: null,
      active: true,
      scheduleStatus: "scheduled" as const,
      timezone: "UTC",
      baseAtLocal: "2026-06-13T10:05:00",
      startAt: new Date("2026-06-13T10:05:00.000Z"),
      nextTriggerAt: new Date("2026-06-13T10:05:00.000Z"),
      lastFiredAt: null,
      lastAcknowledgedAt: null,
      scheduleProvider: "qstash",
      scheduleTargetId: "schedule-1",
      scheduleTargetVersion: 1,
      scheduleTargetFireAt: new Date("2026-06-13T10:05:00.000Z"),
      version: 1,
      createdAt: new Date("2026-06-13T10:00:00.000Z"),
      updatedAt: new Date("2026-06-13T10:00:00.000Z"),
    };

    const originalFindById = reminderRuntime.remindersRepository.findById.bind(
      reminderRuntime.remindersRepository,
    );
    reminderRuntime.remindersRepository.findById = async () => reminder;

    const originalAdvance = reminderRuntime.remindersRepository.advanceAfterDelivery.bind(
      reminderRuntime.remindersRepository,
    );
    reminderRuntime.remindersRepository.advanceAfterDelivery = async () => reminder;

    const originalInsertPending =
      reminderRuntime.deliveriesRepository.insertPending.bind(
        reminderRuntime.deliveriesRepository,
      );
    reminderRuntime.deliveriesRepository.insertPending = async (input) => {
      return {
        inserted: true,
        delivery: {
          id: "delivery-1",
          reminderId: input.reminderId,
          userId: input.userId,
          occurrenceAt: input.occurrenceAt,
          reminderVersion: input.reminderVersion,
          deliveryKey: input.deliveryKey,
          status: "pending",
          providerMessageId: null,
          attemptCount: 0,
          createdAt: new Date("2026-06-13T10:05:00.000Z"),
          sentAt: null,
          failureReason: null,
        },
      };
    };

    const originalMarkSent = reminderRuntime.deliveriesRepository.markSent.bind(
      reminderRuntime.deliveriesRepository,
    );
    reminderRuntime.deliveriesRepository.markSent = async () => undefined;

    const occurrenceAt = new Date("2026-06-13T10:05:00.000Z");
    const deliveryKey = createReminderDeliveryKey({
      reminderId: "reminder-1",
      occurrenceAt,
      version: 1,
    });

    try {
      const result = await composed.reminderScheduledTaskExecutor.execute({
        reminderId: "reminder-1",
        occurrenceAt: occurrenceAt.toISOString(),
        version: 1,
        deliveryKey,
      });

      assert.equal(result.status, "sent");
      assert.equal(handled.length, 1);
      assert.equal(handled[0].reminderId, "reminder-1");
      assert.equal(handled[0].changeEventId, deliveryKey);
      assert.equal(handled[0].tokens.length, 1);
    } finally {
      reminderRuntime.remindersRepository.findById = originalFindById;
      reminderRuntime.remindersRepository.advanceAfterDelivery = originalAdvance;
      reminderRuntime.deliveriesRepository.insertPending = originalInsertPending;
      reminderRuntime.deliveriesRepository.markSent = originalMarkSent;
    }
  });
});

test("composePushDispatchServices wires subscriptionReminderDispatchJob to composed pushJobHandler", () => {
  withQstashEnv(() => {
    const reminderRuntime = createReminderSchedulerRuntime();
    const composed = composePushDispatchServices({ reminderRuntime });

    assert.ok(composed.subscriptionReminderDispatchJob);
    assert.equal(typeof composed.subscriptionReminderDispatchJob.run, "function");
    assert.ok(composed.pushJobHandler);
    assert.ok(composed.pushRetryScheduler);
  });
});