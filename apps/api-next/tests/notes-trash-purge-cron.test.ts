import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CRON_NOTES_TRASH_PURGE_PATH,
  notesTrashPurgeCronAuthHeaders,
  startNotesTrashPurgeCronTestServer,
} from "./support/notes-trash-purge-cron-test-server";

const CRON_SECRET = "test-cron-secret";

const createNotesServiceDouble = () => {
  let purgeCount = 0;

  return {
    purgeJob: {
      run: async () => {
        purgeCount += 1;
        return { scanned: 3, deleted: 2 };
      },
    },
    getPurgeCount: () => purgeCount,
  };
};

test("notes trash purge cron returns summary on authorized GET", async () => {
  const { purgeJob, getPurgeCount } = createNotesServiceDouble();
  const server = await startNotesTrashPurgeCronTestServer({
    purgeJob,
    cronSecret: CRON_SECRET,
  });

  try {
    const response = await server.fetch(CRON_NOTES_TRASH_PURGE_PATH, {
      method: "GET",
      headers: notesTrashPurgeCronAuthHeaders(CRON_SECRET),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { scanned: 3, deleted: 2 });
    assert.equal(getPurgeCount(), 1);
  } finally {
    await server.close();
  }
});

test("notes trash purge cron supports POST for manual maintenance invocations", async () => {
  const { purgeJob, getPurgeCount } = createNotesServiceDouble();
  const server = await startNotesTrashPurgeCronTestServer({
    purgeJob,
    cronSecret: CRON_SECRET,
  });

  try {
    const response = await server.fetch(CRON_NOTES_TRASH_PURGE_PATH, {
      method: "POST",
      headers: notesTrashPurgeCronAuthHeaders(CRON_SECRET),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { scanned: 3, deleted: 2 });
    assert.equal(getPurgeCount(), 1);
  } finally {
    await server.close();
  }
});

test("notes trash purge cron rejects unauthenticated requests", async () => {
  const { purgeJob, getPurgeCount } = createNotesServiceDouble();
  const server = await startNotesTrashPurgeCronTestServer({
    purgeJob,
    cronSecret: CRON_SECRET,
  });

  try {
    const response = await server.fetch(CRON_NOTES_TRASH_PURGE_PATH, { method: "GET" });

    assert.equal(response.status, 401);
    const payload = (await response.json()) as Record<string, unknown>;
    assert.equal(payload.code, "auth");
    assert.equal(payload.message, "Invalid cron authorization");
    assert.equal(payload.status, 401);
    assert.equal(getPurgeCount(), 0);
  } finally {
    await server.close();
  }
});
