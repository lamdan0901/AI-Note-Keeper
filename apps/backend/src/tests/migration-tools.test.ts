import assert from 'node:assert/strict';
import test from 'node:test';

import { createCheckpoint, validateCheckpoint } from '../migration-tools/checkpoints.js';
import { runMigrationToolCommand } from '../migration-tools/index.js';
import {
  createDryRunArtifact,
  createDryRunSummary,
  createReconcileReport,
} from '../migration-tools/reporting.js';

test('migration-tools export/import/reconcile commands parse options and execute no-op adapters', async () => {
  const exportResult = await runMigrationToolCommand([
    'node',
    'migration-tools',
    'export',
    '--dry-run',
    '--output',
    'tmp/export.json',
    '--batch-size',
    '500',
  ]);

  const importResult = await runMigrationToolCommand([
    'node',
    'migration-tools',
    'import',
    '--dry-run',
    '--input',
    'tmp/export.json',
    '--checkpoint',
    'tmp/import.checkpoint.json',
  ]);

  const reconcileResult = await runMigrationToolCommand([
    'node',
    'migration-tools',
    'reconcile',
    '--dry-run',
    '--source',
    'tmp/source.json',
    '--target',
    'tmp/target.json',
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
