import assert from "node:assert/strict";
import { test } from "node:test";

import { createPhase3NotesSyncDouble } from "../support/phase3-notes-double";
import {
  authHeaders,
  startNotesTestServer,
} from "../support/notes-test-server";

const AUTH_USER_ID = "user-1";

const jsonHeaders = (token: string): Headers => {
  const headers = authHeaders(token);
  headers.set("content-type", "application/json");
  return headers;
};

test("notes sync replay with same payloadHash is idempotent over HTTP", async () => {
  const { notesService, getNoteMutationCount } = createPhase3NotesSyncDouble();
  const server = await startNotesTestServer({
    notesService,
    authUserId: AUTH_USER_ID,
    authUsername: AUTH_USER_ID,
  });

  try {
    const body = {
      lastSyncAt: 1_700_000_000_000,
      changes: [
        {
          id: "note-1",
          userId: "ignored-client-user",
          operation: "update",
          payloadHash: "hash-1",
          deviceId: "device-1",
          updatedAt: 1_700_000_000_100,
          title: "Title",
        },
      ],
    };

    const first = await server.fetch("/api/notes/sync", {
      method: "POST",
      headers: jsonHeaders(server.accessToken),
      body: JSON.stringify(body),
    });

    const second = await server.fetch("/api/notes/sync", {
      method: "POST",
      headers: jsonHeaders(server.accessToken),
      body: JSON.stringify(body),
    });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(getNoteMutationCount(), 1);
  } finally {
    await server.close();
  }
});