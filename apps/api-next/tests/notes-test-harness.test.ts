import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, test } from "node:test";

import type { NoteSyncChange } from "@backend/notes/contracts.js";

import { resetGuestRateLimitStateForTests } from "../src/http/auth/require-access";
import {
  authHeaders,
  DEFAULT_AUTH_USER_ID,
  DEFAULT_GUEST_USER_ID,
  guestHeaders,
  startNotesTestServer,
  type NotesTestServer,
} from "./support/notes-test-server";

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  return (await response.json()) as Record<string, unknown>;
};

const minimalSyncChange = (): NoteSyncChange => ({
  id: "note-harness-1",
  userId: "client-supplied-user-id",
  operation: "create",
  payloadHash: randomUUID(),
  deviceId: "device-1",
  title: "Harness note",
  updatedAt: 1_700_000_100_000,
  createdAt: 1_700_000_100_000,
  active: true,
});

let server: NotesTestServer;

after(async () => {
  if (server) {
    await server.close();
  }
});

afterEach(() => {
  resetGuestRateLimitStateForTests();
});

test("notes test harness binds an ephemeral port instead of :3001", async () => {
  server = await startNotesTestServer();

  assert.notEqual(server.port, 3001);
  assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test("notes test harness dispatches GET /api/notes with bearer auth", async () => {
  const isolatedServer = await startNotesTestServer();

  try {
    const response = await isolatedServer.fetch("/api/notes", {
      headers: authHeaders(isolatedServer.accessToken),
    });
    const payload = await readJson(response);

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(payload.notes));
    assert.equal(isolatedServer.calls.length, 1);
    assert.equal(isolatedServer.calls[0]?.method, "listNotes");
    assert.equal(isolatedServer.calls[0]?.args.userId, DEFAULT_AUTH_USER_ID);
  } finally {
    await isolatedServer.close();
  }
});

test("notes test harness dispatches POST /api/notes/sync with bearer auth", async () => {
  const isolatedServer = await startNotesTestServer();

  try {
    const response = await isolatedServer.fetch("/api/notes/sync", {
      method: "POST",
      headers: {
        ...Object.fromEntries(authHeaders(isolatedServer.accessToken).entries()),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        lastSyncAt: 0,
        changes: [minimalSyncChange()],
      }),
    });
    const payload = await readJson(response);

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(payload.notes));
    assert.equal(typeof payload.syncedAt, "number");
    assert.equal(isolatedServer.calls.length, 1);
    assert.equal(isolatedServer.calls[0]?.method, "sync");
    assert.equal(isolatedServer.calls[0]?.args.userId, DEFAULT_AUTH_USER_ID);
  } finally {
    await isolatedServer.close();
  }
});

test("notes test harness dispatches GET /api/notes with guest headers (no DB)", async () => {
  const isolatedServer = await startNotesTestServer({
    authUserId: DEFAULT_GUEST_USER_ID,
  });

  try {
    const response = await isolatedServer.fetch("/api/notes", {
      headers: guestHeaders({
        platform: "web",
        guestUserId: DEFAULT_GUEST_USER_ID,
      }),
    });
    const payload = await readJson(response);

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(payload.notes));
    assert.equal(isolatedServer.calls.length, 1);
    assert.equal(isolatedServer.calls[0]?.method, "listNotes");
    assert.equal(isolatedServer.calls[0]?.args.userId, DEFAULT_GUEST_USER_ID);
  } finally {
    await isolatedServer.close();
  }
});

test("notes test harness dispatches POST /api/notes/sync with mobile guest headers", async () => {
  const guestUserId = "web-guest-223e4567-e89b-12d3-a456-426614174001";
  const isolatedServer = await startNotesTestServer({
    authUserId: guestUserId,
  });

  try {
    const response = await isolatedServer.fetch("/api/notes/sync", {
      method: "POST",
      headers: {
        ...Object.fromEntries(
          guestHeaders({ platform: "mobile", guestUserId }).entries(),
        ),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        lastSyncAt: 0,
        changes: [minimalSyncChange()],
      }),
    });
    const payload = await readJson(response);

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(payload.notes));
    assert.equal(isolatedServer.calls[0]?.method, "sync");
    assert.equal(isolatedServer.calls[0]?.args.userId, guestUserId);
  } finally {
    await isolatedServer.close();
  }
});

test("notes test harness dispatches dynamic [noteId] trash routes", async () => {
  const isolatedServer = await startNotesTestServer();

  try {
    const seed = await isolatedServer.fetch("/api/notes/sync", {
      method: "POST",
      headers: {
        ...Object.fromEntries(authHeaders(isolatedServer.accessToken).entries()),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        lastSyncAt: 0,
        changes: [
          {
            ...minimalSyncChange(),
            id: "note-dynamic-1",
          },
        ],
      }),
    });
    assert.equal(seed.status, 200);

    const trash = await isolatedServer.fetch("/api/notes/note-dynamic-1", {
      method: "DELETE",
      headers: authHeaders(isolatedServer.accessToken),
    });

    assert.equal(trash.status, 200);
    assert.deepStrictEqual(await trash.json(), { deleted: true });
    assert.equal(isolatedServer.calls[1]?.method, "trashNote");
    assert.deepStrictEqual(isolatedServer.calls[1]?.args, {
      userId: DEFAULT_AUTH_USER_ID,
      noteId: "note-dynamic-1",
    });
  } finally {
    await isolatedServer.close();
  }
});