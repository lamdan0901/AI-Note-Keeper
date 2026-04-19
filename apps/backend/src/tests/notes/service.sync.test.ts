import assert from 'node:assert/strict';
import test from 'node:test';

import type { Request } from 'express';

import { requireAccessUser, type AuthenticatedRequest } from '../../auth/access-middleware.js';
import type { NoteRecord, NoteSyncChange } from '../../notes/contracts.js';
import { createNoteChangeEventsRepository } from '../../notes/repositories/note-change-events-repository.js';
import type { NoteChangeEventsRepository } from '../../notes/repositories/note-change-events-repository.js';
import {
  createNotesRepository,
  type NotePatchInput,
  type NotesRepository,
} from '../../notes/repositories/notes-repository.js';
import { createNotesService } from '../../notes/service.js';

const createNote = (
  input: Readonly<{
    id: string;
    userId: string;
    updatedAt: number;
    title?: string | null;
    repeat?: Record<string, unknown> | null;
    startAt?: Date | null;
    baseAtLocal?: string | null;
  }>,
): NoteRecord => {
  const timestamp = new Date(input.updatedAt);

  return {
    id: input.id,
    userId: input.userId,
    title: input.title ?? null,
    content: null,
    contentType: null,
    color: null,
    active: true,
    done: null,
    isPinned: null,
    triggerAt: null,
    repeatRule: null,
    repeatConfig: null,
    repeat: input.repeat ?? null,
    snoozedUntil: null,
    scheduleStatus: null,
    timezone: null,
    baseAtLocal: input.baseAtLocal ?? null,
    startAt: input.startAt ?? null,
    nextTriggerAt: null,
    lastFiredAt: null,
    lastAcknowledgedAt: null,
    version: 1,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const createInMemoryNotesRepository = (
  initialNotes: ReadonlyArray<NoteRecord>,
): NotesRepository & Readonly<{ byKey: Map<string, NoteRecord>; patches: NotePatchInput[] }> => {
  const byKey = new Map<string, NoteRecord>();
  initialNotes.forEach((note) => {
    byKey.set(`${note.userId}:${note.id}`, note);
  });
  const patches: NotePatchInput[] = [];

  return {
    byKey,
    patches,
    listByUser: async (userId) => {
      return [...byKey.values()].filter((note) => note.userId === userId);
    },
    findByIdForUser: async ({ noteId, userId }) => {
      return byKey.get(`${userId}:${noteId}`) ?? null;
    },
    create: async (input) => {
      const note = {
        ...createNote({
          id: input.id,
          userId: input.userId,
          updatedAt: input.updatedAt.getTime(),
          title: input.title,
          repeat: input.repeat,
          startAt: input.startAt,
          baseAtLocal: input.baseAtLocal,
        }),
        active: input.active,
        deletedAt: input.deletedAt,
        version: input.version,
      } satisfies NoteRecord;

      byKey.set(`${input.userId}:${input.id}`, note);
      return note;
    },
    patch: async ({ noteId, userId, patch }) => {
      patches.push(patch);
      const existing = byKey.get(`${userId}:${noteId}`);
      if (!existing) {
        return null;
      }

      const next = {
        ...existing,
        ...(Object.hasOwn(patch, 'title') ? { title: patch.title ?? null } : {}),
        ...(Object.hasOwn(patch, 'active') ? { active: patch.active ?? existing.active } : {}),
        ...(Object.hasOwn(patch, 'deletedAt') ? { deletedAt: patch.deletedAt ?? null } : {}),
        ...(Object.hasOwn(patch, 'repeat') ? { repeat: patch.repeat ?? null } : {}),
        ...(Object.hasOwn(patch, 'startAt') ? { startAt: patch.startAt ?? null } : {}),
        ...(Object.hasOwn(patch, 'baseAtLocal') ? { baseAtLocal: patch.baseAtLocal ?? null } : {}),
        ...(Object.hasOwn(patch, 'updatedAt')
          ? { updatedAt: patch.updatedAt ?? existing.updatedAt }
          : {}),
        ...(Object.hasOwn(patch, 'version') ? { version: patch.version ?? existing.version } : {}),
      };

      byKey.set(`${userId}:${noteId}`, next);
      return next;
    },
    hardDelete: async ({ noteId, userId }) => {
      return byKey.delete(`${userId}:${noteId}`);
    },
    emptyTrash: async ({ userId }) => {
      const removable = [...byKey.values()]
        .filter((note) => note.userId === userId && note.active === false)
        .map((note) => note.id);

      removable.forEach((noteId) => {
        byKey.delete(`${userId}:${noteId}`);
      });

      return removable.length;
    },
  };
};

const createInMemoryChangeEventsRepository = (): NoteChangeEventsRepository => {
  const seen = new Set<string>();

  return {
    isDuplicate: async ({ noteId, userId, operation, payloadHash }) => {
      return seen.has(`${noteId}:${userId}:${operation}:${payloadHash}`);
    },
    appendEvent: async ({ noteId, userId, operation, payloadHash }) => {
      seen.add(`${noteId}:${userId}:${operation}:${payloadHash}`);
    },
  };
};

test('requireAccessUser rejects missing access token', async () => {
  const middleware = requireAccessUser({
    tokenFactory: {
      verifyAccessToken: async () => {
        throw new Error('should not run');
      },
    },
  });

  const request = {
    header: () => undefined,
  } as unknown as Request;

  const error = await new Promise<unknown>((resolve) => {
    middleware(request, {} as never, (nextError) => {
      resolve(nextError);
    });
  });

  assert.equal(typeof error, 'object');
  assert.equal((error as { code?: string }).code, 'auth');
  assert.equal((error as { message?: string }).message, 'Access token is required');
});

test('requireAccessUser injects authenticated user from access token', async () => {
  const middleware = requireAccessUser({
    tokenFactory: {
      verifyAccessToken: async (token) => {
        assert.equal(token, 'token-123');
        return {
          type: 'access',
          userId: 'user-1',
          username: 'alice',
          sessionId: 'session-1',
        };
      },
    },
  });

  const request = {
    header: (name: string) => {
      if (name.toLowerCase() === 'authorization') {
        return 'Bearer token-123';
      }

      return undefined;
    },
  } as unknown as Request;

  const error = await new Promise<unknown>((resolve) => {
    middleware(request, {} as never, (nextError) => {
      resolve(nextError);
    });
  });

  assert.equal(error, undefined);
  const authenticated = request as AuthenticatedRequest;
  assert.deepEqual(authenticated.authUser, {
    userId: 'user-1',
    username: 'alice',
  });
});

test('notes repository ownership predicates scope mutations by note id and user id', async () => {
  const queries: string[] = [];

  const repository = createNotesRepository({
    db: {
      query: async (text) => {
        queries.push(text);
        return { rows: [] };
      },
    },
  });

  await repository.findByIdForUser({ noteId: 'note-1', userId: 'user-1' });
  await repository.patch({
    noteId: 'note-1',
    userId: 'user-1',
    patch: {
      title: 'Updated',
    },
  });

  assert.match(queries[0], /where id = \$1 and user_id = \$2/i);
  assert.match(queries[1], /where id = \$2 and user_id = \$3/i);
});

test('note change events repository dedupe check scopes by note, user, operation, and payload hash', async () => {
  const capturedTexts: string[] = [];
  const capturedValues: Array<ReadonlyArray<unknown>> = [];

  const repository = createNoteChangeEventsRepository({
    db: {
      query: async (text, values) => {
        capturedTexts.push(text);
        capturedValues.push(values ?? []);
        return { rows: [] };
      },
    },
  });

  const isDuplicate = await repository.isDuplicate({
    noteId: 'note-1',
    userId: 'user-1',
    operation: 'update',
    payloadHash: 'hash-1',
  });

  assert.equal(isDuplicate, false);
  assert.equal(capturedTexts.length, 1);
  assert.match(capturedTexts[0], /where note_id = \$1/i);
  assert.match(capturedTexts[0], /and user_id = \$2/i);
  assert.match(capturedTexts[0], /and operation = \$3/i);
  assert.match(capturedTexts[0], /and payload_hash = \$4/i);
  assert.deepEqual(capturedValues[0], ['note-1', 'user-1', 'update', 'hash-1']);
});

test('sync applies incoming updates only when incoming.updatedAt is strictly newer', async () => {
  const notesRepository = createInMemoryNotesRepository([
    createNote({
      id: 'note-1',
      userId: 'user-1',
      title: 'Server',
      updatedAt: 1_700_000_100_000,
    }),
  ]);
  const service = createNotesService({
    notesRepository,
    noteChangeEventsRepository: createInMemoryChangeEventsRepository(),
  });

  await service.sync({
    userId: 'user-1',
    lastSyncAt: 0,
    changes: [
      {
        id: 'note-1',
        userId: 'user-1',
        operation: 'update',
        payloadHash: 'stale-1',
        deviceId: 'device-1',
        title: 'Stale',
        updatedAt: 1_700_000_000_000,
      },
    ],
  });

  assert.equal(notesRepository.byKey.get('user-1:note-1')?.title, 'Server');

  await service.sync({
    userId: 'user-1',
    lastSyncAt: 0,
    changes: [
      {
        id: 'note-1',
        userId: 'user-1',
        operation: 'update',
        payloadHash: 'fresh-1',
        deviceId: 'device-1',
        title: 'Fresh',
        updatedAt: 1_700_000_200_000,
      },
    ],
  });

  assert.equal(notesRepository.byKey.get('user-1:note-1')?.title, 'Fresh');
});

test('sync preserves omitted canonical fields and clears explicit null canonical fields', async () => {
  const notesRepository = createInMemoryNotesRepository([
    createNote({
      id: 'note-2',
      userId: 'user-1',
      title: 'Canonical',
      updatedAt: 1_700_000_100_000,
      repeat: { kind: 'daily', interval: 1 },
      startAt: new Date(1_700_000_100_000),
      baseAtLocal: '2026-01-10T09:00:00',
    }),
  ]);
  const service = createNotesService({
    notesRepository,
    noteChangeEventsRepository: createInMemoryChangeEventsRepository(),
  });

  await service.sync({
    userId: 'user-1',
    lastSyncAt: 0,
    changes: [
      {
        id: 'note-2',
        userId: 'user-1',
        operation: 'update',
        payloadHash: 'omit-canonical',
        deviceId: 'device-1',
        title: 'Keep canonical',
        updatedAt: 1_700_000_200_000,
      },
    ],
  });

  const preserved = notesRepository.byKey.get('user-1:note-2');
  assert.ok(preserved);
  assert.deepEqual(preserved.repeat, { kind: 'daily', interval: 1 });
  assert.equal(preserved.baseAtLocal, '2026-01-10T09:00:00');

  await service.sync({
    userId: 'user-1',
    lastSyncAt: 0,
    changes: [
      {
        id: 'note-2',
        userId: 'user-1',
        operation: 'update',
        payloadHash: 'clear-canonical',
        deviceId: 'device-1',
        updatedAt: 1_700_000_300_000,
        repeat: null,
        startAt: null,
        baseAtLocal: null,
      },
    ],
  });

  const cleared = notesRepository.byKey.get('user-1:note-2');
  assert.ok(cleared);
  assert.equal(cleared.repeat, null);
  assert.equal(cleared.startAt, null);
  assert.equal(cleared.baseAtLocal, null);
});

test('concurrent timestamp winner uses deterministic latest updatedAt result', async () => {
  const notesRepository = createInMemoryNotesRepository([
    createNote({
      id: 'note-concurrent',
      userId: 'user-1',
      title: 'Base',
      updatedAt: 1_700_000_100_000,
    }),
  ]);
  const service = createNotesService({
    notesRepository,
    noteChangeEventsRepository: createInMemoryChangeEventsRepository(),
  });

  await Promise.all([
    service.sync({
      userId: 'user-1',
      lastSyncAt: 0,
      changes: [
        {
          id: 'note-concurrent',
          userId: 'user-1',
          operation: 'update',
          payloadHash: 'concurrent-a',
          deviceId: 'device-1',
          title: 'Older concurrent write',
          updatedAt: 1_700_000_200_000,
        },
      ],
    }),
    service.sync({
      userId: 'user-1',
      lastSyncAt: 0,
      changes: [
        {
          id: 'note-concurrent',
          userId: 'user-1',
          operation: 'update',
          payloadHash: 'concurrent-b',
          deviceId: 'device-2',
          title: 'Newer concurrent write',
          updatedAt: 1_700_000_300_000,
        },
      ],
    }),
  ]);

  assert.equal(
    notesRepository.byKey.get('user-1:note-concurrent')?.title,
    'Newer concurrent write',
  );
});

test('concurrent duplicate payloadHash replay applies one effective mutation', async () => {
  const notesRepository = createInMemoryNotesRepository([]);
  const service = createNotesService({
    notesRepository,
    noteChangeEventsRepository: createInMemoryChangeEventsRepository(),
  });

  const duplicateChange: NoteSyncChange = {
    id: 'note-dedupe',
    userId: 'user-1',
    operation: 'create',
    payloadHash: 'same-hash',
    deviceId: 'device-1',
    title: 'Created once',
    active: true,
    updatedAt: 1_700_000_400_000,
    createdAt: 1_700_000_400_000,
  };

  await Promise.all([
    service.sync({ userId: 'user-1', lastSyncAt: 0, changes: [duplicateChange] }),
    service.sync({ userId: 'user-1', lastSyncAt: 0, changes: [duplicateChange] }),
  ]);

  const created = notesRepository.byKey.get('user-1:note-dedupe');
  assert.ok(created);
  assert.equal(created.title, 'Created once');
  assert.equal(created.version, 1);
  assert.equal(notesRepository.byKey.size, 1);
});

test('same note id across users cannot mutate another user record', async () => {
  const notesRepository = createInMemoryNotesRepository([
    createNote({
      id: 'shared-note-id',
      userId: 'user-a',
      title: 'Owner value',
      updatedAt: 1_700_000_500_000,
    }),
  ]);
  const service = createNotesService({
    notesRepository,
    noteChangeEventsRepository: createInMemoryChangeEventsRepository(),
  });

  await service.sync({
    userId: 'user-b',
    lastSyncAt: 0,
    changes: [
      {
        id: 'shared-note-id',
        userId: 'user-b',
        operation: 'update',
        payloadHash: 'cross-user',
        deviceId: 'device-9',
        title: 'Attacker overwrite attempt',
        updatedAt: 1_700_000_600_000,
      },
    ],
  });

  assert.equal(notesRepository.byKey.get('user-a:shared-note-id')?.title, 'Owner value');
  assert.equal(
    notesRepository.byKey.get('user-b:shared-note-id')?.title,
    'Attacker overwrite attempt',
  );
});
