import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import type { NoteSyncChange } from "@backend/notes/contracts.js";

import {
  authHeaders,
  startNotesTestServer,
} from "./support/notes-test-server";

const syncRequest = (
  change: NoteSyncChange,
): Readonly<{ lastSyncAt: number; changes: NoteSyncChange[] }> => {
  return {
    lastSyncAt: 0,
    changes: [change],
  };
};

const jsonHeaders = (token: string): Headers => {
  const headers = authHeaders(token);
  headers.set("content-type", "application/json");
  return headers;
};

test("notes sync route is idempotent on replay and ignores stale updates", async () => {
  const server = await startNotesTestServer();

  try {
    const baseChange: NoteSyncChange = {
      id: "note-1",
      userId: "ignored-by-route",
      operation: "create",
      payloadHash: randomUUID(),
      deviceId: "device-1",
      title: "First",
      updatedAt: 1_700_000_100_000,
      createdAt: 1_700_000_100_000,
      active: true,
    };

    const first = await server.fetch("/api/notes/sync", {
      method: "POST",
      headers: jsonHeaders(server.accessToken),
      body: JSON.stringify(syncRequest(baseChange)),
    });
    assert.equal(first.status, 200);

    const replay = await server.fetch("/api/notes/sync", {
      method: "POST",
      headers: jsonHeaders(server.accessToken),
      body: JSON.stringify(syncRequest(baseChange)),
    });
    const replayPayload = (await replay.json()) as {
      notes: Array<{ title: string | null; version: number }>;
    };
    assert.equal(replay.status, 200);
    assert.equal(replayPayload.notes.length, 1);
    assert.equal(replayPayload.notes[0].version, 1);

    const staleChange: NoteSyncChange = {
      ...baseChange,
      operation: "update",
      payloadHash: randomUUID(),
      title: "Stale",
      updatedAt: 1_700_000_000_000,
    };

    const stale = await server.fetch("/api/notes/sync", {
      method: "POST",
      headers: jsonHeaders(server.accessToken),
      body: JSON.stringify(syncRequest(staleChange)),
    });
    const stalePayload = (await stale.json()) as { notes: Array<{ title: string | null }> };
    assert.equal(stale.status, 200);
    assert.equal(stalePayload.notes[0].title, "First");
  } finally {
    await server.close();
  }
});

test("restore, permanent delete, and empty trash routes map to lifecycle operations", async () => {
  const server = await startNotesTestServer();

  try {
    const seed: NoteSyncChange = {
      id: "note-2",
      userId: "ignored-by-route",
      operation: "create",
      payloadHash: randomUUID(),
      deviceId: "device-1",
      title: "Lifecycle",
      updatedAt: 1_700_000_200_000,
      createdAt: 1_700_000_200_000,
      active: true,
    };

    await server.fetch("/api/notes/sync", {
      method: "POST",
      headers: jsonHeaders(server.accessToken),
      body: JSON.stringify(syncRequest(seed)),
    });

    const trash = await server.fetch("/api/notes/note-2", {
      method: "DELETE",
      headers: authHeaders(server.accessToken),
    });
    assert.equal(trash.status, 200);
    assert.deepEqual(await trash.json(), { deleted: true });

    const restore = await server.fetch("/api/notes/note-2/restore", {
      method: "POST",
      headers: authHeaders(server.accessToken),
    });
    assert.equal(restore.status, 200);
    assert.deepEqual(await restore.json(), { restored: true });

    await server.fetch("/api/notes/note-2", {
      method: "DELETE",
      headers: authHeaders(server.accessToken),
    });

    const permanent = await server.fetch("/api/notes/note-2/permanent", {
      method: "DELETE",
      headers: authHeaders(server.accessToken),
    });
    assert.equal(permanent.status, 200);
    assert.deepEqual(await permanent.json(), { deleted: true });

    const empty = await server.fetch("/api/notes/trash/empty", {
      method: "DELETE",
      headers: authHeaders(server.accessToken),
    });
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { deleted: 0 });
  } finally {
    await server.close();
  }
});