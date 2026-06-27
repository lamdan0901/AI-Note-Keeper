import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReminderRecord } from "@backend/reminders/contracts.js";

import type { AuthenticatedContext } from "../src/http/types";
import {
  listQuerySchema,
  reminderAckBodySchema,
  reminderCreateBodySchema,
  reminderIdParamsSchema,
  reminderSnoozeBodySchema,
  reminderUpdateBodySchema,
  requireAuthUserId,
  serializeReminder,
  stripClientUserId,
} from "../src/handlers/reminders/shared";

const buildAuthContext = (userId: string): AuthenticatedContext => {
  return {
    request: {} as AuthenticatedContext["request"],
    method: "GET",
    url: new URL("http://localhost/api/reminders"),
    headers: new Headers(),
    body: null,
    params: {},
    query: {},
    cookies: {},
    clientIp: null,
    forwardedProto: null,
    authUser: { userId, username: "alice" },
  };
};

const createReminderRecord = (
  input: Readonly<{
    id: string;
    userId: string;
    updatedAt?: number;
    content?: string | null;
    contentType?: string | null;
    scheduleProvider?: string | null;
    scheduleTargetId?: string | null;
    scheduleTargetVersion?: number | null;
    scheduleTargetFireAt?: Date | null;
  }>,
): ReminderRecord => {
  const updatedAt = new Date(input.updatedAt ?? 1_700_000_000_000);

  return {
    id: input.id,
    userId: input.userId,
    title: "title",
    content: input.content ?? "secret-content",
    contentType: input.contentType ?? "text/plain",
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
    scheduleProvider: input.scheduleProvider ?? "qstash",
    scheduleTargetId: input.scheduleTargetId ?? "target-1",
    scheduleTargetVersion: input.scheduleTargetVersion ?? 3,
    scheduleTargetFireAt: input.scheduleTargetFireAt ?? new Date("2026-01-01T00:00:00.000Z"),
    version: 1,
    createdAt: updatedAt,
    updatedAt,
  };
};

const minimalCreateBody = () => ({
  id: "reminder-1",
  triggerAt: 1_700_000_100_000,
  active: true,
  timezone: "UTC",
});

test("reminderIdParamsSchema requires non-empty reminderId", () => {
  assert.equal(reminderIdParamsSchema.safeParse({ reminderId: "reminder-1" }).success, true);
  assert.equal(reminderIdParamsSchema.safeParse({ reminderId: "" }).success, false);
  assert.equal(reminderIdParamsSchema.safeParse({}).success, false);
});

test("listQuerySchema coerces updatedSince to integer", () => {
  const parsed = listQuerySchema.safeParse({ updatedSince: "200" });

  assert.equal(parsed.success, true);
  if (!parsed.success) {
    throw new Error("Expected listQuerySchema parse to succeed");
  }
  assert.equal(parsed.data.updatedSince, 200);
});

test("listQuerySchema accepts missing updatedSince", () => {
  const parsed = listQuerySchema.safeParse({});

  assert.equal(parsed.success, true);
  if (!parsed.success) {
    throw new Error("Expected listQuerySchema parse to succeed");
  }
  assert.equal(parsed.data.updatedSince, undefined);
});

test("reminderCreateBodySchema matches Express contract fields", () => {
  const parsed = reminderCreateBodySchema.safeParse({
    ...minimalCreateBody(),
    userId: "client-user",
    title: "Wake up",
    repeatRule: "daily",
    repeatConfig: { interval: 1 },
    repeat: { kind: "daily", interval: 1 },
    snoozedUntil: null,
    scheduleStatus: "scheduled",
    baseAtLocal: "2026-06-26T09:00:00",
    startAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    createdAt: 1_699_999_999_000,
    deviceId: "device-1",
  });

  assert.equal(parsed.success, true);
});

