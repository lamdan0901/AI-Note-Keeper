import assert from 'node:assert/strict';
import test from 'node:test';

import { runExportCommand } from '../migration-tools/commands/export.js';
import { runMigrationToolCommand } from '../migration-tools/index.js';

const canonicalOrder = [
  'users',
  'notes',
  'noteChangeEvents',
  'subscriptions',
  'devicePushTokens',
  'cronState',
  'migrationAttempts',
  'refreshTokens',
] as const;

const stableSerialize = (value: unknown): string => {
  const sortObject = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map((entry) => sortObject(entry));
    }

    if (input && typeof input === 'object') {
      const entries = Object.entries(input as Record<string, unknown>).sort(([left], [right]) =>
        left.localeCompare(right),
      );

      return Object.fromEntries(entries.map(([key, item]) => [key, sortObject(item)]));
    }

    return input;
  };

  return JSON.stringify(sortObject(value));
};

// RED: This suite intentionally fails until deterministic export is implemented.
test('export uses canonical entity order', async () => {
  const result = await runExportCommand({
    dryRun: true,
    outputPath: 'tmp/export.json',
    batchSize: 500,
  });

  const entityOrder = (result.dryRun.data as Record<string, unknown>).entityOrder;

  assert.deepEqual(entityOrder, canonicalOrder);
});

// RED: This suite intentionally fails until deterministic export is implemented.
test('repeated export from identical source returns byte-identical payload and checksum', async () => {
  const options = {
    dryRun: true,
    outputPath: 'tmp/export.json',
    checkpointPath: 'tmp/export.checkpoint.json',
    batchSize: 50,
  };

  const first = await runExportCommand(options);
  const second = await runExportCommand(options);

  assert.equal(first.dryRun.checksum, second.dryRun.checksum);
  assert.equal(stableSerialize(first.dryRun.data), stableSerialize(second.dryRun.data));
});

// RED: This suite intentionally fails until deterministic export is implemented.
test('records inside each entity are sorted deterministically by stable keys', async () => {
  const result = await runExportCommand({
    dryRun: true,
    outputPath: 'tmp/export.json',
    batchSize: 100,
  });

  const entities = (result.dryRun.data as Record<string, unknown>).entities as Record<
    string,
    ReadonlyArray<Record<string, unknown>>
  >;

  const users = entities?.users ?? [];
  const userIds = users.map((record) => String(record.id ?? ''));

  assert.deepEqual(userIds, [...userIds].sort());
});

test('migration-tools command parser forwards output path and batch size for export', async () => {
  const commandResult = await runMigrationToolCommand([
    'node',
    'migration-tools',
    'export',
    '--dry-run',
    '--output',
    'tmp/export.json',
    '--batch-size',
    '50',
  ]);

  assert.equal(commandResult.command, 'export');

  const data = commandResult.dryRun.data as Record<string, unknown>;
  assert.equal(data.outputPath, 'tmp/export.json');
  assert.equal(data.batchSize, 50);
});
