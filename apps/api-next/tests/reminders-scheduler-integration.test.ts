import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReminderSchedulerPayload } from "@backend/reminders/contracts";

import {
  createReminderRecord,
  createReminderDeliveryKey,
  createSchedulerHarness,
  SCHEDULER_INTEGRATION_USER_ID,
} from "./support/scheduler-integration-harness";
import {
  INTERNAL_SCHEDULED_TASK_PATH,
  internalCallbackHeaders,
  jsonAuthHeaders,
  startSchedulerIntegrationTestServer,
} from "./support/scheduler-integration-test-server";

const NOW = new Date("2026-06-13T09:00:00.000Z");
const FIRST_OCCURRENCE_MS = Date.parse("2026-06-13T10:05:00.000Z");

const recurringCreateBody = () => ({
  id: "reminder-1",
  title: "Reminder",
  triggerAt: FIRST_OCCURRENCE_MS,
  active: true,
  timezone: "UTC",
  repeat: { kind: "daily", interval: 1 },
  startAt: FIRST_OCCURRENCE_MS,
  baseAtLocal: "2026-06-13T10:05:00",
  updatedAt: NOW.getTime(),
  createdAt: NOW.getTime(),
});

const buildScheduledPayload = (
  reminder: Readonly<{
    id: string;
    nextTriggerAt: Date;
    version: number;
  }>,
): ReminderSchedulerPayload => {
  const deliveryKey = createReminderDeliveryKey({
    reminderId: reminder.id,
    occurrenceAt: reminder.nextTriggerAt,
    version: reminder.version,
  });

  return {
    reminderId: reminder.id,
    occurrenceAt: reminder.nextTriggerAt.toISOString(),
    version: reminder.version,
    deliveryKey,
  };
};

const postInternalCallback = async (
  server: Awaited<ReturnType<typeof startSchedulerIntegrationTestServer>>,
  payload: ReminderSchedulerPayload,
): Promise<Response> => {
  return server.fetch(INTERNAL_SCHEDULED_TASK_PATH, {
    method: "POST",
    headers: internalCallbackHeaders(),
    body: JSON.stringify(payload),
  });
};

test("create reminder schedules exactly one next occurrence", async () => {
  const harness = createSchedulerHarness(NOW);
  const server = await startSchedulerIntegrationTestServer({ harness });

  try {
    harness.resetEvents();

    const response = await server.fetch("/api/reminders", {
      method: "POST",
      headers: jsonAuthHeaders(server.accessToken),
      body: JSON.stringify(recurringCreateBody()),
    });

    assert.equal(response.status, 200);
    assert.equal(harness.countScheduleEvents(), 1);

    const scheduledReminder = await harness.getReminder(
      SCHEDULER_INTEGRATION_USER_ID,
      "reminder-1",
    );
    assert.notEqual(scheduledReminder, null);
    assert.equal(scheduledReminder?.scheduleTargetVersion, 1);
    assert.equal(scheduledReminder?.scheduleTargetId?.startsWith("schedule-"), true);
    assert.equal(
      scheduledReminder?.scheduleTargetFireAt?.toISOString(),
      "2026-06-13T10:05:00.000Z",
    );
  } finally {
    await server.close();
  }
});

const seedPendingDelivery = (
  harness: ReturnType<typeof createSchedulerHarness>,
  input: Readonly<{
    reminderId: string;
    userId: string;
    occurrenceAt: Date;
    version: number;
    deliveryKey: string;
  }>,
): void => {
  const record = {
    id: "delivery-preseed",
    reminderId: input.reminderId,
    userId: input.userId,
    occurrenceAt: input.occurrenceAt,
    reminderVersion: input.version,
    deliveryKey: input.deliveryKey,
    status: "pending" as const,
    providerMessageId: null,
    attemptCount: 0,
    createdAt: NOW,
    sentAt: null,
    failureReason: null,
  };

  harness.deliveries.set(`${input.reminderId}:${input.occurrenceAt.getTime()}`, record);
  harness.deliveries.set(input.deliveryKey, record);
};

test("duplicate scheduled task callback returns duplicate without a second push", async () => {
  const harness = createSchedulerHarness(NOW);
  const server = await startSchedulerIntegrationTestServer({ harness });

  try {
    await harness.reminderService.createReminder({
      id: "reminder-1",
      userId: SCHEDULER_INTEGRATION_USER_ID,
      title: "Reminder",
      triggerAt: FIRST_OCCURRENCE_MS,
      active: true,
      timezone: "UTC",
      repeat: { kind: "daily", interval: 1 },
      startAt: FIRST_OCCURRENCE_MS,
      baseAtLocal: "2026-06-13T10:05:00",
      updatedAt: NOW.getTime(),
      createdAt: NOW.getTime(),
    });

    const scheduledReminder = await harness.getReminder(
      SCHEDULER_INTEGRATION_USER_ID,
      "reminder-1",
    );
    assert.notEqual(scheduledReminder, null);
    if (!scheduledReminder?.nextTriggerAt) {
      throw new Error("Expected scheduled reminder state before callback");
    }

    const payload = buildScheduledPayload({
      id: scheduledReminder.id,
      nextTriggerAt: scheduledReminder.nextTriggerAt,
      version: scheduledReminder.version,
    });

    seedPendingDelivery(harness, {
      reminderId: scheduledReminder.id,
      userId: SCHEDULER_INTEGRATION_USER_ID,
      occurrenceAt: scheduledReminder.nextTriggerAt,
      version: scheduledReminder.version,
      deliveryKey: payload.deliveryKey,
    });

    harness.resetEvents();
    const response = await postInternalCallback(server, payload);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "duplicate" });
    assert.equal(harness.countSendEvents(), 0);
  } finally {
    await server.close();
  }
});

