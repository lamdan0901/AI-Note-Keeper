import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  PushDeliveryRequest,
  PushDeliveryResult,
  PushDeliveryService,
  PushJobPayload,
  PushRetryScheduler,
} from "@backend/jobs/push/contracts";
import { createPushJobHandler } from "@backend/jobs/push/push-job-handler";
import { createSubscriptionReminderDispatchJob } from "@backend/jobs/subscriptions/dispatch-due-subscription-reminders";
import type { SubscriptionReminderDispatchQueueJob } from "@backend/jobs/subscriptions/contracts";
import type { ReminderRecord, ReminderSchedulerPayload } from "@backend/reminders/contracts";
import { createScheduledTaskExecutor } from "@backend/reminders/scheduled-task-executor";
import { createReminderDeliveryKey } from "@backend/reminders/scheduler-service";

import {
  createComposedPushJobHandler,
  createInMemoryJobKeyDeduper,
  createPushDispatchConcurrencyLimiter,
  createRetryAwareReminderNotificationSender,
  createSubscriptionPushEnqueueBridge,
} from "../src/server/push-dispatch";

const createSubscriptionJob = (
  overrides: Partial<SubscriptionReminderDispatchQueueJob> = {},
): SubscriptionReminderDispatchQueueJob => ({
  subscriptionId: "sub-1",
  userId: "user-1",
  kind: "billing",
  triggerTime: new Date("2026-05-24T12:00:00.000Z"),
  anchorDate: new Date("2026-05-27T12:00:00.000Z"),
  eventId: "event-1",
  jobKey: "event-1",
  title: "Netflix billing reminder",
  body: "Netflix bills in 3 days.",
  ...overrides,
});

const createReminder = (): ReminderRecord => ({
  id: "reminder-1",
  userId: "user-1",
  title: "Buy milk",
  content: "2% organic",
  contentType: "text",
  triggerAt: new Date("2026-05-24T12:00:00.000Z"),
  done: false,
  repeatRule: null,
  repeatConfig: null,
  repeat: null,
  snoozedUntil: null,
  active: true,
  scheduleStatus: "scheduled",
  timezone: "America/New_York",
  baseAtLocal: "2026-05-24T09:00:00",
  startAt: new Date("2026-05-24T12:00:00.000Z"),
  nextTriggerAt: new Date("2026-05-24T12:00:00.000Z"),
  lastFiredAt: null,
  lastAcknowledgedAt: null,
  scheduleProvider: "qstash",
  scheduleTargetId: "schedule-1",
  scheduleTargetVersion: 1,
  scheduleTargetFireAt: new Date("2026-05-24T12:00:00.000Z"),
  version: 1,
  createdAt: new Date("2026-05-20T12:00:00.000Z"),
  updatedAt: new Date("2026-05-20T12:00:00.000Z"),
});

test("createInMemoryJobKeyDeduper returns duplicate for repeated jobKey", () => {
  const deduper = createInMemoryJobKeyDeduper();

  assert.deepEqual(deduper.tryEnqueue("job-key-1"), { status: "enqueued" });
  assert.deepEqual(deduper.tryEnqueue("job-key-1"), { status: "duplicate" });
  assert.deepEqual(deduper.tryEnqueue("job-key-2"), { status: "enqueued" });
});

test("createInMemoryJobKeyDeduper allows replay after retention window", () => {
  let nowMs = 1_000_000;
  const deduper = createInMemoryJobKeyDeduper({
    now: () => nowMs,
    retentionWindowMs: 1_000,
    maxKeys: 1,
  });

  assert.deepEqual(deduper.tryEnqueue("job-key-1"), { status: "enqueued" });
  nowMs += 2_000;
  assert.deepEqual(deduper.tryEnqueue("job-key-2"), { status: "enqueued" });
  assert.deepEqual(deduper.tryEnqueue("job-key-1"), { status: "enqueued" });
});

test("createSubscriptionPushEnqueueBridge dispatches push with subscription reminder id", async () => {
  const handled: PushJobPayload[] = [];
  const pushJobHandler = {
    handle: async (job: PushJobPayload) => {
      handled.push(job);
      return {
        processed: job.tokens.length,
        delivered: job.tokens.length,
        retriesScheduled: 0,
        unregisteredRemoved: 0,
        terminalFailures: 0,
      };
    },
  };

  const bridge = createSubscriptionPushEnqueueBridge({
    pushJobHandler,
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
    jobKeyDeduper: createInMemoryJobKeyDeduper(),
  });

  const result = await bridge.enqueue(createSubscriptionJob());

  assert.equal(result.status, "enqueued");
  assert.equal(handled.length, 1);
  assert.equal(handled[0].reminderId, "subscription:sub-1:billing");
  assert.equal(handled[0].changeEventId, "event-1");
  assert.equal(handled[0].attempt, 0);
  assert.equal(handled[0].tokens.length, 1);
});

