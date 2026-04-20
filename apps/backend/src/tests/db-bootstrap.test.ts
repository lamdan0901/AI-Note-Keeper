import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureDatabaseExists } from '../db/bootstrap.js';

test('ensureDatabaseExists creates the target database when it is missing', async () => {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  let released = false;
  let ended = false;

  const client = {
    query: async (sql: string, values?: readonly unknown[]) => {
      calls.push({ sql, values });

      if (sql.startsWith('SELECT 1 FROM pg_database')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
    release: () => {
      released = true;
    },
  };

  await ensureDatabaseExists('postgresql://postgres:postgres@localhost:5432/ai_note_keeper', {
    createPool: () => ({
      connect: async () => client,
      end: async () => {
        ended = true;
      },
    }),
  });

  assert.deepStrictEqual(calls, [
    {
      sql: 'SELECT 1 FROM pg_database WHERE datname = $1',
      values: ['ai_note_keeper'],
    },
    {
      sql: 'CREATE DATABASE "ai_note_keeper"',
      values: undefined,
    },
  ]);
  assert.equal(released, true);
  assert.equal(ended, true);
});

test('ensureDatabaseExists skips create when the target database already exists', async () => {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  let released = false;
  let ended = false;

  const client = {
    query: async (sql: string, values?: readonly unknown[]) => {
      calls.push({ sql, values });

      return { rows: [{ version: 'exists' }] };
    },
    release: () => {
      released = true;
    },
  };

  await ensureDatabaseExists('postgresql://postgres:postgres@localhost:5432/ai_note_keeper', {
    createPool: () => ({
      connect: async () => client,
      end: async () => {
        ended = true;
      },
    }),
  });

  assert.deepStrictEqual(calls, [
    {
      sql: 'SELECT 1 FROM pg_database WHERE datname = $1',
      values: ['ai_note_keeper'],
    },
  ]);
  assert.equal(released, true);
  assert.equal(ended, true);
});
