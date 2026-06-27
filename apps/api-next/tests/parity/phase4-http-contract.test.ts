import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReminderRepeatRule } from "@backend/reminders/contracts";

import { computeNextTrigger } from "../support/phase4-reminders-parity-harness";
import { authHeaders } from "../support/reminders-test-server";
import {
  createAccessToken,
  jsonAuthHeaders,
  startPhase4RemindersParityTestServer,
} from "../support/phase4-reminders-parity-test-server";

const parseJson = async <T>(response: Response): Promise<T> => {
  return (await response.json()) as T;
};

test("phase-4 parity: CRUD/list/get/update/delete preserve ownership and missing semantics", async () => {
  const server = await startPhase4RemindersParityTestServer();
  const ownerToken = await createAccessToken("owner-user");
  const otherToken = await createAccessToken("other-user");

  try {
    server.harness.setNow(1_760_000_000_000);

    const createResponse = await server.fetch("/api/reminders", {
      method: "POST",
      headers: jsonAuthHeaders(ownerToken),
      body: JSON.stringify({
        id: "rem-crud-1",
        userId: "tampered-user",
        title: "owner reminder",
        triggerAt: 1_760_000_000_000,
        active: true,
        timezone: "UTC",
        updatedAt: 1_760_000_000_000,
      }),
    });

    assert.equal(createResponse.status, 200);
    const createdBody = await parseJson<{ reminder: { userId: string; id: string } }>(
      createResponse,
    );
    assert.equal(createdBody.reminder.userId, "owner-user");
    assert.equal(createdBody.reminder.id, "rem-crud-1");

    const ownerList = await server.fetch("/api/reminders", {
      headers: authHeaders(ownerToken),
    });
    assert.equal(ownerList.status, 200);
    const ownerListBody = await parseJson<{ reminders: Array<{ id: string; userId: string }> }>(
      ownerList,
    );
    assert.equal(ownerListBody.reminders.length, 1);
    assert.equal(ownerListBody.reminders[0].id, "rem-crud-1");
    assert.equal(ownerListBody.reminders[0].userId, "owner-user");

    const otherList = await server.fetch("/api/reminders", {
      headers: authHeaders(otherToken),
    });
    assert.equal(otherList.status, 200);
    const otherListBody = await parseJson<{ reminders: Array<{ id: string }> }>(otherList);
    assert.equal(otherListBody.reminders.length, 0);

    const foreignGet = await server.fetch("/api/reminders/rem-crud-1", {
      headers: authHeaders(otherToken),
    });
    assert.equal(foreignGet.status, 200);
    assert.deepEqual(await parseJson(foreignGet), { reminder: null });

    const foreignPatch = await server.fetch("/api/reminders/rem-crud-1", {
      method: "PATCH",
      headers: jsonAuthHeaders(otherToken),
      body: JSON.stringify({
        title: "attacker title",
        updatedAt: 1_760_000_000_100,
      }),
    });
    assert.equal(foreignPatch.status, 200);
    assert.deepEqual(await parseJson(foreignPatch), { updated: false, reminder: null });

    const ownerPatch = await server.fetch("/api/reminders/rem-crud-1", {
      method: "PATCH",
      headers: jsonAuthHeaders(ownerToken),
      body: JSON.stringify({
        title: "owner reminder updated",
        updatedAt: 1_760_000_000_500,
      }),
    });
    assert.equal(ownerPatch.status, 200);
    const ownerPatchBody = await parseJson<{
      updated: boolean;
      reminder: { title: string | null } | null;
    }>(ownerPatch);
    assert.equal(ownerPatchBody.updated, true);
    assert.equal(ownerPatchBody.reminder?.title, "owner reminder updated");

    const foreignDelete = await server.fetch("/api/reminders/rem-crud-1", {
      method: "DELETE",
      headers: authHeaders(otherToken),
    });
    assert.equal(foreignDelete.status, 200);
    assert.deepEqual(await parseJson(foreignDelete), { deleted: false });

    const ownerDelete = await server.fetch("/api/reminders/rem-crud-1", {
      method: "DELETE",
      headers: authHeaders(ownerToken),
    });
    assert.equal(ownerDelete.status, 200);
    assert.deepEqual(await parseJson(ownerDelete), { deleted: true });

    const ownerGetMissing = await server.fetch("/api/reminders/rem-crud-1", {
      headers: authHeaders(ownerToken),
    });
    assert.equal(ownerGetMissing.status, 200);
    assert.deepEqual(await parseJson(ownerGetMissing), { reminder: null });
  } finally {
    await server.close();
  }
});

