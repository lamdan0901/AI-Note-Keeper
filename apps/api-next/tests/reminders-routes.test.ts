import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReminderRecord, ReminderUpdatePayload } from "@backend/reminders/contracts.js";

import {
  createRemindersServiceDouble,
  type RemindersServiceDouble,
} from "./support/reminders-service-double";
import { authHeaders, startRemindersTestServer } from "./support/reminders-test-server";

const CONTRACT_AUTH_USER_ID = "user-1";

const jsonHeaders = (token: string): Headers => {
  const headers = authHeaders(token);
  headers.set("content-type", "application/json");
  return headers;
};

const createReminder = (
  input: Readonly<{
    id: string;
    userId: string;
    updatedAt: number;
    title?: string | null;
    scheduleProvider?: string | null;
    scheduleTargetId?: string | null;
    scheduleTargetVersion?: number | null;
    scheduleTargetFireAt?: Date | null;
  }>,
): ReminderRecord => {
  const updatedAt = new Date(input.updatedAt);

  return {
    id: input.id,
    userId: input.userId,
    title: input.title ?? null,
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
    scheduleProvider: input.scheduleProvider ?? null,
    scheduleTargetId: input.scheduleTargetId ?? null,
    scheduleTargetVersion: input.scheduleTargetVersion ?? null,
    scheduleTargetFireAt: input.scheduleTargetFireAt ?? null,
    version: 1,
    createdAt: updatedAt,
    updatedAt,
  };
};

const assertSchedulerFieldsOmitted = (reminder: Record<string, unknown>): void => {
  assert.equal(Object.hasOwn(reminder, "scheduleProvider"), false);
  assert.equal(Object.hasOwn(reminder, "scheduleTargetId"), false);
  assert.equal(Object.hasOwn(reminder, "scheduleTargetVersion"), false);
  assert.equal(Object.hasOwn(reminder, "scheduleTargetFireAt"), false);
};

const startContractServer = async (
  remindersService: RemindersServiceDouble = createRemindersServiceDouble(
    CONTRACT_AUTH_USER_ID,
  ),
) => {
  return startRemindersTestServer({
    remindersService,
    authUserId: CONTRACT_AUTH_USER_ID,
    authUsername: CONTRACT_AUTH_USER_ID,
  });
};

test("unauthorized reminder endpoints return auth error envelope", async () => {
  const server = await startContractServer();

  try {
    const response = await server.fetch("/api/reminders");
    assert.equal(response.status, 401);

    const payload = (await response.json()) as {
      code: string;
      message: string;
      status: number;
    };
    assert.deepEqual(Object.keys(payload).sort(), ["code", "message", "status"]);
    assert.equal(payload.code, "auth");
    assert.equal(payload.status, 401);
  } finally {
    await server.close();
  }
});

test("missing reminder operations return parity 200 nullable and boolean payloads", async () => {
  const server = await startContractServer();

  try {
    const getResponse = await server.fetch("/api/reminders/missing", {
      headers: authHeaders(server.accessToken),
    });
    assert.equal(getResponse.status, 200);
    assert.deepEqual(await getResponse.json(), { reminder: null });

    const updateResponse = await server.fetch("/api/reminders/missing", {
      method: "PATCH",
      headers: jsonHeaders(server.accessToken),
      body: JSON.stringify({
        updatedAt: 1_700_000_000_000,
        title: "ignored",
      } satisfies ReminderUpdatePayload),
    });
    assert.equal(updateResponse.status, 200);
    assert.deepEqual(await updateResponse.json(), { updated: false, reminder: null });

    const deleteResponse = await server.fetch("/api/reminders/missing", {
      method: "DELETE",
      headers: authHeaders(server.accessToken),
    });
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(await deleteResponse.json(), { deleted: false });

    const ackResponse = await server.fetch("/api/reminders/missing/ack", {
      method: "POST",
      headers: jsonHeaders(server.accessToken),
      body: JSON.stringify({ ackType: "done" }),
    });
    assert.equal(ackResponse.status, 200);
    assert.deepEqual(await ackResponse.json(), { updated: false, reminder: null });

    const snoozeResponse = await server.fetch("/api/reminders/missing/snooze", {
      method: "POST",
      headers: jsonHeaders(server.accessToken),
      body: JSON.stringify({ snoozedUntil: 1_700_000_000_000 }),
    });
    assert.equal(snoozeResponse.status, 200);
    assert.deepEqual(await snoozeResponse.json(), { updated: false, reminder: null });
  } finally {
    await server.close();
  }
});

test("list endpoint supports updatedSince and keeps user ownership scoping", async () => {
  const remindersService = createRemindersServiceDouble(CONTRACT_AUTH_USER_ID);
  remindersService.seed(createReminder({ id: "r-old", userId: "user-1", updatedAt: 100 }));
  remindersService.seed(createReminder({ id: "r-new", userId: "user-1", updatedAt: 300 }));
  remindersService.seed(
    createReminder({ id: "r-foreign", userId: "user-2", updatedAt: 400 }),
  );

  const server = await startContractServer(remindersService);

  try {
    const response = await server.fetch("/api/reminders?updatedSince=200", {
      headers: authHeaders(server.accessToken),
    });

    const listBody = await response.text();
    assert.equal(response.status, 200, listBody);
    const payload = JSON.parse(listBody) as {
      reminders: Array<{ id: string; userId: string }>;
    };
    assert.equal(payload.reminders.length, 1);
    assert.equal(payload.reminders[0]?.id, "r-new");
    assert.equal(payload.reminders[0]?.userId, "user-1");
  } finally {
    await server.close();
  }
});

