import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import test from 'node:test';

import { runMigrations } from '../migrate.js';

type QueryCall = Readonly<{
  text: string;
  values?: ReadonlyArray<unknown>;
}>;

const createRunnerHarness = (appliedVersions: ReadonlyArray<string>) => {
  const calls: Array<QueryCall> = [];

  const client = {
    query: async (text: string, values?: ReadonlyArray<unknown>) => {
      calls.push({ text, values });

      if (text.includes('SELECT version FROM schema_migrations')) {
        return {
          rows: appliedVersions.map((version) => ({ version })),
        };
      }

      return {
        rows: [],
      };
    },
    release: () => {
      // no-op in tests
    },
  };

  const migrationPool = {
    connect: async () => client,
    end: async () => {
      // no-op in tests
    },
  };

  const fileSystem = {
    access: async () => {
      // no-op in tests
    },
    readdir: async () => ['00002_second.sql', '00001_first.sql', 'README.md'],
    readFile: async (target: string) => `-- sql from ${target}`,
  };

  const logger = {
    info: (_message: string) => {
      // no-op in tests
    },
    error: (_message: string, _error?: unknown) => {
      // no-op in tests
    },
  };

  return {
    calls,
    migrationPool,
    fileSystem,
    logger,
  };
};

const appliedOrderFromCalls = (calls: ReadonlyArray<QueryCall>): ReadonlyArray<string> => {
  return calls
    .filter((call) => call.text.includes('INSERT INTO schema_migrations'))
    .map((call) => {
      const values = call.values;

      if (!values || values.length === 0 || typeof values[0] !== 'string') {
        throw new Error('Expected migration insert call with version string');
      }

      return values[0];
    });
};

test('runMigrations applies SQL files in deterministic sorted order', async () => {
  const harness = createRunnerHarness([]);

  const result = await runMigrations({
    migrationPool: harness.migrationPool,
    fileSystem: harness.fileSystem,
    logger: harness.logger,
    migrationsPath: '/tmp/migrations',
  });

  assert.deepStrictEqual(appliedOrderFromCalls(harness.calls), ['00001_first.sql', '00002_second.sql']);
  assert.equal(result.appliedCount, 2);
  assert.deepStrictEqual(result.appliedVersions, ['00001_first.sql', '00002_second.sql']);
});

test('runMigrations skips already-applied versions and remains re-runnable', async () => {
  const harness = createRunnerHarness(['00001_first.sql']);

  const result = await runMigrations({
    migrationPool: harness.migrationPool,
    fileSystem: harness.fileSystem,
    logger: harness.logger,
    migrationsPath: '/tmp/migrations',
  });

  assert.deepStrictEqual(appliedOrderFromCalls(harness.calls), ['00002_second.sql']);
  assert.equal(result.appliedCount, 1);
  assert.deepStrictEqual(result.appliedVersions, ['00002_second.sql']);
});

test('HTTP startup flow does not auto-run migrations from runtime entrypoint', async () => {
  const indexSource = await fs.readFile(path.join(process.cwd(), 'src', 'index.ts'), 'utf-8');

  assert.equal(indexSource.includes('./migrate.js'), false);
  assert.equal(indexSource.includes('runMigrationCommand'), false);
});