test("phase-4 parity: ack transitions for recurring and one-time reminders", async () => {
  const server = await startPhase4RemindersParityTestServer();
  const token = await createAccessToken("user-ack");

  try {
    server.harness.setNow(1_760_100_000_000);

    const recurringCreate = await server.fetch("/api/reminders", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        id: "rem-ack-recurring",
        title: "recurring",
        triggerAt: 1_760_100_000_000,
        active: true,
        timezone: "UTC",
        repeat: { kind: "daily", interval: 1 },
        startAt: 1_760_100_000_000,
        baseAtLocal: "2026-01-15T09:00:00",
        updatedAt: 1_760_100_000_000,
      }),
    });

    assert.equal(recurringCreate.status, 200);

    server.harness.setNow(1_760_100_100_000);
    const recurringAck = await server.fetch("/api/reminders/rem-ack-recurring/ack", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({ ackType: "done" }),
    });

    assert.equal(recurringAck.status, 200);
    const recurringAckBody = await parseJson<{
      updated: boolean;
      reminder: {
        done: boolean | null;
        scheduleStatus: string;
        nextTriggerAt: string | null;
        lastAcknowledgedAt: string | null;
        lastFiredAt: string | null;
      } | null;
    }>(recurringAck);

    assert.equal(recurringAckBody.updated, true);
    assert.equal(recurringAckBody.reminder?.done, true);
    assert.equal(recurringAckBody.reminder?.scheduleStatus, "scheduled");
    assert.notEqual(recurringAckBody.reminder?.nextTriggerAt, null);
    assert.notEqual(recurringAckBody.reminder?.lastAcknowledgedAt, null);
    assert.notEqual(recurringAckBody.reminder?.lastFiredAt, null);

    const oneTimeCreate = await server.fetch("/api/reminders", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        id: "rem-ack-once",
        title: "one time",
        triggerAt: 1_760_200_000_000,
        active: true,
        timezone: "UTC",
        updatedAt: 1_760_200_000_000,
      }),
    });
    assert.equal(oneTimeCreate.status, 200);

    server.harness.setNow(1_760_200_100_000);
    const oneTimeAck = await server.fetch("/api/reminders/rem-ack-once/ack", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({ ackType: "done" }),
    });

    assert.equal(oneTimeAck.status, 200);
    const oneTimeAckBody = await parseJson<{
      updated: boolean;
      reminder: {
        done: boolean | null;
        scheduleStatus: string;
        nextTriggerAt: string | null;
        snoozedUntil: string | null;
        lastAcknowledgedAt: string | null;
      } | null;
    }>(oneTimeAck);

    assert.equal(oneTimeAckBody.updated, true);
    assert.equal(oneTimeAckBody.reminder?.done, true);
    assert.equal(oneTimeAckBody.reminder?.scheduleStatus, "unscheduled");
    assert.equal(oneTimeAckBody.reminder?.nextTriggerAt, null);
    assert.equal(oneTimeAckBody.reminder?.snoozedUntil, null);
    assert.notEqual(oneTimeAckBody.reminder?.lastAcknowledgedAt, null);
  } finally {
    await server.close();
  }
});

test("phase-4 parity: snooze updates due state deterministically and preserves recurrence fields", async () => {
  const server = await startPhase4RemindersParityTestServer();
  const token = await createAccessToken("user-snooze");

  try {
    server.harness.setNow(1_760_300_000_000);

    const createResponse = await server.fetch("/api/reminders", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        id: "rem-snooze-1",
        title: "weekly reminder",
        triggerAt: 1_760_300_000_000,
        active: true,
        timezone: "America/New_York",
        repeat: { kind: "weekly", interval: 1, weekdays: [1, 3, 5] },
        startAt: 1_760_300_000_000,
        baseAtLocal: "2026-03-01T08:30:00",
        updatedAt: 1_760_300_000_000,
      }),
    });
    assert.equal(createResponse.status, 200);

    const snoozedUntil = 1_760_360_000_000;
    server.harness.setNow(1_760_320_000_000);
    const snoozeResponse = await server.fetch("/api/reminders/rem-snooze-1/snooze", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({ snoozedUntil }),
    });

    assert.equal(snoozeResponse.status, 200);
    const snoozeBody = await parseJson<{
      updated: boolean;
      reminder: {
        snoozedUntil: string | null;
        nextTriggerAt: string | null;
        scheduleStatus: string;
        repeat: ReminderRepeatRule | null;
        timezone: string;
        baseAtLocal: string | null;
        startAt: string | null;
      } | null;
    }>(snoozeResponse);

    assert.equal(snoozeBody.updated, true);
    assert.equal(Date.parse(snoozeBody.reminder?.snoozedUntil ?? ""), snoozedUntil);
    assert.equal(Date.parse(snoozeBody.reminder?.nextTriggerAt ?? ""), snoozedUntil);
    assert.equal(snoozeBody.reminder?.scheduleStatus, "scheduled");
    assert.deepEqual(snoozeBody.reminder?.repeat, {
      kind: "weekly",
      interval: 1,
      weekdays: [1, 3, 5],
    });
    assert.equal(snoozeBody.reminder?.timezone, "America/New_York");
    assert.equal(snoozeBody.reminder?.baseAtLocal, "2026-03-01T08:30:00");
    assert.notEqual(snoozeBody.reminder?.startAt, null);
  } finally {
    await server.close();
  }
});