test("createSubscriptionPushEnqueueBridge skips duplicate jobKey without push", async () => {
  let handleCalls = 0;
  const pushJobHandler = {
    handle: async () => {
      handleCalls += 1;
      return {
        processed: 0,
        delivered: 0,
        retriesScheduled: 0,
        unregisteredRemoved: 0,
        terminalFailures: 0,
      };
    },
  };
  const deduper = createInMemoryJobKeyDeduper();

  const bridge = createSubscriptionPushEnqueueBridge({
    pushJobHandler,
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
    jobKeyDeduper: deduper,
  });

  const job = createSubscriptionJob();
  assert.equal((await bridge.enqueue(job)).status, "enqueued");
  assert.equal((await bridge.enqueue(job)).status, "duplicate");
  assert.equal(handleCalls, 1);
});

test("createSubscriptionPushEnqueueBridge returns enqueued when user has no tokens", async () => {
  let handleCalls = 0;
  const bridge = createSubscriptionPushEnqueueBridge({
    pushJobHandler: {
      handle: async () => {
        handleCalls += 1;
        return {
          processed: 0,
          delivered: 0,
          retriesScheduled: 0,
          unregisteredRemoved: 0,
          terminalFailures: 0,
        };
      },
    },
    deviceTokensRepository: {
      listByUserId: async () => [],
    },
    jobKeyDeduper: createInMemoryJobKeyDeduper(),
  });

  const result = await bridge.enqueue(createSubscriptionJob());

  assert.equal(result.status, "enqueued");
  assert.equal(handleCalls, 0);
});

test("createPushDispatchConcurrencyLimiter serializes dispatches at max concurrency 1", async () => {
  const limiter = createPushDispatchConcurrencyLimiter(1);
  const events: string[] = [];

  const first = (async () => {
    await limiter.acquire();
    events.push("first-start");
    await new Promise((resolve) => setTimeout(resolve, 20));
    events.push("first-end");
    limiter.release();
  })();

  const second = (async () => {
    await limiter.acquire();
    events.push("second-start");
    limiter.release();
  })();

  await Promise.all([first, second]);

  assert.deepEqual(events, ["first-start", "first-end", "second-start"]);
});

test("createRetryAwareReminderNotificationSender passes full multi-token payload to pushJobHandler", async () => {
  const handled: PushJobPayload[] = [];
  const sender = createRetryAwareReminderNotificationSender({
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
        {
          id: "token-row-2",
          deviceId: "device-2",
          fcmToken: "token-2",
          userId: "user-1",
          platform: "android",
          createdAt: new Date("2026-05-20T12:00:00.000Z"),
          updatedAt: new Date("2026-05-20T12:00:00.000Z"),
        },
      ],
    },
  });

  await sender.sendReminderNotification({
    reminder: createReminder(),
    deliveryKey: "delivery-key-1",
    attempt: 0,
  });

  assert.equal(handled.length, 1);
  assert.equal(handled[0].reminderId, "reminder-1");
  assert.equal(handled[0].changeEventId, "delivery-key-1");
  assert.equal(handled[0].isTrigger, true);
  assert.equal(handled[0].attempt, 0);
  assert.equal(handled[0].tokens.length, 2);
  assert.equal(handled[0].tokens[0].deviceId, "device-1");
  assert.equal(handled[0].tokens[1].deviceId, "device-2");
});

test("createRetryAwareReminderNotificationSender returns sent when push delivers", async () => {
  const sender = createRetryAwareReminderNotificationSender({
    pushJobHandler: {
      handle: async () => ({
        processed: 2,
        delivered: 2,
        retriesScheduled: 0,
        unregisteredRemoved: 0,
        terminalFailures: 0,
      }),
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
        {
          id: "token-row-2",
          deviceId: "device-2",
          fcmToken: "token-2",
          userId: "user-1",
          platform: "android",
          createdAt: new Date("2026-05-20T12:00:00.000Z"),
          updatedAt: new Date("2026-05-20T12:00:00.000Z"),
        },
      ],
    },
  });

  const result = await sender.sendReminderNotification({
    reminder: createReminder(),
    deliveryKey: "delivery-key-1",
    attempt: 0,
  });

  assert.equal(result.status, "sent");
  assert.equal(result.delivered, 2);
});