test("duplicate scheduled task execution sends only one delivery for the occurrence", async () => {
  const harness = createSchedulerHarness(NOW);
  const server = await startSchedulerIntegrationTestServer({ harness });

  try {
    await harness.reminderService.createReminder({
      id: "reminder-1",
      userId: SCHEDULER_INTEGRATION_USER_ID,
      title: "Reminder",
      triggerAt: FIRST_OCCURRENCE_MS,
      active: true,
      timezone: "UTC",
      repeat: { kind: "daily", interval: 1 },
      startAt: FIRST_OCCURRENCE_MS,
      baseAtLocal: "2026-06-13T10:05:00",
      updatedAt: NOW.getTime(),
      createdAt: NOW.getTime(),
    });

    const scheduledReminder = await harness.getReminder(
      SCHEDULER_INTEGRATION_USER_ID,
      "reminder-1",
    );
    assert.notEqual(scheduledReminder, null);
    if (!scheduledReminder?.nextTriggerAt) {
      throw new Error("Expected scheduled reminder state before callback");
    }

    const payload = buildScheduledPayload({
      id: scheduledReminder.id,
      nextTriggerAt: scheduledReminder.nextTriggerAt,
      version: scheduledReminder.version,
    });

    harness.resetEvents();

    const firstResponse = await postInternalCallback(server, payload);
    const secondResponse = await postInternalCallback(server, payload);

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.deepEqual(await firstResponse.json(), { status: "sent" });
    assert.deepEqual(await secondResponse.json(), { status: "stale" });
    assert.equal(harness.countSendEvents(), 1);
    assert.deepEqual(harness.events, [
      `delivery:${payload.deliveryKey}`,
      "send:reminder-1",
      "schedule:reminder-1:1",
    ]);
  } finally {
    await server.close();
  }
});

test("repair job backfills missed occurrence after simulated downtime", async () => {
  const harness = createSchedulerHarness(new Date("2026-06-13T10:10:00.000Z"));
  const server = await startSchedulerIntegrationTestServer({ harness });
  const occurrenceAt = new Date("2026-06-13T10:05:00.000Z");

  try {
    harness.insertReminder(
      createReminderRecord({
        id: "reminder-1",
        userId: SCHEDULER_INTEGRATION_USER_ID,
        title: "Reminder",
        triggerAt: occurrenceAt,
        nextTriggerAt: occurrenceAt,
        updatedAt: new Date("2026-06-13T09:55:00.000Z"),
        active: true,
        version: 2,
        scheduleProvider: null,
        scheduleTargetId: null,
        scheduleTargetVersion: null,
        scheduleTargetFireAt: null,
      }),
    );

    harness.resetEvents();
    const result = await harness.repairJob.run();

    assert.equal(result.candidates, 1);
    assert.equal(result.executed, 1);
    assert.equal(result.scheduled, 0);
    assert.deepEqual(harness.events, [
      `delivery:${createReminderDeliveryKey({
        reminderId: "reminder-1",
        occurrenceAt,
        version: 2,
      })}`,
      "send:reminder-1",
    ]);
  } finally {
    await server.close();
  }
});

test("weekly weekday reminder schedules the next selected weekday after callback", async () => {
  const harness = createSchedulerHarness(new Date("2026-06-29T08:30:00.000Z"));
  const server = await startSchedulerIntegrationTestServer({ harness });
  const firstOccurrenceMs = Date.parse("2026-06-29T09:00:00.000Z");

  try {
    await harness.reminderService.createReminder({
      id: "reminder-weekly-1",
      userId: SCHEDULER_INTEGRATION_USER_ID,
      title: "Weekly reminder",
      triggerAt: firstOccurrenceMs,
      active: true,
      timezone: "UTC",
      repeat: { kind: "weekly", interval: 1, weekdays: [1, 4] },
      startAt: firstOccurrenceMs,
      baseAtLocal: "2026-06-29T09:00:00",
      updatedAt: Date.parse("2026-06-29T08:30:00.000Z"),
      createdAt: Date.parse("2026-06-29T08:30:00.000Z"),
    });

    const scheduledReminder = await harness.getReminder(
      SCHEDULER_INTEGRATION_USER_ID,
      "reminder-weekly-1",
    );
    assert.notEqual(scheduledReminder, null);
    if (!scheduledReminder?.nextTriggerAt) {
      throw new Error("Expected scheduled reminder state before weekly callback");
    }

    assert.equal(
      scheduledReminder.nextTriggerAt.toISOString(),
      "2026-06-29T09:00:00.000Z",
    );

    harness.resetEvents();
    const response = await postInternalCallback(
      server,
      buildScheduledPayload({
        id: scheduledReminder.id,
        nextTriggerAt: scheduledReminder.nextTriggerAt,
        version: scheduledReminder.version,
      }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "sent" });

    const advancedReminder = await harness.getReminder(
      SCHEDULER_INTEGRATION_USER_ID,
      "reminder-weekly-1",
    );
    assert.notEqual(advancedReminder, null);
    assert.equal(
      advancedReminder?.nextTriggerAt?.toISOString(),
      "2026-07-02T09:00:00.000Z",
    );
    assert.deepEqual(harness.events, [
      `delivery:${createReminderDeliveryKey({
        reminderId: "reminder-weekly-1",
        occurrenceAt: new Date("2026-06-29T09:00:00.000Z"),
        version: 1,
      })}`,
      "send:reminder-weekly-1",
      "schedule:reminder-weekly-1:1",
    ]);
  } finally {
    await server.close();
  }
});
