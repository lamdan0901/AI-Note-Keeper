import assert from 'node:assert/strict';
import test from 'node:test';

import { createPostgresImportTarget } from '../migration-tools/targets/postgres-import-target.js';

test('note import preserves full note fields for postgres upsert', async () => {
  const captured: Array<Readonly<{ sql: string; params: ReadonlyArray<unknown> }>> = [];

  const db = {
    query: async (sql: string, params: ReadonlyArray<unknown> = []): Promise<unknown> => {
      captured.push({ sql, params });
      return {};
    },
  };

  const adapter = createPostgresImportTarget(db);

  await adapter.applyBatch({
    entity: 'notes',
    dryRun: false,
    records: [
      {
        id: 'f8442c74-58ce-435b-af90-18f980a7c9b8',
        userId: 'k575s4th55ddf135kvzy4bnaj983qqje',
        title: 'Eat what',
        content:
          '[{"id":"ad1a1742-1e89-43ed-8dd4-f5ccd504b051","text":"Tam thất mật ong","checked":false}]',
        contentType: 'checklist',
        color: 'red',
        active: true,
        done: false,
        isPinned: true,
        triggerAt: 1776382200000,
        repeatRule: 'daily',
        repeatConfig: { interval: 1 },
        repeat: { kind: 'daily', interval: 1 },
        snoozedUntil: null,
        scheduleStatus: 'scheduled',
        timezone: 'Asia/Ho_Chi_Minh',
        baseAtLocal: '2026-04-16T06:30:00',
        startAt: 1776295800000,
        nextTriggerAt: 1776727800000,
        lastFiredAt: 1776641402553,
        lastAcknowledgedAt: null,
        version: 35,
        deletedAt: null,
        createdAt: 1770464389565,
        updatedAt: 1776641402553,
      },
    ],
  });

  assert.equal(captured.length, 1);

  const [query] = captured;
  assert.match(query.sql, /content_type/);
  assert.match(query.sql, /is_pinned/);
  assert.match(query.sql, /repeat_config/);
  assert.match(query.sql, /schedule_status/);
  assert.match(query.sql, /base_at_local/);
  assert.match(query.sql, /last_fired_at/);

  assert.equal(query.params[0], 'f8442c74-58ce-435b-af90-18f980a7c9b8');
  assert.equal(query.params[1], 'k575s4th55ddf135kvzy4bnaj983qqje');
  assert.equal(query.params[4], 'checklist');
  assert.equal(query.params[5], 'red');
  assert.equal(query.params[7], false);
  assert.equal(query.params[8], true);
  assert.deepEqual(query.params[11], { interval: 1 });
  assert.deepEqual(query.params[12], { kind: 'daily', interval: 1 });
  assert.equal(query.params[14], 'scheduled');
  assert.equal(query.params[15], 'Asia/Ho_Chi_Minh');
  assert.equal(query.params[16], '2026-04-16T06:30:00');
  assert.equal(query.params[21], 35);
  assert.ok(query.params[23] instanceof Date);
  assert.ok(query.params[24] instanceof Date);
});

test('note import preserves isPinned=false from camelCase input', async () => {
  const captured: Array<Readonly<{ sql: string; params: ReadonlyArray<unknown> }>> = [];

  const db = {
    query: async (sql: string, params: ReadonlyArray<unknown> = []): Promise<unknown> => {
      captured.push({ sql, params });
      return {};
    },
  };

  const adapter = createPostgresImportTarget(db);

  await adapter.applyBatch({
    entity: 'notes',
    dryRun: false,
    records: [
      {
        id: 'note-false-pin',
        userId: 'user-1',
        active: true,
        isPinned: false,
      },
    ],
  });

  assert.equal(captured.length, 1);
  const [query] = captured;
  assert.equal(query.params[8], false);
});

test('note import upsert updates user_id on conflict', async () => {
  const captured: Array<Readonly<{ sql: string; params: ReadonlyArray<unknown> }>> = [];

  const db = {
    query: async (sql: string, params: ReadonlyArray<unknown> = []): Promise<unknown> => {
      captured.push({ sql, params });
      return {};
    },
  };

  const adapter = createPostgresImportTarget(db);

  await adapter.applyBatch({
    entity: 'notes',
    dryRun: false,
    records: [
      {
        id: 'note-owner-switch',
        userId: 'user-new-owner',
        active: true,
      },
    ],
  });

  assert.equal(captured.length, 1);
  const [query] = captured;
  assert.match(query.sql, /SET user_id = EXCLUDED\.user_id/);
  assert.equal(query.params[1], 'user-new-owner');
});
