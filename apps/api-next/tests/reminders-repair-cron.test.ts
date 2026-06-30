import assert from "node:assert/strict";
import { test } from "node:test";

import { createReminderRepairJob } from "@backend/reminders/repair-job";
import type { ReminderSchedulerPayload } from "@backend/reminders/contracts";

import { startRemindersRepairCronTestServer } from "./support/reminders-repair-cron-test-server";

const CRON_SECRET = "test-cron-secret";
const CRON_PATH = "/cron/reminders-repair";

const createOverdueRepairJobDouble = (executed: string[]) => {
  const now = new Date("2026-06-13T10:10:00.000Z");

  return createReminderRepairJob({
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
      findById: async () => ({
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
        scheduleStatus: "unscheduled",
        timezone: "UTC",
        baseAtLocal: null,
        startAt: null,
        nextTriggerAt: null,
        lastFiredAt: new Date("2026-06-13T10:05:00.000Z"),
        lastAcknowledgedAt: null,
        version: 2,
        scheduleProvider: null,
        scheduleTargetId: null,
        scheduleTargetVersion: null,
        scheduleTargetFireAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    },
    executor: {
      execute: async (payload: ReminderSchedulerPayload) => {
        executed.push(`${payload.reminderId}:${payload.version}:${payload.deliveryKey}`);
        return { status: "sent" };
      },
    },
    schedulerService: {
      scheduleNextOccurrence: async () => ({ scheduled: true }),
      cancelCurrentSchedule: async () => undefined,
      clearScheduleMetadata: async () => undefined,
    },
    now: () => now,
  });
};

test("repair cron executes overdue candidates through scheduled task executor", async () => {
  const executed: string[] = [];
  const server = await startRemindersRepairCronTestServer({
    repairJob: createOverdueRepairJobDouble(executed),
    cronSecret: CRON_SECRET,
  });

  try {
    const response = await server.fetch(CRON_PATH, {
      method: "GET",
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
      },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      candidates: 1,
      executed: 1,
      scheduled: 0,
    });
    assert.deepEqual(executed, ["reminder-1:2:reminder-1:1781345100000:v2"]);
  } finally {
    await server.close();
  }
});

test("repair cron supports POST for manual maintenance invocations", async () => {
  const executed: string[] = [];
  const server = await startRemindersRepairCronTestServer({
    repairJob: createOverdueRepairJobDouble(executed),
    cronSecret: CRON_SECRET,
  });

  try {
    const response = await server.fetch(CRON_PATH, {
      method: "POST",
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
      },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      candidates: 1,
      executed: 1,
      scheduled: 0,
    });
    assert.equal(executed.length, 1);
  } finally {
    await server.close();
  }
});

test("repair cron rejects unauthenticated requests", async () => {
  const executed: string[] = [];
  const server = await startRemindersRepairCronTestServer({
    repairJob: createOverdueRepairJobDouble(executed),
    cronSecret: CRON_SECRET,
  });

  try {
    const response = await server.fetch(CRON_PATH, { method: "GET" });

    assert.equal(response.status, 401);
    const payload = (await response.json()) as Record<string, unknown>;
    assert.equal(payload.code, "auth");
    assert.equal(payload.message, "Invalid cron authorization");
    assert.equal(payload.status, 401);
    assert.deepEqual(executed, []);
  } finally {
    await server.close();
  }
});

test("repair cron rejects invalid bearer token", async () => {
  const executed: string[] = [];
  const server = await startRemindersRepairCronTestServer({
    repairJob: createOverdueRepairJobDouble(executed),
    cronSecret: CRON_SECRET,
  });

  try {
    const response = await server.fetch(CRON_PATH, {
      method: "GET",
      headers: {
        authorization: "Bearer wrong-secret",
      },
    });

    assert.equal(response.status, 401);
    const payload = (await response.json()) as Record<string, unknown>;
    assert.equal(payload.code, "auth");
    assert.equal(payload.message, "Invalid cron authorization");
    assert.deepEqual(executed, []);
  } finally {
    await server.close();
  }
});