test("phase-4 parity: stale/equal timestamp updates are no-op and do not append change events", async () => {
  const server = await startPhase4RemindersParityTestServer();
  const token = await createAccessToken("user-noop");

  try {
    server.harness.setNow(1_760_400_000_000);

    const createResponse = await server.fetch("/api/reminders", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        id: "rem-noop-1",
        title: "original title",
        triggerAt: 1_760_400_000_000,
        active: true,
        timezone: "UTC",
        updatedAt: 1_760_400_000_000,
      }),
    });

    assert.equal(createResponse.status, 200);
    assert.equal(server.harness.getEventAppendCount(), 1);
    assert.equal(server.harness.getReminderHookCount(), 1);

    const equalUpdate = await server.fetch("/api/reminders/rem-noop-1", {
      method: "PATCH",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        title: "equal update ignored",
        updatedAt: 1_760_400_000_000,
      }),
    });

    assert.equal(equalUpdate.status, 200);
    const equalBody = await parseJson<{
      updated: boolean;
      reminder: { title: string | null } | null;
    }>(equalUpdate);
    assert.equal(equalBody.updated, false);
    assert.equal(equalBody.reminder?.title, "original title");

    const staleUpdate = await server.fetch("/api/reminders/rem-noop-1", {
      method: "PATCH",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        title: "stale update ignored",
        updatedAt: 1_760_399_999_999,
      }),
    });

    assert.equal(staleUpdate.status, 200);
    const staleBody = await parseJson<{
      updated: boolean;
      reminder: { title: string | null } | null;
    }>(staleUpdate);
    assert.equal(staleBody.updated, false);
    assert.equal(staleBody.reminder?.title, "original title");

    assert.equal(server.harness.getEventAppendCount(), 1);
    assert.equal(server.harness.getReminderHookCount(), 1);

    const effectiveUpdate = await server.fetch("/api/reminders/rem-noop-1", {
      method: "PATCH",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        title: "effective update",
        updatedAt: 1_760_400_000_100,
      }),
    });

    assert.equal(effectiveUpdate.status, 200);
    const effectiveBody = await parseJson<{
      updated: boolean;
      reminder: { title: string | null } | null;
    }>(effectiveUpdate);
    assert.equal(effectiveBody.updated, true);
    assert.equal(effectiveBody.reminder?.title, "effective update");
    assert.equal(server.harness.getEventAppendCount(), 2);
    assert.equal(server.harness.getReminderHookCount(), 2);
  } finally {
    await server.close();
  }
});

test("phase-4 parity: recurrence definition edits recompute nextTrigger with shared utility semantics", async () => {
  const server = await startPhase4RemindersParityTestServer();
  const token = await createAccessToken("user-recur");

  try {
    const startAt = Date.parse("2026-03-08T06:30:00.000Z");

    server.harness.setNow(1_760_500_000_000);
    const createResponse = await server.fetch("/api/reminders", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        id: "rem-recur-1",
        title: "dst-aware reminder",
        triggerAt: startAt,
        active: true,
        timezone: "America/New_York",
        repeat: { kind: "daily", interval: 1 },
        startAt,
        baseAtLocal: "2026-03-08T01:30:00",
        updatedAt: 1_760_500_000_000,
      }),
    });

    assert.equal(createResponse.status, 200);
    const createdBody = await parseJson<{
      reminder: {
        nextTriggerAt: string | null;
      };
    }>(createResponse);
    const firstNextTrigger = Date.parse(createdBody.reminder.nextTriggerAt ?? "");
    assert.equal(Number.isNaN(firstNextTrigger), false);

    const patchNow = 1_760_500_100_000;
    server.harness.setNow(patchNow);

    const nextRepeat: ReminderRepeatRule = {
      kind: "weekly",
      interval: 1,
      weekdays: [1, 4],
    };

    const updateResponse = await server.fetch("/api/reminders/rem-recur-1", {
      method: "PATCH",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        repeat: nextRepeat,
        baseAtLocal: "2026-03-08T02:30:00",
        startAt,
        timezone: "America/New_York",
        updatedAt: 1_760_500_100_000,
      }),
    });

    assert.equal(updateResponse.status, 200);
    const updatedBody = await parseJson<{
      updated: boolean;
      reminder: {
        repeat: ReminderRepeatRule | null;
        nextTriggerAt: string | null;
      } | null;
    }>(updateResponse);

    assert.equal(updatedBody.updated, true);
    assert.deepEqual(updatedBody.reminder?.repeat, nextRepeat);

    const expectedNextTrigger = computeNextTrigger(
      patchNow,
      startAt,
      "2026-03-08T02:30:00",
      nextRepeat,
      "America/New_York",
    );

    assert.notEqual(updatedBody.reminder?.nextTriggerAt, null);
    assert.notEqual(expectedNextTrigger, null);
    assert.equal(Date.parse(updatedBody.reminder?.nextTriggerAt ?? ""), expectedNextTrigger);
  } finally {
    await server.close();
  }
});