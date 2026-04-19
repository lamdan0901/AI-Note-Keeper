import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';

import { createCheckpoint } from '../migration-tools/checkpoints.js';
import { runImportCommand } from '../migration-tools/commands/import.js';
import type {
  ExportEntityName,
  ExportRecord,
  ImportTargetAdapter,
} from '../migration-tools/contracts.js';

const TMP_DIR = 'tmp';
const INPUT_PATH = `${TMP_DIR}/import-export.json`;
const CHECKPOINT_PATH = `${TMP_DIR}/import.checkpoint.json`;

const exportFixture = {
  command: 'export',
  generatedAt: '2026-04-19T00:00:00.000Z',
  checksum: 'fixture-checksum',
  data: {
    entityOrder: [
      'users',
      'notes',
      'noteChangeEvents',
      'subscriptions',
      'devicePushTokens',
      'cronState',
      'migrationAttempts',
      'refreshTokens',
    ],
    entities: {
      users: [
        { id: 'user-a', username: 'alice', passwordHash: 'hash-a' },
        { id: 'user-b', username: 'bob', passwordHash: 'hash-b' },
      ],
      notes: [{ id: 'note-a', userId: 'user-a', active: true }],
      noteChangeEvents: [],
      subscriptions: [],
      devicePushTokens: [],
      cronState: [],
      migrationAttempts: [],
      refreshTokens: [],
    },
  },
} as const;

const writeFixture = async (): Promise<void> => {
  await mkdir(TMP_DIR, { recursive: true });
  await writeFile(INPUT_PATH, JSON.stringify(exportFixture, null, 2), 'utf8');
};

const normalizeRecordId = (record: ExportRecord): string => {
  const id = record.id;
  return typeof id === 'string' ? id : '';
};

test.beforeEach(async () => {
  await writeFixture();
});

test.afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

test('dry-run does not write', async () => {
  let writeCalls = 0;

  const targetAdapter: ImportTargetAdapter = {
    applyBatch: async () => {
      writeCalls += 1;
      return {
        processedRecords: 0,
      };
    },
  };

  const result = await runImportCommand(
    {
      dryRun: true,
      inputPath: INPUT_PATH,
      checkpointPath: CHECKPOINT_PATH,
      batchSize: 1,
    },
    {
      targetAdapter,
      nowIso: () => '2026-04-19T00:00:00.000Z',
    },
  );

  assert.equal(writeCalls, 0);
  assert.equal(result.command, 'import');
  assert.equal((result.dryRun.data as Record<string, unknown>).processedRecords, 3);
});

test('import is idempotent on re-run', async () => {
  const seen = new Map<string, ExportRecord>();

  const targetAdapter: ImportTargetAdapter = {
    applyBatch: async (input) => {
      for (const record of input.records) {
        const key = `${input.entity}:${normalizeRecordId(record)}`;
        seen.set(key, record);
      }

      return {
        processedRecords: input.records.length,
        lastProcessedId: normalizeRecordId(input.records[input.records.length - 1] ?? {}),
      };
    },
  };

  await runImportCommand(
    {
      dryRun: false,
      inputPath: INPUT_PATH,
      batchSize: 2,
    },
    {
      targetAdapter,
      nowIso: () => '2026-04-19T00:00:00.000Z',
    },
  );

  const firstRunCount = seen.size;

  await runImportCommand(
    {
      dryRun: false,
      inputPath: INPUT_PATH,
      batchSize: 2,
    },
    {
      targetAdapter,
      nowIso: () => '2026-04-19T00:00:00.000Z',
    },
  );

  assert.equal(seen.size, firstRunCount);
});

test('resume starts after checkpoint', async () => {
  const appliedIds: Array<string> = [];

  const targetAdapter: ImportTargetAdapter = {
    applyBatch: async (input) => {
      for (const record of input.records) {
        appliedIds.push(`${input.entity}:${normalizeRecordId(record)}`);
      }

      return {
        processedRecords: input.records.length,
        lastProcessedId: normalizeRecordId(input.records[input.records.length - 1] ?? {}),
      };
    },
  };

  const checkpoint = createCheckpoint(
    'import',
    'offset:1',
    1,
    '2026-04-19T00:00:00.000Z',
    'user-a',
  );

  await writeFile(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2), 'utf8');

  await runImportCommand(
    {
      dryRun: false,
      inputPath: INPUT_PATH,
      checkpointPath: CHECKPOINT_PATH,
      batchSize: 1,
    },
    {
      targetAdapter,
      nowIso: () => '2026-04-19T00:00:00.000Z',
    },
  );

  assert.equal(appliedIds[0], 'users:user-b');
});
