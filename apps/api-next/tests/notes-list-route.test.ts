import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, afterEach, before, test } from "node:test";

import { createTokenFactory } from "@backend/auth/tokens";
import type { NoteRecord } from "@backend/notes/contracts.js";
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
import { GET as listNotesGet } from "../app/api/notes/route";
import {
  startNextTestServer,
  type NextTestServer,
  type RouteRegistration,
} from "./support/next-test-server";

const AUTH_USER_ID = "notes-route-user-1";

const notesRouteRegistrations: ReadonlyArray<RouteRegistration> = [
  { method: "GET", pathname: "/api/notes", handler: listNotesGet },
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

const createNotesServiceDouble = (): NotesService => ({
  listNotes: async (input) => {
    assert.equal(input.userId, AUTH_USER_ID);
    return [sampleNote()];
  },
  sync: async () => {
    throw new Error("not implemented in list route test double");
  },
  restoreNote: async () => {
    throw new Error("not implemented in list route test double");
  },
  trashNote: async () => {
    throw new Error("not implemented in list route test double");
  },
  permanentlyDeleteNote: async () => {
    throw new Error("not implemented in list route test double");
  },
  emptyTrash: async () => {
    throw new Error("not implemented in list route test double");
  },
  purgeExpiredTrash: async () => {
    throw new Error("not implemented in list route test double");
  },
});

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

before(async () => {
  const services = composeServices();
  setComposedServicesForTests({
    ...services,
    notesService: createNotesServiceDouble(),
  });

  const tokenFactory = createTokenFactory();
  const tokens = await tokenFactory.issueTokenPair({
    userId: AUTH_USER_ID,
    username: "alice",
  });
  accessToken = tokens.accessToken;

  server = await startNextTestServer({ routes: notesRouteRegistrations });
});

after(async () => {
  await server.close();
  resetComposedServicesForTests();
});

afterEach(() => {
  resetPoolErrorStateForTests();
});

test("GET /api/notes returns 401 without auth or guest headers", async () => {
  const response = await server.fetch("/api/notes");
  const payload = await readJson(response);

  assert.equal(response.status, 401);
  assert.equal(payload.code, "auth");
  assert.equal(payload.status, 401);
});

test("GET /api/notes returns 200 with notes array for bearer-authenticated user", async () => {
  const response = await server.fetch("/api/notes", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.notes));
  assert.equal((payload.notes as Array<Record<string, unknown>>).length, 1);
  assert.equal((payload.notes as Array<Record<string, unknown>>)[0]?.id, "note-1");
});

test("GET /api/notes returns 500 internal when dependencies are degraded", async () => {
  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);
  mockPool.emit(new Error("idle client connection lost"));

  const response = await server.fetch("/api/notes", {
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