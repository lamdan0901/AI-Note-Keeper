import assert from "node:assert/strict";
import { test } from "node:test";

import type { NoteRecord, NoteSyncChange } from "@backend/notes/contracts.js";
import type { NotesService } from "@backend/notes/service";

import { createEmptyTrashHandler } from "../src/handlers/notes/empty-trash";
import { createListNotesHandler } from "../src/handlers/notes/list";
import { createPermanentDeleteNoteHandler } from "../src/handlers/notes/permanent-delete";
import { createRestoreNoteHandler } from "../src/handlers/notes/restore";
import { createSyncNotesHandler } from "../src/handlers/notes/sync";
import { createTrashNoteHandler } from "../src/handlers/notes/trash";
import type { AuthenticatedContext } from "../src/http/types";

const AUTH_USER_ID = "auth-user-123";

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
  userId: "client-user-id",
  operation: "create",
  payloadHash: "hash-1",
  deviceId: "device-1",
  updatedAt: 1_700_000_000_000,
});

const createAuthContext = (
  input: Readonly<{
    body?: unknown;
    params?: Readonly<Record<string, string>>;
  }> = {},
): AuthenticatedContext => ({
  request: {} as AuthenticatedContext["request"],
  method: "GET",
  url: new URL("http://localhost/api/notes"),
  headers: new Headers(),
  body: input.body ?? null,
  params: input.params ?? {},
  query: {},
  cookies: {},
  clientIp: null,
  forwardedProto: null,
  authUser: { userId: AUTH_USER_ID, username: "alice" },
});

const createNotesServiceDouble = () => {
  const calls: Array<Readonly<{ method: string; args: Record<string, unknown> }>> = [];

  const notesService: NotesService = {
    listNotes: async (input) => {
      calls.push({ method: "listNotes", args: input as Record<string, unknown> });
      return [sampleNote()];
    },
    sync: async (input) => {
      calls.push({ method: "sync", args: input as Record<string, unknown> });
      return {
        notes: [sampleNote()],
        syncedAt: 1_700_000_100_000,
      };
    },
    restoreNote: async (input) => {
      calls.push({ method: "restoreNote", args: input as Record<string, unknown> });
      return true;
    },
    trashNote: async (input) => {
      calls.push({ method: "trashNote", args: input as Record<string, unknown> });
      return true;
    },
    permanentlyDeleteNote: async (input) => {
      calls.push({
        method: "permanentlyDeleteNote",
        args: input as Record<string, unknown>,
      });
      return true;
    },
    emptyTrash: async (input) => {
      calls.push({ method: "emptyTrash", args: input as Record<string, unknown> });
      return 3;
    },
    purgeExpiredTrash: async (input) => {
      calls.push({ method: "purgeExpiredTrash", args: input as Record<string, unknown> });
      return 0;
    },
  };

  return { notesService, calls };
};

test("createListNotesHandler delegates to notesService.listNotes with auth userId", async () => {
  const { notesService, calls } = createNotesServiceDouble();
  const handler = createListNotesHandler(notesService);

  const result = await handler(createAuthContext());

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "listNotes");
  assert.equal(calls[0]?.args.userId, AUTH_USER_ID);
  assert.deepStrictEqual(result, { notes: [sampleNote()] });
});

test("createSyncNotesHandler normalizes change userId from auth context before sync", async () => {
  const { notesService, calls } = createNotesServiceDouble();
  const handler = createSyncNotesHandler(notesService);

  const result = await handler(
    createAuthContext({
      body: {
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
      },
    }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "sync");
  assert.equal(calls[0]?.args.userId, AUTH_USER_ID);
  assert.equal(calls[0]?.args.lastSyncAt, 1_700_000_000_000);

  const changes = calls[0]?.args.changes as ReadonlyArray<NoteSyncChange>;
  assert.deepStrictEqual(
    changes.map((change) => change.userId),
    [AUTH_USER_ID, AUTH_USER_ID],
  );

  assert.deepStrictEqual(result, {
    notes: [sampleNote()],
    syncedAt: 1_700_000_100_000,
  });
});

test("createEmptyTrashHandler returns deleted count from service", async () => {
  const { notesService, calls } = createNotesServiceDouble();
  const handler = createEmptyTrashHandler(notesService);

  const result = await handler(createAuthContext());

  assert.equal(calls[0]?.method, "emptyTrash");
  assert.equal(calls[0]?.args.userId, AUTH_USER_ID);
  assert.deepStrictEqual(result, { deleted: 3 });
});

test("createRestoreNoteHandler delegates noteId from params", async () => {
  const { notesService, calls } = createNotesServiceDouble();
  const handler = createRestoreNoteHandler(notesService);

  const result = await handler(
    createAuthContext({
      params: { noteId: "note-restore-1" },
    }),
  );

  assert.equal(calls[0]?.method, "restoreNote");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    noteId: "note-restore-1",
  });
  assert.deepStrictEqual(result, { restored: true });
});

test("createPermanentDeleteNoteHandler delegates noteId from params", async () => {
  const { notesService, calls } = createNotesServiceDouble();
  const handler = createPermanentDeleteNoteHandler(notesService);

  const result = await handler(
    createAuthContext({
      params: { noteId: "note-permanent-1" },
    }),
  );

  assert.equal(calls[0]?.method, "permanentlyDeleteNote");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    noteId: "note-permanent-1",
  });
  assert.deepStrictEqual(result, { deleted: true });
});

test("createTrashNoteHandler delegates noteId from params", async () => {
  const { notesService, calls } = createNotesServiceDouble();
  const handler = createTrashNoteHandler(notesService);

  const result = await handler(
    createAuthContext({
      params: { noteId: "note-trash-1" },
    }),
  );

  assert.equal(calls[0]?.method, "trashNote");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    noteId: "note-trash-1",
  });
  assert.deepStrictEqual(result, { deleted: true });
});