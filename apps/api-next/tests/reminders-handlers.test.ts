import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReminderRecord } from "@backend/reminders/contracts.js";
import type { RemindersService } from "@backend/reminders/service";

import { createAckReminderHandler } from "../src/handlers/reminders/ack";
import { createCreateReminderHandler } from "../src/handlers/reminders/create";
import { createDeleteReminderHandler } from "../src/handlers/reminders/delete";
import { createGetReminderHandler } from "../src/handlers/reminders/get";
import { createListRemindersHandler } from "../src/handlers/reminders/list";
import { createSnoozeReminderHandler } from "../src/handlers/reminders/snooze";
import { createUpdateReminderHandler } from "../src/handlers/reminders/update";
import { serializeReminder } from "../src/handlers/reminders/shared";
import type { AuthenticatedContext } from "../src/http/types";

const AUTH_USER_ID = "auth-user-123";

const createReminderRecord = (
  input: Readonly<{
    id: string;
    userId?: string;
    updatedAt?: number;
  }>,
): ReminderRecord => {
  const updatedAt = new Date(input.updatedAt ?? 1_700_000_000_000);

  return {
    id: input.id,
    userId: input.userId ?? AUTH_USER_ID,
    title: "title",
    content: "secret-content",
    contentType: "text/plain",
    triggerAt: updatedAt,
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
    nextTriggerAt: updatedAt,
    lastFiredAt: null,
    lastAcknowledgedAt: null,
    scheduleProvider: "qstash",
    scheduleTargetId: "target-1",
    scheduleTargetVersion: 3,
    scheduleTargetFireAt: new Date("2026-01-01T00:00:00.000Z"),
    version: 1,
    createdAt: updatedAt,
    updatedAt,
  };
};

const createAuthContext = (
  input: Readonly<{
    body?: unknown;
    params?: Readonly<Record<string, string>>;
    query?: Readonly<Record<string, string>>;
  }> = {},
): AuthenticatedContext => ({
  request: {} as AuthenticatedContext["request"],
  method: "GET",
  url: new URL("http://localhost/api/reminders"),
  headers: new Headers(),
  body: input.body ?? null,
  params: input.params ?? {},
  query: input.query ?? {},
  cookies: {},
  clientIp: null,
  forwardedProto: null,
  authUser: { userId: AUTH_USER_ID, username: "alice" },
});

const createRemindersServiceDouble = () => {
  const calls: Array<Readonly<{ method: string; args: Record<string, unknown> }>> = [];
  const reminder = createReminderRecord({ id: "reminder-1" });

  const remindersService: RemindersService = {
    listReminders: async (input) => {
      calls.push({ method: "listReminders", args: input as Record<string, unknown> });
      return [reminder];
    },
    getReminder: async (input) => {
      calls.push({ method: "getReminder", args: input as Record<string, unknown> });
      return reminder;
    },
    createReminder: async (input) => {
      calls.push({ method: "createReminder", args: input as Record<string, unknown> });
      return reminder;
    },
    updateReminder: async (input) => {
      calls.push({ method: "updateReminder", args: input as Record<string, unknown> });
      return {
        ...reminder,
        updatedAt: new Date(reminder.updatedAt.getTime() + 1_000),
      };
    },
    deleteReminder: async (input) => {
      calls.push({ method: "deleteReminder", args: input as Record<string, unknown> });
      return true;
    },
    ackReminder: async (input) => {
      calls.push({ method: "ackReminder", args: input as Record<string, unknown> });
      return reminder;
    },
    snoozeReminder: async (input) => {
      calls.push({ method: "snoozeReminder", args: input as Record<string, unknown> });
      return {
        ...reminder,
        updatedAt: new Date(reminder.updatedAt.getTime() + 2_000),
      };
    },
  };

  return { remindersService, calls, reminder };
};

