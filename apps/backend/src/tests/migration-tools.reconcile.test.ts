import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';

import { runReconcileCommand } from '../migration-tools/commands/reconcile.js';

const TMP_DIR = 'tmp/reconcile-suite';
const SOURCE_PATH = `${TMP_DIR}/source-reconcile.json`;
const TARGET_PATH = `${TMP_DIR}/target-reconcile.json`;

const sourceFixture = {
  command: 'export',
  generatedAt: '2026-04-19T00:00:00.000Z',
  checksum: 'source-checksum',
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
      users: [{ id: 'user-a' }, { id: 'user-b' }],
      notes: [{ id: 'note-a', userId: 'user-a' }],
      noteChangeEvents: [],
      subscriptions: [],
      devicePushTokens: [],
      cronState: [{ key: 'check-reminders', lastCheckedAt: 1710000000000 }],
      migrationAttempts: [],
      refreshTokens: [],
    },
  },
} as const;

const targetFixture = {
  generatedAt: '2026-04-19T00:00:00.000Z',
  entities: {
    users: [{ id: 'user-a' }, { id: 'user-c' }],
    notes: [
      { id: 'note-a', userId: 'user-a' },
      { id: 'note-b', userId: 'user-a' },
    ],
    noteChangeEvents: [],
    subscriptions: [],
    devicePushTokens: [],
    cronState: [{ key: 'check-reminders', lastCheckedAt: 1710000000000 }],
    migrationAttempts: [],
    refreshTokens: [],
  },
} as const;

const writeFixtures = async (): Promise<void> => {
  await mkdir(TMP_DIR, { recursive: true });
  await writeFile(SOURCE_PATH, JSON.stringify(sourceFixture, null, 2), 'utf8');
  await writeFile(TARGET_PATH, JSON.stringify(targetFixture, null, 2), 'utf8');
};

test.beforeEach(async () => {
  await writeFixtures();
});

test.afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

test('reconcile computes source/target counts and checksum mismatches from real snapshots', async () => {
  const result = await runReconcileCommand({
    dryRun: true,
    sourcePath: SOURCE_PATH,
    targetPath: TARGET_PATH,
    thresholds: {
      maxCountDrift: 5,
      maxChecksumMismatch: 5,
      maxSampleDrift: 5,
    },
  });

  assert.equal(result.report.counts.source, 4);
  assert.equal(result.report.counts.target, 5);
  assert.equal(result.report.counts.drift, 1);
  assert.ok(result.report.checksums.mismatch > 0);
});

test('reconcile is fail-closed when sample drift exceeds configured threshold', async () => {
  const result = await runReconcileCommand({
    dryRun: true,
    sourcePath: SOURCE_PATH,
    targetPath: TARGET_PATH,
    thresholds: {
      maxCountDrift: 10,
      maxChecksumMismatch: 10,
      maxSampleDrift: 0,
    },
  });

  assert.equal(result.report.sampling.drift > 0, true);
  assert.equal(result.report.pass, false);
});
