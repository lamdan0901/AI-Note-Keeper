import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, afterEach, before, test } from "node:test";
import { NextRequest } from "next/server";

import { createTokenFactory } from "@backend/auth/tokens";
import type { NotesService } from "@backend/notes/service";

import { DELETE as emptyTrashDelete } from "../app/api/notes/trash/empty/route";
import { DELETE as trashNoteDelete } from "../app/api/notes/[noteId]/route";
import { DELETE as permanentDelete } from "../app/api/notes/[noteId]/permanent/route";
import { POST as restoreNotePost } from "../app/api/notes/[noteId]/restore/route";
import {
  attachSoftPoolErrorHandling,
  resetPoolErrorStateForTests,
  type PoolErrorEventTarget,
} from "../src/db/pool";
import {
  composeServices,
  resetComposedServicesForTests,
  setComposedServicesForTests,
} from "../src/server/compose-services";
import {
  startNextTestServer,
  type NextTestServer,
  type RouteRegistration,
} from "./support/next-test-server";

const AUTH_USER_ID = "notes-trash-route-user-1";

const notesTrashRouteRegistrations: ReadonlyArray<RouteRegistration> = [
  {
    method: "DELETE",
    pathname: "/api/notes/trash/empty",
    handler: emptyTrashDelete,
  },
  {
    method: "POST",
    pathname: "/api/notes/:noteId/restore",
    pattern: "/api/notes/:noteId/restore",
    handler: restoreNotePost,
  },
  {
    method: "DELETE",
    pathname: "/api/notes/:noteId/permanent",
    pattern: "/api/notes/:noteId/permanent",
    handler: permanentDelete,
  },
  {
    method: "DELETE",
    pathname: "/api/notes/:noteId",
    pattern: "/api/notes/:noteId",
    handler: trashNoteDelete,
  },
];

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  return (await response.json()) as Record<string, unknown>;
};

const createNotesServiceDouble = () => {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = [];

  const notesService: NotesService = {
    listNotes: async () => {
      throw new Error("not implemented in trash route test double");
    },
    sync: async () => {
      throw new Error("not implemented in trash route test double");
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
      return 0;
    },
    purgeExpiredTrash: async () => {
      throw new Error("not implemented in trash route test double");
    },
  };

  return { notesService, calls };
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
let serviceCalls: Array<{ method: string; args: Record<string, unknown> }>;

before(async () => {
  const { notesService, calls } = createNotesServiceDouble();
  serviceCalls = calls;

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

  server = await startNextTestServer({ routes: notesTrashRouteRegistrations });
});

after(async () => {
  await server.close();
  resetComposedServicesForTests();
});

afterEach(() => {
  resetPoolErrorStateForTests();
  serviceCalls.length = 0;
});

test("trash lifecycle routes return 401 without auth or guest headers", async () => {
  const trash = await server.fetch("/api/notes/note-2", { method: "DELETE" });
  const restore = await server.fetch("/api/notes/note-2/restore", { method: "POST" });
  const permanent = await server.fetch("/api/notes/note-2/permanent", { method: "DELETE" });
  const empty = await server.fetch("/api/notes/trash/empty", { method: "DELETE" });

  for (const response of [trash, restore, permanent, empty]) {
    const payload = await readJson(response);
    assert.equal(response.status, 401);
    assert.equal(payload.code, "auth");
    assert.equal(payload.status, 401);
  }
});

test("DELETE /api/notes/:noteId soft-deletes and returns { deleted: boolean }", async () => {
  const response = await server.fetch("/api/notes/note-trash-1", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepStrictEqual(payload, { deleted: true });
  assert.equal(serviceCalls.length, 1);
  assert.equal(serviceCalls[0]?.method, "trashNote");
  assert.deepStrictEqual(serviceCalls[0]?.args, {
    userId: AUTH_USER_ID,
    noteId: "note-trash-1",
  });
});

test("POST /api/notes/:noteId/restore returns { restored: boolean }", async () => {
  const response = await server.fetch("/api/notes/note-restore-1/restore", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepStrictEqual(payload, { restored: true });
  assert.equal(serviceCalls[0]?.method, "restoreNote");
  assert.deepStrictEqual(serviceCalls[0]?.args, {
    userId: AUTH_USER_ID,
    noteId: "note-restore-1",
  });
});

test("DELETE /api/notes/:noteId/permanent returns { deleted: boolean }", async () => {
  const response = await server.fetch("/api/notes/note-permanent-1/permanent", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepStrictEqual(payload, { deleted: true });
  assert.equal(serviceCalls[0]?.method, "permanentlyDeleteNote");
  assert.deepStrictEqual(serviceCalls[0]?.args, {
    userId: AUTH_USER_ID,
    noteId: "note-permanent-1",
  });
});

test("DELETE /api/notes/trash/empty returns { deleted: number }", async () => {
  const response = await server.fetch("/api/notes/trash/empty", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepStrictEqual(payload, { deleted: 0 });
  assert.equal(serviceCalls[0]?.method, "emptyTrash");
  assert.deepStrictEqual(serviceCalls[0]?.args, { userId: AUTH_USER_ID });
});

test("invalid noteId param returns 400 validation", async () => {
  const request = new NextRequest("http://localhost/api/notes/invalid/restore", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const response = await restoreNotePost(request, {
    params: Promise.resolve({ noteId: "" }),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(payload.code, "validation");
  assert.equal(serviceCalls.length, 0);
});

test("restore, permanent delete, and empty trash routes map to lifecycle operations", async () => {
  const trash = await server.fetch("/api/notes/note-2", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(trash.status, 200);
  assert.deepStrictEqual(await trash.json(), { deleted: true });

  const restore = await server.fetch("/api/notes/note-2/restore", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(restore.status, 200);
  assert.deepStrictEqual(await restore.json(), { restored: true });

  await server.fetch("/api/notes/note-2", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });

  const permanent = await server.fetch("/api/notes/note-2/permanent", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(permanent.status, 200);
  assert.deepStrictEqual(await permanent.json(), { deleted: true });

  const empty = await server.fetch("/api/notes/trash/empty", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(empty.status, 200);
  assert.deepStrictEqual(await empty.json(), { deleted: 0 });
});

test("DELETE /api/notes/:noteId returns 500 internal when dependencies are degraded", async () => {
  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);
  mockPool.emit(new Error("idle client connection lost"));

  const response = await server.fetch("/api/notes/note-2", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 500);
  assert.deepStrictEqual(payload, {
    code: "internal",
    message: "Internal server error",
    status: 500,
  });
});