test("createListRemindersHandler delegates listReminders with auth userId and updatedSince", async () => {
  const { remindersService, calls } = createRemindersServiceDouble();
  const handler = createListRemindersHandler(remindersService);

  const result = await handler(
    createAuthContext({
      query: { updatedSince: "200" },
    }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "listReminders");
  assert.equal(calls[0]?.args.userId, AUTH_USER_ID);
  assert.equal(calls[0]?.args.updatedSince, 200);
  assert.deepStrictEqual(result.reminders, [serializeReminder(createReminderRecord({ id: "reminder-1" }))]);
});

test("createGetReminderHandler returns serialized reminder scoped to auth user", async () => {
  const { remindersService, calls } = createRemindersServiceDouble();
  const handler = createGetReminderHandler(remindersService);

  const result = await handler(
    createAuthContext({
      params: { reminderId: "reminder-42" },
    }),
  );

  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    reminderId: "reminder-42",
  });
  assert.deepStrictEqual(result.reminder, serializeReminder(createReminderRecord({ id: "reminder-1" })));
});

test("createCreateReminderHandler strips client userId and uses auth userId", async () => {
  const { remindersService, calls } = createRemindersServiceDouble();
  const handler = createCreateReminderHandler(remindersService);

  const result = await handler(
    createAuthContext({
      body: {
        id: "reminder-new",
        userId: "tampered-user",
        triggerAt: 1_700_000_100_000,
        active: true,
        timezone: "UTC",
        deviceId: "device-1",
      },
    }),
  );

  assert.equal(calls[0]?.method, "createReminder");
  assert.equal(calls[0]?.args.userId, AUTH_USER_ID);
  assert.equal(calls[0]?.args.id, "reminder-new");
  assert.equal(calls[0]?.args.deviceId, "device-1");
  assert.equal("userId" in (calls[0]?.args ?? {}), true);
  assert.notEqual(calls[0]?.args.userId, "tampered-user");
  assert.deepStrictEqual(result.reminder, serializeReminder(createReminderRecord({ id: "reminder-1" })));
});

test("createUpdateReminderHandler computes updated from before and after updatedAt", async () => {
  const { remindersService, calls } = createRemindersServiceDouble();
  const handler = createUpdateReminderHandler(remindersService);

  const result = await handler(
    createAuthContext({
      params: { reminderId: "reminder-update" },
      body: {
        updatedAt: 1_700_000_000_000,
        title: "Updated title",
        deviceId: "device-2",
      },
    }),
  );

  assert.equal(calls[0]?.method, "getReminder");
  assert.equal(calls[1]?.method, "updateReminder");
  assert.deepStrictEqual(calls[1]?.args, {
    userId: AUTH_USER_ID,
    reminderId: "reminder-update",
    patch: {
      updatedAt: 1_700_000_000_000,
      title: "Updated title",
      deviceId: "device-2",
    },
    deviceId: "device-2",
  });
  assert.equal(result.updated, true);
  assert.ok(result.reminder);
});

test("createDeleteReminderHandler returns deleted flag from service", async () => {
  const { remindersService, calls } = createRemindersServiceDouble();
  const handler = createDeleteReminderHandler(remindersService);

  const result = await handler(
    createAuthContext({
      params: { reminderId: "reminder-delete" },
    }),
  );

  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    reminderId: "reminder-delete",
  });
  assert.deepStrictEqual(result, { deleted: true });
});

test("createAckReminderHandler returns updated true when reminder is returned", async () => {
  const { remindersService, calls } = createRemindersServiceDouble();
  const handler = createAckReminderHandler(remindersService);

  const result = await handler(
    createAuthContext({
      params: { reminderId: "reminder-ack" },
      body: {
        ackType: "done",
        deviceId: "device-3",
      },
    }),
  );

  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    reminderId: "reminder-ack",
    ackType: "done",
    deviceId: "device-3",
  });
  assert.equal(result.updated, true);
  assert.ok(result.reminder);
});

test("createSnoozeReminderHandler computes updated from before and after updatedAt", async () => {
  const { remindersService, calls } = createRemindersServiceDouble();
  const handler = createSnoozeReminderHandler(remindersService);

  const result = await handler(
    createAuthContext({
      params: { reminderId: "reminder-snooze" },
      body: {
        snoozedUntil: 1_700_000_500_000,
        deviceId: "device-4",
      },
    }),
  );

  assert.equal(calls[0]?.method, "getReminder");
  assert.equal(calls[1]?.method, "snoozeReminder");
  assert.deepStrictEqual(calls[1]?.args, {
    userId: AUTH_USER_ID,
    reminderId: "reminder-snooze",
    snoozedUntil: 1_700_000_500_000,
    deviceId: "device-4",
  });
  assert.equal(result.updated, true);
  assert.ok(result.reminder);
});