test("reminderUpdateBodySchema requires updatedAt and accepts partial patches", () => {
  const parsed = reminderUpdateBodySchema.safeParse({
    updatedAt: 1_700_000_000_000,
    title: "Updated title",
    done: true,
    repeatRule: "weekly",
    repeatConfig: { weekdays: [1, 3, 5] },
    repeat: { kind: "weekly", interval: 1, weekdays: [1, 3, 5] },
    snoozedUntil: null,
    active: false,
    scheduleStatus: "unscheduled",
    timezone: "America/New_York",
    baseAtLocal: "2026-06-26T10:00:00",
    startAt: 1_700_000_100_000,
    nextTriggerAt: 1_700_000_200_000,
    lastFiredAt: 1_700_000_300_000,
    lastAcknowledgedAt: 1_700_000_400_000,
    deviceId: "device-2",
    userId: "client-user",
  });

  assert.equal(parsed.success, true);
  assert.equal(reminderUpdateBodySchema.safeParse({ title: "missing updatedAt" }).success, false);
});

test("reminderAckBodySchema accepts done and snooze ack types", () => {
  assert.equal(
    reminderAckBodySchema.safeParse({ ackType: "done", deviceId: "device-1" }).success,
    true,
  );
  assert.equal(
    reminderAckBodySchema.safeParse({
      ackType: "snooze",
      optimisticNextTrigger: 1_700_000_500_000,
    }).success,
    true,
  );
  assert.equal(reminderAckBodySchema.safeParse({ ackType: "invalid" }).success, false);
});

test("reminderSnoozeBodySchema requires snoozedUntil epoch", () => {
  const parsed = reminderSnoozeBodySchema.safeParse({
    snoozedUntil: 1_700_000_600_000,
    deviceId: "device-1",
  });

  assert.equal(parsed.success, true);
  assert.equal(reminderSnoozeBodySchema.safeParse({}).success, false);
});

test("requireAuthUserId reads userId from authenticated context", () => {
  const ctx = buildAuthContext("auth-user-123");

  assert.equal(requireAuthUserId(ctx), "auth-user-123");
});

test("serializeReminder returns null for null input", () => {
  assert.equal(serializeReminder(null), null);
});

test("serializeReminder strips internal scheduler and content fields", () => {
  const reminder = createReminderRecord({
    id: "reminder-1",
    userId: "user-1",
    scheduleProvider: "qstash",
    scheduleTargetId: "target-99",
    scheduleTargetVersion: 12,
    scheduleTargetFireAt: new Date("2026-02-01T12:00:00.000Z"),
    content: "hidden-body",
    contentType: "text/markdown",
  });

  const serialized = serializeReminder(reminder);

  assert.notEqual(serialized, null);
  if (serialized === null) {
    throw new Error("Expected serialized reminder");
  }

  assert.equal(Object.hasOwn(serialized, "scheduleProvider"), false);
  assert.equal(Object.hasOwn(serialized, "scheduleTargetId"), false);
  assert.equal(Object.hasOwn(serialized, "scheduleTargetVersion"), false);
  assert.equal(Object.hasOwn(serialized, "scheduleTargetFireAt"), false);
  assert.equal(Object.hasOwn(serialized, "content"), false);
  assert.equal(Object.hasOwn(serialized, "contentType"), false);
  assert.equal(serialized.id, "reminder-1");
  assert.equal(serialized.userId, "user-1");
  assert.equal(serialized.timezone, "UTC");
});

test("stripClientUserId removes userId without mutating the original body", () => {
  const body = {
    id: "reminder-1",
    userId: "attacker-user",
    title: "Wake up",
    triggerAt: 1_700_000_100_000,
    active: true,
    timezone: "UTC",
  };

  const stripped = stripClientUserId(body);

  assert.equal(Object.hasOwn(stripped, "userId"), false);
  assert.equal(stripped.id, "reminder-1");
  assert.equal(stripped.title, "Wake up");
  assert.equal(body.userId, "attacker-user");
});

test("stripClientUserId works when userId is absent", () => {
  const body = {
    updatedAt: 1_700_000_000_000,
    title: "Updated title",
  };

  const stripped = stripClientUserId(body);

  assert.equal(Object.hasOwn(stripped, "userId"), false);
  assert.equal(stripped.title, "Updated title");
  assert.equal(stripped.updatedAt, 1_700_000_000_000);
});