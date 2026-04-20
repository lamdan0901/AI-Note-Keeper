import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createTokenFactory } from '../../auth/tokens.js';
import { errorMiddleware, notFoundMiddleware } from '../../middleware/error-middleware.js';
import { createNotesRoutes } from '../../notes/routes.js';
import type { NotesService } from '../../notes/service.js';
import type {
  NoteRecord,
  NoteSyncChange,
  NoteSyncRequest,
  NoteSyncResponse,
} from '../../notes/contracts.js';

const createNote = (
  input: Readonly<{ id: string; userId: string; title: string | null; updatedAt: number }>,
): NoteRecord => {
  const timestamp = new Date(input.updatedAt);

  return {
    id: input.id,
    userId: input.userId,
    title: input.title,
    content: null,
    contentType: null,
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
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const createServiceDouble = (): NotesService => {
  const notesByUser = new Map<string, Map<string, NoteRecord>>();
  const seenPayloads = new Set<string>();

  const getUserMap = (userId: string): Map<string, NoteRecord> => {
    const existing = notesByUser.get(userId);
    if (existing) {
      return existing;
    }

    const created = new Map<string, NoteRecord>();
    notesByUser.set(userId, created);
    return created;
  };

  const applySyncChange = (userId: string, change: NoteSyncChange): void => {
    const dedupeKey = `${change.id}:${userId}:${change.operation}:${change.payloadHash}`;
    if (seenPayloads.has(dedupeKey)) {
      return;
    }

    const userNotes = getUserMap(userId);
    const existing = userNotes.get(change.id);

    if (change.operation === 'delete') {
      if (existing && change.updatedAt > existing.updatedAt.getTime()) {
        userNotes.set(change.id, {
          ...existing,
          active: false,
          deletedAt: new Date(change.deletedAt ?? change.updatedAt),
          updatedAt: new Date(change.updatedAt),
          version: existing.version + 1,
        });
      }

      seenPayloads.add(dedupeKey);
      return;
    }

    if (!existing) {
      userNotes.set(
        change.id,
        createNote({
          id: change.id,
          userId,
          title: change.title ?? null,
          updatedAt: change.updatedAt,
        }),
      );
      seenPayloads.add(dedupeKey);
      return;
    }

    if (change.updatedAt > existing.updatedAt.getTime()) {
      userNotes.set(change.id, {
        ...existing,
        title: change.title ?? existing.title,
        active: change.active ?? existing.active,
        updatedAt: new Date(change.updatedAt),
        version: existing.version + 1,
      });
    }

    seenPayloads.add(dedupeKey);
  };

  return {
    listNotes: async ({ userId }) => {
      return [...getUserMap(userId).values()];
    },

    sync: async (input: NoteSyncRequest): Promise<NoteSyncResponse> => {
      input.changes.forEach((change) => {
        applySyncChange(input.userId, change);
      });

      return {
        notes: [...getUserMap(input.userId).values()],
        syncedAt: Date.now(),
      };
    },

    restoreNote: async ({ userId, noteId }) => {
      const userNotes = getUserMap(userId);
      const existing = userNotes.get(noteId);
      if (!existing) {
        return false;
      }

      userNotes.set(noteId, {
        ...existing,
        active: true,
        deletedAt: null,
        updatedAt: new Date(),
      });
      return true;
    },

    trashNote: async ({ userId, noteId }) => {
      const userNotes = getUserMap(userId);
      const existing = userNotes.get(noteId);
      if (!existing) {
        return false;
      }

      userNotes.set(noteId, {
        ...existing,
        active: false,
        deletedAt: new Date(),
        updatedAt: new Date(),
      });
      return true;
    },

    permanentlyDeleteNote: async ({ userId, noteId }) => {
      const userNotes = getUserMap(userId);
      const existing = userNotes.get(noteId);
      if (!existing || existing.active) {
        return false;
      }

      userNotes.delete(noteId);
      return true;
    },

    emptyTrash: async ({ userId }) => {
      const userNotes = getUserMap(userId);
      const toDelete = [...userNotes.values()]
        .filter((note) => !note.active)
        .map((note) => note.id);
      toDelete.forEach((noteId) => {
        userNotes.delete(noteId);
      });

      return toDelete.length;
    },

    purgeExpiredTrash: async () => {
      return 0;
    },
  };
};

const startServer = async (
  service: NotesService,
): Promise<Readonly<{ baseUrl: string; close: () => Promise<void> }>> => {
  const app = express();
  app.use(express.json());
  app.use('/api/notes', createNotesRoutes(service));
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  const server = await new Promise<Server>((resolve, reject) => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
    running.once('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
};

const createAccessToken = async (): Promise<string> => {
  const tokenFactory = createTokenFactory();
  const pair = await tokenFactory.issueTokenPair({
    userId: 'user-1',
    username: 'alice',
  });

  return pair.accessToken;
};

const syncRequest = (
  change: NoteSyncChange,
): Readonly<{ lastSyncAt: number; changes: NoteSyncChange[] }> => {
  return {
    lastSyncAt: 0,
    changes: [change],
  };
};

test('notes sync route is idempotent on replay and ignores stale updates', async () => {
  const service = createServiceDouble();
  const token = await createAccessToken();
  const server = await startServer(service);

  try {
    const baseChange: NoteSyncChange = {
      id: 'note-1',
      userId: 'ignored-by-route',
      operation: 'create',
      payloadHash: randomUUID(),
      deviceId: 'device-1',
      title: 'First',
      updatedAt: 1_700_000_100_000,
      createdAt: 1_700_000_100_000,
      active: true,
    };

    const first = await fetch(`${server.baseUrl}/api/notes/sync`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(syncRequest(baseChange)),
    });
    assert.equal(first.status, 200);

    const replay = await fetch(`${server.baseUrl}/api/notes/sync`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
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
      operation: 'update',
      payloadHash: randomUUID(),
      title: 'Stale',
      updatedAt: 1_700_000_000_000,
    };

    const stale = await fetch(`${server.baseUrl}/api/notes/sync`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(syncRequest(staleChange)),
    });
    const stalePayload = (await stale.json()) as { notes: Array<{ title: string | null }> };
    assert.equal(stale.status, 200);
    assert.equal(stalePayload.notes[0].title, 'First');
  } finally {
    await server.close();
  }
});

test('restore, permanent delete, and empty trash routes map to lifecycle operations', async () => {
  const service = createServiceDouble();
  const token = await createAccessToken();
  const server = await startServer(service);

  try {
    const seed: NoteSyncChange = {
      id: 'note-2',
      userId: 'ignored-by-route',
      operation: 'create',
      payloadHash: randomUUID(),
      deviceId: 'device-1',
      title: 'Lifecycle',
      updatedAt: 1_700_000_200_000,
      createdAt: 1_700_000_200_000,
      active: true,
    };

    await fetch(`${server.baseUrl}/api/notes/sync`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(syncRequest(seed)),
    });

    const trash = await fetch(`${server.baseUrl}/api/notes/note-2`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    assert.equal(trash.status, 200);
    assert.deepEqual(await trash.json(), { deleted: true });

    const restore = await fetch(`${server.baseUrl}/api/notes/note-2/restore`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    assert.equal(restore.status, 200);
    assert.deepEqual(await restore.json(), { restored: true });

    await fetch(`${server.baseUrl}/api/notes/note-2`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const permanent = await fetch(`${server.baseUrl}/api/notes/note-2/permanent`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    assert.equal(permanent.status, 200);
    assert.deepEqual(await permanent.json(), { deleted: true });

    const empty = await fetch(`${server.baseUrl}/api/notes/trash/empty`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { deleted: 0 });
  } finally {
    await server.close();
  }
});
