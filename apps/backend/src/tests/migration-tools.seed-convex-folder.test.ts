import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';

import {
  loadOrderedDatasetFromConvexFolder,
  parseSeedFromConvexFolderOptions,
} from '../migration-tools/seed-convex-folder.js';

let tmpDir = '';

test.beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'convex-seed-suite-'));
});

test.afterEach(async () => {
  if (tmpDir.length > 0) {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('parseSeedFromConvexFolderOptions reads command arguments', () => {
  const options = parseSeedFromConvexFolderOptions([
    '--source-dir',
    'old-convex-db',
    '--batch-size',
    '250',
    '--checkpoint',
    'tmp/import.checkpoint.json',
    '--dry-run',
  ]);

  assert.deepEqual(options, {
    sourceDir: 'old-convex-db',
    dryRun: true,
    checkpointPath: 'tmp/import.checkpoint.json',
    batchSize: 250,
  });
});

test('parseSeedFromConvexFolderOptions rejects non-positive batch size', () => {
  assert.throws(() => {
    parseSeedFromConvexFolderOptions(['--batch-size', '0']);
  }, /--batch-size must be a positive integer/);
});

test('parseSeedFromConvexFolderOptions rejects malformed batch size strings', () => {
  assert.throws(() => {
    parseSeedFromConvexFolderOptions(['--batch-size', '12abc']);
  }, /--batch-size must be a positive integer/);

  assert.throws(() => {
    parseSeedFromConvexFolderOptions([], {
      npm_config_batch_size: '1e3',
    });
  }, /--batch-size must be a positive integer/);

  assert.throws(() => {
    parseSeedFromConvexFolderOptions([], {
      npm_config_batch_size: '0',
    });
  }, /--batch-size must be a positive integer/);
});

test('parseSeedFromConvexFolderOptions accepts npm_config_batch_size=1', () => {
  const options = parseSeedFromConvexFolderOptions([], {
    npm_config_batch_size: '1',
  });

  assert.equal(options.batchSize, 1);
});

test('parseSeedFromConvexFolderOptions supports npm_config environment forwarding', () => {
  const options = parseSeedFromConvexFolderOptions([], {
    npm_config_source_dir: 'old-convex-db',
    npm_config_batch_size: '300',
    npm_config_checkpoint: 'tmp/from-env.checkpoint.json',
    npm_config_dry_run: 'true',
  });

  assert.deepEqual(options, {
    sourceDir: 'old-convex-db',
    dryRun: true,
    checkpointPath: 'tmp/from-env.checkpoint.json',
    batchSize: 300,
  });
});

test('parseSeedFromConvexFolderOptions supports npm positional fallback when env keeps booleans', () => {
  const options = parseSeedFromConvexFolderOptions(
    ['old-convex-db', 'tmp/positional.checkpoint.json', '200'],
    {
      npm_config_source_dir: 'true',
      npm_config_checkpoint: 'true',
      npm_config_batch_size: 'true',
      npm_config_dry_run: 'true',
    },
  );

  assert.deepEqual(options, {
    sourceDir: 'old-convex-db',
    dryRun: true,
    checkpointPath: 'tmp/positional.checkpoint.json',
    batchSize: 200,
  });
});

test('parseSeedFromConvexFolderOptions maps numeric positional value to batch size', () => {
  const options = parseSeedFromConvexFolderOptions(['old-convex-db', '500'], {
    npm_config_source_dir: 'true',
    npm_config_batch_size: 'true',
  });

  assert.deepEqual(options, {
    sourceDir: 'old-convex-db',
    dryRun: false,
    checkpointPath: undefined,
    batchSize: 500,
  });
});

test('parseSeedFromConvexFolderOptions rejects invalid npm_config_dry_run values', () => {
  assert.throws(() => {
    parseSeedFromConvexFolderOptions([], {
      npm_config_dry_run: 'maybe',
    });
  }, /Boolean flag value "maybe" is invalid/);
});

test('parseSeedFromConvexFolderOptions ignores blank npm_config_dry_run', () => {
  const options = parseSeedFromConvexFolderOptions([], {
    npm_config_dry_run: '',
  });

  assert.equal(options.dryRun, false);
});

test('parseSeedFromConvexFolderOptions rejects missing values for value flags', () => {
  assert.throws(() => {
    parseSeedFromConvexFolderOptions(['--checkpoint', '--dry-run']);
  }, /--checkpoint requires a value/);

  assert.throws(() => {
    parseSeedFromConvexFolderOptions(['--source-dir']);
  }, /--source-dir requires a value/);
});

test('loadOrderedDatasetFromConvexFolder maps _id to id and handles missing tables', async () => {
  const usersDir = path.join(tmpDir, 'users');
  const notesDir = path.join(tmpDir, 'notes');

  await mkdir(usersDir, { recursive: true });
  await mkdir(notesDir, { recursive: true });

  await writeFile(
    path.join(usersDir, 'documents.jsonl'),
    [
      JSON.stringify({ _id: 'convex-user-1', username: 'alice', passwordHash: 'secret-1' }),
      JSON.stringify({ _id: 'convex-user-2', username: 'bob', passwordHash: 'secret-2' }),
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    path.join(notesDir, 'documents.jsonl'),
    [
      JSON.stringify({ id: 'note-1', userId: 'convex-user-1', title: 'hello', content: 'world' }),
    ].join('\n'),
    'utf8',
  );

  const dataset = await loadOrderedDatasetFromConvexFolder(tmpDir);

  assert.equal(dataset.entities.users.length, 2);
  assert.equal(dataset.entities.notes.length, 1);
  assert.equal(dataset.entities.subscriptions.length, 0);

  const firstUser = dataset.entities.users[0] as Record<string, unknown>;
  assert.equal(firstUser.id, 'convex-user-1');
  assert.equal(firstUser.username, 'alice');
});

test('loadOrderedDatasetFromConvexFolder creates placeholder parents for orphan foreign keys', async () => {
  const usersDir = path.join(tmpDir, 'users');
  const notesDir = path.join(tmpDir, 'notes');
  const eventsDir = path.join(tmpDir, 'noteChangeEvents');

  await mkdir(usersDir, { recursive: true });
  await mkdir(notesDir, { recursive: true });
  await mkdir(eventsDir, { recursive: true });

  await writeFile(
    path.join(usersDir, 'documents.jsonl'),
    [JSON.stringify({ _id: 'convex-user-1', username: 'alice', passwordHash: 'secret-1' })].join(
      '\n',
    ),
    'utf8',
  );

  await writeFile(
    path.join(notesDir, 'documents.jsonl'),
    [JSON.stringify({ id: 'note-1', userId: 'orphan-user-1', title: 'hello' })].join('\n'),
    'utf8',
  );

  await writeFile(
    path.join(eventsDir, 'documents.jsonl'),
    [
      JSON.stringify({
        _id: 'event-1',
        noteId: 'orphan-note-2',
        userId: 'orphan-user-2',
        operation: 'create',
        payloadHash: 'hash-1',
      }),
    ].join('\n'),
    'utf8',
  );

  const dataset = await loadOrderedDatasetFromConvexFolder(tmpDir);

  const userIds = new Set(
    dataset.entities.users
      .map((record) => (record as Record<string, unknown>).id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  assert.equal(userIds.has('convex-user-1'), true);
  assert.equal(userIds.has('orphan-user-1'), true);
  assert.equal(userIds.has('orphan-user-2'), true);

  const noteIds = new Set(
    dataset.entities.notes
      .map((record) => (record as Record<string, unknown>).id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  assert.equal(noteIds.has('note-1'), true);
  assert.equal(noteIds.has('orphan-note-2'), true);
});

test('loadOrderedDatasetFromConvexFolder merges legacy reminders and reminder events', async () => {
  const notesDir = path.join(tmpDir, 'notes');
  const remindersDir = path.join(tmpDir, 'reminders');
  const reminderEventsDir = path.join(tmpDir, 'reminderChangeEvents');

  await mkdir(notesDir, { recursive: true });
  await mkdir(remindersDir, { recursive: true });
  await mkdir(reminderEventsDir, { recursive: true });

  await writeFile(
    path.join(notesDir, 'documents.jsonl'),
    [JSON.stringify({ id: 'shared-id', userId: 'local-user', title: 'existing', content: 'keep-me' })].join(
      '\n',
    ),
    'utf8',
  );

  await writeFile(
    path.join(remindersDir, 'documents.jsonl'),
    [
      JSON.stringify({
        id: 'shared-id',
        triggerAt: 1769266389155,
        scheduleStatus: 'unscheduled',
        active: true,
      }),
      JSON.stringify({
        id: 'legacy-rem-1',
        userId: 'local-user',
        title: 'legacy reminder',
        triggerAt: 1769309700000,
        scheduleStatus: 'unscheduled',
        active: true,
      }),
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    path.join(reminderEventsDir, 'documents.jsonl'),
    [
      JSON.stringify({
        id: 'legacy-rem-evt-1',
        reminderId: 'legacy-rem-1',
        operation: 'create',
        payloadHash: 'hash-legacy-reminder',
        userId: 'local-user',
        changedAt: 1769309609962,
        deviceId: 'mobile-device-id',
      }),
    ].join('\n'),
    'utf8',
  );

  const dataset = await loadOrderedDatasetFromConvexFolder(tmpDir);

  const notesById = new Map(
    dataset.entities.notes
      .map((record) => {
        const row = record as Record<string, unknown>;
        return [row.id as string, row] as const;
      })
      .filter(([id]) => typeof id === 'string' && id.length > 0),
  );

  assert.equal(notesById.has('shared-id'), true);
  assert.equal(notesById.has('legacy-rem-1'), true);

  const mergedShared = notesById.get('shared-id') ?? {};
  assert.equal(mergedShared.content, 'keep-me');
  assert.equal(mergedShared.triggerAt, 1769266389155);
  assert.equal(mergedShared.userId, 'local-user');

  const legacyEvent = dataset.entities.noteChangeEvents.find((record) => {
    const row = record as Record<string, unknown>;
    return row.id === 'legacy-rem-evt-1';
  }) as Record<string, unknown> | undefined;

  assert.equal(legacyEvent?.noteId, 'legacy-rem-1');
  assert.equal(legacyEvent?.userId, 'local-user');
});

test('loadOrderedDatasetFromConvexFolder preserves duplicate notes while merging reminders', async () => {
  const notesDir = path.join(tmpDir, 'notes');
  const remindersDir = path.join(tmpDir, 'reminders');

  await mkdir(notesDir, { recursive: true });
  await mkdir(remindersDir, { recursive: true });

  await writeFile(
    path.join(notesDir, 'documents.jsonl'),
    [
      JSON.stringify({ id: 'dup-note', userId: 'user-a', title: 'older', updatedAt: 1 }),
      JSON.stringify({ id: 'dup-note', userId: 'user-b', title: 'newer', updatedAt: 2 }),
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    path.join(remindersDir, 'documents.jsonl'),
    [JSON.stringify({ id: 'rem-only', userId: 'user-a', title: 'reminder-only' })].join('\n'),
    'utf8',
  );

  const dataset = await loadOrderedDatasetFromConvexFolder(tmpDir);

  const duplicateRows = dataset.entities.notes.filter((record) => {
    const row = record as Record<string, unknown>;
    return row.id === 'dup-note';
  });

  assert.equal(duplicateRows.length, 2);

  const reminderAsNote = dataset.entities.notes.find((record) => {
    const row = record as Record<string, unknown>;
    return row.id === 'rem-only';
  });

  assert.equal(Boolean(reminderAsNote), true);
});

test('loadOrderedDatasetFromConvexFolder applies reminder overlay to final duplicate winner', async () => {
  const notesDir = path.join(tmpDir, 'notes');
  const remindersDir = path.join(tmpDir, 'reminders');

  await mkdir(notesDir, { recursive: true });
  await mkdir(remindersDir, { recursive: true });

  await writeFile(
    path.join(notesDir, 'documents.jsonl'),
    [
      JSON.stringify({ id: 'dup-note-rem', userId: 'user-a', title: 'older', updatedAt: 1 }),
      JSON.stringify({ id: 'dup-note-rem', userId: 'user-a', title: 'newer', updatedAt: 2 }),
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    path.join(remindersDir, 'documents.jsonl'),
    [JSON.stringify({ id: 'dup-note-rem', userId: 'user-a', scheduleStatus: 'unscheduled' })].join(
      '\n',
    ),
    'utf8',
  );

  const dataset = await loadOrderedDatasetFromConvexFolder(tmpDir);

  const duplicateRows = dataset.entities.notes.filter((record) => {
    const row = record as Record<string, unknown>;
    return row.id === 'dup-note-rem';
  }) as ReadonlyArray<Record<string, unknown>>;

  assert.equal(duplicateRows.length, 2);
  assert.equal(duplicateRows[0].scheduleStatus, 'unscheduled');
  assert.equal(duplicateRows[1].scheduleStatus, 'unscheduled');
});

test('loadOrderedDatasetFromConvexFolder rejects non-directory source paths', async () => {
  const sourceFile = path.join(tmpDir, 'not-a-directory.txt');
  await writeFile(sourceFile, 'nope', 'utf8');

  await assert.rejects(async () => {
    await loadOrderedDatasetFromConvexFolder(sourceFile);
  }, /must be a directory/);
});

test('loadOrderedDatasetFromConvexFolder rejects folders without entity files', async () => {
  await assert.rejects(async () => {
    await loadOrderedDatasetFromConvexFolder(tmpDir);
  }, /No Convex documents\.jsonl files found/);
});

test('loadOrderedDatasetFromConvexFolder rejects invalid JSONL rows', async () => {
  const usersDir = path.join(tmpDir, 'users');
  await mkdir(usersDir, { recursive: true });
  await writeFile(path.join(usersDir, 'documents.jsonl'), '{"_id":"u1"}\n{not-json}\n', 'utf8');

  await assert.rejects(async () => {
    await loadOrderedDatasetFromConvexFolder(tmpDir);
  }, /Invalid JSON/);
});
