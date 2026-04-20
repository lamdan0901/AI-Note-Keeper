import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';

import { createCheckpoint, validateCheckpoint } from '../migration-tools/checkpoints.js';
import { runMigrationToolCommand } from '../migration-tools/index.js';
import {
  createDryRunArtifact,
  createDryRunSummary,
  createReconcileReport,
} from '../migration-tools/reporting.js';

const TMP_DIR = 'tmp/tools-suite';
const SOURCE_PATH = `${TMP_DIR}/source.json`;
const TARGET_PATH = `${TMP_DIR}/target.json`;
const EXPORT_PATH = `${TMP_DIR}/export.json`;
const CHECKPOINT_PATH = `${TMP_DIR}/import.checkpoint.json`;

const writeReconcileFixtures = async (): Promise<void> => {
  await mkdir(TMP_DIR, { recursive: true });

  await writeFile(
    SOURCE_PATH,
    JSON.stringify(
      {
        command: 'export',
        generatedAt: '2026-04-19T00:00:00.000Z',
        checksum: 'source',
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
            users: [{ id: 'user-a' }],
            notes: [],
            noteChangeEvents: [],
            subscriptions: [],
            devicePushTokens: [],
            cronState: [],
            migrationAttempts: [],
            refreshTokens: [],
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    TARGET_PATH,
    JSON.stringify(
      {
        generatedAt: '2026-04-19T00:00:00.000Z',
        entities: {
          users: [{ id: 'user-a' }, { id: 'user-b' }],
          notes: [],
          noteChangeEvents: [],
          subscriptions: [],
          devicePushTokens: [],
          cronState: [],
          migrationAttempts: [],
          refreshTokens: [],
        },
      },
      null,
      2,
    ),
    'utf8',
  );
};

test.beforeEach(async () => {
  await writeReconcileFixtures();
});

test.afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

test('migration-tools export/import/reconcile commands parse options and execute adapters', async () => {
  const exportResult = await runMigrationToolCommand([
    'node',
    'migration-tools',
    'export',
    '--dry-run',
    '--output',
    EXPORT_PATH,
    '--batch-size',
    '500',
  ]);

  const importResult = await runMigrationToolCommand([
    'node',
    'migration-tools',
    'import',
    '--dry-run',
    '--input',
    EXPORT_PATH,
    '--checkpoint',
    CHECKPOINT_PATH,
  ]);

  const reconcileResult = await runMigrationToolCommand([
    'node',
    'migration-tools',
    'reconcile',
    '--dry-run',
    '--source',
    SOURCE_PATH,
    '--target',
    TARGET_PATH,
    '--max-count-drift',
    '2',
    '--max-checksum-mismatch',
    '1',
    '--max-sample-drift',
    '1',
  ]);

  assert.equal(exportResult.command, 'export');
  assert.equal(importResult.command, 'import');
  assert.equal(reconcileResult.command, 'reconcile');
  assert.equal(reconcileResult.report.thresholds.maxCountDrift, 2);
  assert.equal(reconcileResult.report.thresholds.maxChecksumMismatch, 1);
  assert.equal(reconcileResult.report.thresholds.maxSampleDrift, 1);
});

test('dry-run artifacts and summaries are deterministic for identical input', () => {
  const input = {
    command: 'reconcile' as const,
    generatedAt: '2026-04-18T00:00:00.000Z',
    data: {
      b: 'two',
      a: 'one',
      nested: {
        z: 2,
        y: 1,
      },
    },
  };

  const first = createDryRunArtifact(input);
  const second = createDryRunArtifact(input);

  assert.deepStrictEqual(first, second);

  const firstSummary = createDryRunSummary(first.command, first.checksum, first.data);
  const secondSummary = createDryRunSummary(second.command, second.checksum, second.data);
  assert.equal(firstSummary, secondSummary);
});

test('checkpoint validation and reconcile report contracts include threshold pass/fail fields', () => {
  const checkpoint = createCheckpoint('import', 'resume-001', 12, '2026-04-18T00:00:00.000Z');
  const checkpointValidation = validateCheckpoint(checkpoint);

  assert.equal(checkpointValidation.valid, true);
  assert.deepStrictEqual(checkpointValidation.issues, []);

  const invalidCheckpoint = validateCheckpoint({ command: 'import' });
  assert.equal(invalidCheckpoint.valid, false);
  assert.ok(invalidCheckpoint.issues.length > 0);

  const report = createReconcileReport(
    [],
    {
      source: 100,
      target: 99,
      drift: 1,
    },
    {
      source: 'abc',
      target: 'abd',
      mismatch: 1,
    },
    {
      sampled: 20,
      drift: 1,
    },
    {
      maxCountDrift: 1,
      maxChecksumMismatch: 1,
      maxSampleDrift: 1,
    },
  );

  assert.equal(typeof report.pass, 'boolean');
  assert.deepStrictEqual(report.thresholds, {
    maxCountDrift: 1,
    maxChecksumMismatch: 1,
    maxSampleDrift: 1,
  });
});
