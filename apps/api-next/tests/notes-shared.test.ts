import assert from "node:assert/strict";
import { test } from "node:test";

import type { NoteSyncChange } from "@backend/notes/contracts.js";

import type { AuthenticatedContext } from "../src/http/types";
import {
  noteIdParamsSchema,
  normalizeSyncChanges,
  requireAuthUserId,
  syncBodySchema,
  syncChangeSchema,
} from "../src/handlers/notes/shared";

const buildAuthContext = (userId: string): AuthenticatedContext => {
  return {
    request: {} as AuthenticatedContext["request"],
    method: "POST",
    url: new URL("http://localhost/api/notes/sync"),
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

const minimalSyncChange = (): NoteSyncChange => ({
  id: "note-1",
  userId: "client-user-id",
  operation: "create",
  payloadHash: "hash-1",
  deviceId: "device-1",
  updatedAt: 1_700_000_000_000,
});

test("noteIdParamsSchema requires non-empty noteId", () => {
  assert.equal(noteIdParamsSchema.safeParse({ noteId: "note-1" }).success, true);
  assert.equal(noteIdParamsSchema.safeParse({ noteId: "" }).success, false);
  assert.equal(noteIdParamsSchema.safeParse({}).success, false);
});

test("syncChangeSchema accepts all optional note fields from Express contract", () => {
  const parsed = syncChangeSchema.safeParse({
    ...minimalSyncChange(),
    createdAt: 1_699_999_999_000,
    title: "Title",
    content: "Body",
    contentType: "text/plain",
    color: "#ffffff",
    active: true,
    done: false,
    isPinned: true,
    triggerAt: 1_700_000_100_000,
    repeatRule: "daily",
    repeatConfig: { interval: 1 },
    snoozedUntil: 1_700_000_200_000,
    scheduleStatus: "scheduled",
    timezone: "UTC",
    deletedAt: null,
    repeat: { type: "daily" },
    startAt: 1_700_000_300_000,
    baseAtLocal: "2026-06-26T09:00:00",
    nextTriggerAt: 1_700_000_400_000,
    lastFiredAt: 1_700_000_500_000,
    lastAcknowledgedAt: 1_700_000_600_000,
  });

  assert.equal(parsed.success, true);
});

test("syncBodySchema requires lastSyncAt and changes array", () => {
  const parsed = syncBodySchema.safeParse({
    lastSyncAt: 1_700_000_000_000,
    changes: [minimalSyncChange()],
  });

  assert.equal(parsed.success, true);
  assert.equal(syncBodySchema.safeParse({ changes: [] }).success, false);
  assert.equal(syncBodySchema.safeParse({ lastSyncAt: 1 }).success, false);
});

test("requireAuthUserId reads userId from authenticated context", () => {
  const ctx = buildAuthContext("auth-user-123");

  assert.equal(requireAuthUserId(ctx), "auth-user-123");
});

test("normalizeSyncChanges overwrites each change userId from auth context", () => {
  const changes: ReadonlyArray<NoteSyncChange> = [
    minimalSyncChange(),
    {
      ...minimalSyncChange(),
      id: "note-2",
      userId: "another-client-user",
      operation: "update",
    },
  ];

  const normalized = normalizeSyncChanges("auth-user-123", changes);

  assert.deepStrictEqual(
    normalized.map((change) => change.userId),
    ["auth-user-123", "auth-user-123"],
  );
  assert.equal(changes[0]?.userId, "client-user-id");
  assert.equal(changes[1]?.userId, "another-client-user");
  assert.equal(normalized[0]?.id, "note-1");
  assert.equal(normalized[1]?.operation, "update");
});