test("request body userId tampering is ignored in create and update flows", async () => {
  const remindersService = createRemindersServiceDouble(CONTRACT_AUTH_USER_ID);
  const server = await startContractServer(remindersService);

  try {
    const createResponse = await server.fetch("/api/reminders", {
      method: "POST",
      headers: jsonHeaders(server.accessToken),
      body: JSON.stringify({
        id: "reminder-1",
        userId: "attacker-user",
        title: "first",
        triggerAt: 1_700_000_100_000,
        active: true,
        timezone: "UTC",
      }),
    });

    assert.equal(createResponse.status, 200);
    const created = (await createResponse.json()) as { reminder: { userId: string } };
    assert.equal(created.reminder.userId, "user-1");

    remindersService.seed(
      createReminder({
        id: "reminder-1",
        userId: "user-2",
        updatedAt: 1_700_000_000_000,
        title: "foreign",
      }),
    );

    const updateResponse = await server.fetch("/api/reminders/reminder-1", {
      method: "PATCH",
      headers: jsonHeaders(server.accessToken),
      body: JSON.stringify({
        userId: "user-2",
        updatedAt: Date.now() + 1_000,
        title: "owner-update",
      }),
    });

    assert.equal(updateResponse.status, 200);
    const payload = (await updateResponse.json()) as {
      updated: boolean;
      reminder: { title: string | null } | null;
    };

    assert.equal(payload.updated, true);
    assert.equal(payload.reminder?.title, "owner-update");

    const owned = await remindersService.getReminder({
      userId: "user-1",
      reminderId: "reminder-1",
    });
    const foreign = await remindersService.getReminder({
      userId: "user-2",
      reminderId: "reminder-1",
    });

    assert.equal(owned?.title, "owner-update");
    assert.equal(foreign?.title, "foreign");
  } finally {
    await server.close();
  }
});

test("reminder API responses omit internal scheduler metadata fields", async () => {
  const remindersService = createRemindersServiceDouble(CONTRACT_AUTH_USER_ID);
  remindersService.seed(
    createReminder({
      id: "reminder-1",
      userId: "user-1",
      updatedAt: 1_700_000_000_000,
      title: "scheduled",
      scheduleProvider: "test-provider",
      scheduleTargetId: "target-1",
      scheduleTargetVersion: 7,
      scheduleTargetFireAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
  );

  const server = await startContractServer(remindersService);

  try {
    const listResponse = await server.fetch("/api/reminders", {
      headers: authHeaders(server.accessToken),
    });
    assert.equal(listResponse.status, 200);
    const listPayload = (await listResponse.json()) as {
      reminders: Array<Record<string, unknown>>;
    };
    assert.equal(listPayload.reminders.length, 1);
    assertSchedulerFieldsOmitted(listPayload.reminders[0] ?? {});

    const getResponse = await server.fetch("/api/reminders/reminder-1", {
      headers: authHeaders(server.accessToken),
    });
    assert.equal(getResponse.status, 200);
    const getPayload = (await getResponse.json()) as {
      reminder: Record<string, unknown> | null;
    };
    assert.notEqual(getPayload.reminder, null);
    if (getPayload.reminder === null) {
      throw new Error("Expected reminder payload");
    }
    assertSchedulerFieldsOmitted(getPayload.reminder);

    const createResponse = await server.fetch("/api/reminders", {
      method: "POST",
      headers: jsonHeaders(server.accessToken),
      body: JSON.stringify({
        id: "reminder-2",
        title: "created",
        triggerAt: 1_700_000_100_000,
        active: true,
        timezone: "UTC",
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = (await createResponse.json()) as {
      reminder: Record<string, unknown> | null;
    };
    assert.notEqual(createPayload.reminder, null);
    if (createPayload.reminder === null) {
      throw new Error("Expected created reminder payload");
    }
    assertSchedulerFieldsOmitted(createPayload.reminder);

    const updateResponse = await server.fetch("/api/reminders/reminder-1", {
      method: "PATCH",
      headers: jsonHeaders(server.accessToken),
      body: JSON.stringify({
        updatedAt: Date.now() + 1_000,
        title: "updated",
      } satisfies ReminderUpdatePayload),
    });
    assert.equal(updateResponse.status, 200);
    const updatePayload = (await updateResponse.json()) as {
      reminder: Record<string, unknown> | null;
    };
    assert.notEqual(updatePayload.reminder, null);
    if (updatePayload.reminder === null) {
      throw new Error("Expected updated reminder payload");
    }
    assertSchedulerFieldsOmitted(updatePayload.reminder);

    const ackResponse = await server.fetch("/api/reminders/reminder-1/ack", {
      method: "POST",
      headers: jsonHeaders(server.accessToken),
      body: JSON.stringify({ ackType: "done" }),
    });
    assert.equal(ackResponse.status, 200);
    const ackPayload = (await ackResponse.json()) as {
      reminder: Record<string, unknown> | null;
    };
    assert.notEqual(ackPayload.reminder, null);
    if (ackPayload.reminder === null) {
      throw new Error("Expected ack reminder payload");
    }
    assertSchedulerFieldsOmitted(ackPayload.reminder);

    const snoozeResponse = await server.fetch("/api/reminders/reminder-1/snooze", {
      method: "POST",
      headers: jsonHeaders(server.accessToken),
      body: JSON.stringify({ snoozedUntil: 1_700_000_200_000 }),
    });
    assert.equal(snoozeResponse.status, 200);
    const snoozePayload = (await snoozeResponse.json()) as {
      reminder: Record<string, unknown> | null;
    };
    assert.notEqual(snoozePayload.reminder, null);
    if (snoozePayload.reminder === null) {
      throw new Error("Expected snoozed reminder payload");
    }
    assertSchedulerFieldsOmitted(snoozePayload.reminder);
  } finally {
    await server.close();
  }
});