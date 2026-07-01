import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, afterEach, before, test } from "node:test";

import { createTokenFactory } from "@backend/auth/tokens";
import type { NoteRecord, NoteSyncChange } from "@backend/notes/contracts.js";
import type { NotesService } from "@backend/notes/service";

import {
  attachSoftPoolErrorHandling,
  resetPoolErrorStateForTests,
  type PoolErrorEventTarget,
} from "../src/db/pool";
import {
  composeServices,
  resetComposedServicesForTests,
  setComposedServicesForTests,
} from "../src/server/compose-services-impl";
import { POST as syncNotesPost } from "../app/api/notes/sync/route";
import {
  startNextTestServer,
  type NextTestServer,
  type RouteRegistration,
} from "./support/next-test-server";

const AUTH_USER_ID = "notes-sync-route-user-1";
const SYNCED_AT = 1_700_000_100_000;

const notesSyncRouteRegistrations: ReadonlyArray<RouteRegistration> = [
  { method: "POST", pathname: "/api/notes/sync", handler: syncNotesPost },
];

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  return (await response.json()) as Record<string, unknown>;
};

const sampleNote = (): NoteRecord => ({
  id: "note-1",
  userId: AUTH_USER_ID,
  title: "Title",
  content: "Body",
  contentType: "text/plain",
  color: null,
  active: true,
  done: null,
  isPinned: null,
  triggerAt: null,
  repeatRule: null,
  repeatConfig: null,
  repeat: null,
  snoozedUntil: null,
  scheduleStatus: null,
  timezone: null,
  baseAtLocal: null,
  startAt: null,
  nextTriggerAt: null,
  lastFiredAt: null,
  lastAcknowledgedAt: null,
  version: 1,
  deletedAt: null,
  createdAt: new Date("2026-06-26T00:00:00.000Z"),
  updatedAt: new Date("2026-06-26T00:00:00.000Z"),
});

const minimalSyncChange = (): NoteSyncChange => ({
  id: "note-1",
  userId: "client-supplied-user-id",
  operation: "create",
  payloadHash: "hash-1",
  deviceId: "device-1",
  updatedAt: 1_700_000_000_000,
});

const validSyncBody = () => ({
  lastSyncAt: 1_700_000_000_000,
  changes: [minimalSyncChange()],
});

const createNotesServiceDouble = () => {
  const syncCalls: Array<Record<string, unknown>> = [];

  const notesService: NotesService = {
    listNotes: async () => {
      throw new Error("not implemented in sync route test double");
    },
    sync: async (input) => {
      syncCalls.push(input as Record<string, unknown>);
      return {
        notes: [sampleNote()],
        syncedAt: SYNCED_AT,
      };
    },
    restoreNote: async () => {
      throw new Error("not implemented in sync route test double");
    },
    trashNote: async () => {
      throw new Error("not implemented in sync route test double");
    },
    permanentlyDeleteNote: async () => {
      throw new Error("not implemented in sync route test double");
    },
    emptyTrash: async () => {
      throw new Error("not implemented in sync route test double");
    },
    purgeExpiredTrash: async () => {
      throw new Error("not implemented in sync route test double");
    },
  };

  return { notesService, syncCalls };
};

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

let server: NextTestServer;
let accessToken: string;
let syncCalls: Array<Record<string, unknown>>;

before(async () => {
  const { notesService, syncCalls: calls } = createNotesServiceDouble();
  syncCalls = calls;

  const services = composeServices();
  setComposedServicesForTests({
    ...services,
    notesService,
  });

  const tokenFactory = createTokenFactory();
  const tokens = await tokenFactory.issueTokenPair({
    userId: AUTH_USER_ID,
    username: "alice",
  });
  accessToken = tokens.accessToken;

  server = await startNextTestServer({ routes: notesSyncRouteRegistrations });
});

after(async () => {
  await server.close();
  resetComposedServicesForTests();
});

afterEach(() => {
  resetPoolErrorStateForTests();
  syncCalls.length = 0;
});

test("POST /api/notes/sync returns 401 without auth or guest headers", async () => {
  const response = await server.fetch("/api/notes/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validSyncBody()),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 401);
  assert.equal(payload.code, "auth");
  assert.equal(payload.status, 401);
});

test("POST /api/notes/sync returns 200 with sync response shape for bearer-authenticated user", async () => {
  const response = await server.fetch("/api/notes/sync", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(validSyncBody()),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.notes));
  assert.equal((payload.notes as Array<Record<string, unknown>>).length, 1);
  assert.equal((payload.notes as Array<Record<string, unknown>>)[0]?.id, "note-1");
  assert.equal(payload.syncedAt, SYNCED_AT);
});

test("POST /api/notes/sync returns 400 validation on malformed body", async () => {
  const response = await server.fetch("/api/notes/sync", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      lastSyncAt: "not-a-number",
      changes: [{ id: "", operation: "invalid" }],
    }),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(payload.code, "validation");
});

test("POST /api/notes/sync normalizes userId from auth context and ignores client-supplied userId", async () => {
  const response = await server.fetch("/api/notes/sync", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      lastSyncAt: 1_700_000_000_000,
      changes: [
        minimalSyncChange(),
        {
          ...minimalSyncChange(),
          id: "note-2",
          userId: "another-client-user",
          operation: "update",
        },
      ],
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0]?.userId, AUTH_USER_ID);

  const changes = syncCalls[0]?.changes as ReadonlyArray<NoteSyncChange>;
  assert.deepStrictEqual(
    changes.map((change) => change.userId),
    [AUTH_USER_ID, AUTH_USER_ID],
  );
});

test("POST /api/notes/sync returns 500 internal when dependencies are degraded", async () => {
  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);
  mockPool.emit(new Error("idle client connection lost"));

  const response = await server.fetch("/api/notes/sync", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(validSyncBody()),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 500);
  assert.deepStrictEqual(payload, {
    code: "internal",
    message: "Internal server error",
    status: 500,
  });
});