test("createRetryAwareReminderNotificationSender returns sent when retries are scheduled", async () => {
  const sender = createRetryAwareReminderNotificationSender({
    pushJobHandler: {
      handle: async () => ({
        processed: 1,
        delivered: 0,
        retriesScheduled: 1,
        unregisteredRemoved: 0,
        terminalFailures: 0,
      }),
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
  });

  const result = await sender.sendReminderNotification({
    reminder: createReminder(),
    deliveryKey: "delivery-key-1",
    attempt: 0,
  });

  assert.equal(result.status, "sent");
  assert.equal(result.providerMessageId, "retries:1");
});

test("createRetryAwareReminderNotificationSender returns failed when no device tokens", async () => {
  const sender = createRetryAwareReminderNotificationSender({
    pushJobHandler: {
      handle: async () => ({
        processed: 0,
        delivered: 0,
        retriesScheduled: 0,
        unregisteredRemoved: 0,
        terminalFailures: 0,
      }),
    },
    deviceTokensRepository: {
      listByUserId: async () => [],
    },
  });

  const result = await sender.sendReminderNotification({
    reminder: createReminder(),
    deliveryKey: "delivery-key-1",
    attempt: 0,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "no_device_tokens");
});

test("createComposedPushJobHandler delivers via injected push provider", async () => {
  const handler = createComposedPushJobHandler({
    pushProvider: {
      sendToToken: async () => ({ ok: true }),
    },
    deviceTokensRepository: {
      deleteByDeviceIdForUser: async () => true,
    },
    retryScheduler: {
      scheduleRetry: async () => undefined,
    },
  });

  const result = await handler.handle({
    userId: "user-1",
    reminderId: "reminder-1",
    changeEventId: "event-1",
    attempt: 0,
    tokens: [{ deviceId: "device-1", fcmToken: "token-1" }],
  });

  assert.equal(result.delivered, 1);
});

const createScheduledReminderPayload = (
  reminder: ReminderRecord,
): ReminderSchedulerPayload => {
  const occurrenceAt = reminder.nextTriggerAt ?? reminder.triggerAt;
  return {
    reminderId: reminder.id,
    occurrenceAt: occurrenceAt.toISOString(),
    version: reminder.version,
    deliveryKey: createReminderDeliveryKey({
      reminderId: reminder.id,
      occurrenceAt,
      version: reminder.version,
    }),
  };
};

test("retry-aware scheduled task executor schedules retries on transient FCM failure", async () => {
  const scheduledRetries: Array<{ delayMs: number }> = [];
  const reminder = createReminder();
  const payload = createScheduledReminderPayload(reminder);

  const deliveryService: PushDeliveryService = {
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

  const sender = createRetryAwareReminderNotificationSender({
    pushJobHandler,
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
  });

  const events: string[] = [];
  const executor = createScheduledTaskExecutor({
    remindersRepository: {
      findById: async () => reminder,
      advanceAfterDelivery: async () => {
        events.push("advance");
        return reminder;
      },
    },
    deliveriesRepository: {
      insertPending: async () => {
        events.push("insert");
        return {
          inserted: true,
          delivery: {
            id: "delivery-1",
            reminderId: reminder.id,
            userId: reminder.userId,
            occurrenceAt: reminder.nextTriggerAt ?? reminder.triggerAt,
            reminderVersion: reminder.version,
            deliveryKey: payload.deliveryKey,
            status: "pending",
            providerMessageId: null,
            attemptCount: 0,
            createdAt: new Date("2026-05-20T12:00:00.000Z"),
            sentAt: null,
            failureReason: null,
          },
        };
      },
      markSent: async () => {
        events.push("mark-sent");
      },
      markFailed: async () => {
        events.push("mark-failed");
      },
      markCanceled: async () => undefined,
      markStale: async () => undefined,
    },
    notificationSender: sender,
    schedulerService: {
      scheduleNextOccurrence: async () => ({ scheduled: false }),
      cancelCurrentSchedule: async () => undefined,
      clearScheduleMetadata: async () => undefined,
    },
  });

  const result = await executor.execute(payload);

  assert.equal(result.status, "sent");
  assert.equal(scheduledRetries.length, 1);
  assert.equal(scheduledRetries[0]?.delayMs, 30_000);
  assert.deepEqual(events, ["insert", "mark-sent", "advance"]);
});

test("retry-aware scheduled task executor short-circuits duplicate deliveries before push", async () => {
  const reminder = createReminder();
  const payload = createScheduledReminderPayload(reminder);
  let handleCalls = 0;

  const sender = createRetryAwareReminderNotificationSender({
    pushJobHandler: {
      handle: async () => {
        handleCalls += 1;
        return {
          processed: 0,
          delivered: 0,
          retriesScheduled: 0,
          unregisteredRemoved: 0,
          terminalFailures: 0,
        };
      },
    },
    deviceTokensRepository: {
      listByUserId: async () => [],
    },
  });

  const executor = createScheduledTaskExecutor({
    remindersRepository: {
      findById: async () => reminder,
      advanceAfterDelivery: async () => reminder,
    },
    deliveriesRepository: {
      insertPending: async () => ({
        inserted: false,
        delivery: {
          id: "delivery-1",
          reminderId: reminder.id,
          userId: reminder.userId,
          occurrenceAt: reminder.nextTriggerAt ?? reminder.triggerAt,
          reminderVersion: reminder.version,
          deliveryKey: payload.deliveryKey,
          status: "pending",
          providerMessageId: null,
          attemptCount: 0,
          createdAt: new Date("2026-05-20T12:00:00.000Z"),
          sentAt: null,
          failureReason: null,
        },
      }),
      markSent: async () => undefined,
      markFailed: async () => undefined,
      markCanceled: async () => undefined,
      markStale: async () => undefined,
    },
    notificationSender: sender,
    schedulerService: {
      scheduleNextOccurrence: async () => ({ scheduled: false }),
      cancelCurrentSchedule: async () => undefined,
      clearScheduleMetadata: async () => undefined,
    },
  });

  const result = await executor.execute(payload);

  assert.equal(result.status, "duplicate");
  assert.equal(handleCalls, 0);
});

const createWiredSubscriptionDispatchFixture = () => {
  const handled: PushJobPayload[] = [];
  const scheduledRetries: Array<{ delayMs: number }> = [];

  const deliveryService: PushDeliveryService = {
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
        {
          id: "token-row-2",
          deviceId: "device-2",
          fcmToken: "token-2",
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

test("wired subscription dispatch pushes all user device tokens via pushJobHandler", async () => {
  const { dispatchJob, handled } = createWiredSubscriptionDispatchFixture();

  const result = await dispatchJob.run();

  assert.equal(result.scanned, 1);
  assert.equal(result.enqueued, 1);
  assert.equal(result.duplicates, 0);
  assert.equal(handled.length, 1);
  assert.equal(handled[0].reminderId, "subscription:sub-1:billing");
  assert.equal(handled[0].tokens.length, 2);
  assert.equal(handled[0].tokens[0].deviceId, "device-1");
  assert.equal(handled[0].tokens[1].deviceId, "device-2");
});

test("wired subscription dispatch schedules QStash retry on transient FCM failure", async () => {
  const { dispatchJob, scheduledRetries } = createWiredSubscriptionDispatchFixture();

  await dispatchJob.run();

  assert.equal(scheduledRetries.length, 2);
  assert.equal(scheduledRetries[0]?.delayMs, 30_000);
  assert.equal(scheduledRetries[1]?.delayMs, 30_000);
});

test("wired subscription dispatch duplicate cron run does not double-send push", async () => {
  const { dispatchJob, handled } = createWiredSubscriptionDispatchFixture();

  const firstRun = await dispatchJob.run();
  const secondRun = await dispatchJob.run();

  assert.equal(firstRun.enqueued, 1);
  assert.equal(firstRun.duplicates, 0);
  assert.equal(secondRun.enqueued, 0);
  assert.equal(secondRun.duplicates, 1);
  assert.equal(handled.length, 1);
});

test("createComposedPushJobHandler schedules retries for transient failures", async () => {
  const scheduledRetries: Array<{ delayMs: number }> = [];

  const deliveryService: PushDeliveryService = {
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

  const handler = createPushJobHandler({
    deliveryService,
    deviceTokensRepository: {
      deleteByDeviceIdForUser: async () => true,
    },
    retryScheduler,
    terminalFailureRecorder: {
      record: async () => undefined,
    },
  });

  const result = await handler.handle({
    userId: "user-1",
    reminderId: "reminder-1",
    changeEventId: "event-1",
    attempt: 0,
    tokens: [{ deviceId: "device-1", fcmToken: "token-1" }],
  });

  assert.equal(result.retriesScheduled, 1);
  assert.equal(scheduledRetries[0]?.delayMs, 30_000);
});