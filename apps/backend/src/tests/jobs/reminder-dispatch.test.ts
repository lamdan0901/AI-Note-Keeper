import assert from 'node:assert/strict';
import test from 'node:test';

import type { DbQueryClient } from '../../auth/contracts.js';
import { MAX_LOOKBACK_MS } from '../../jobs/reminders/contracts.js';
import { createCronStateRepository } from '../../jobs/reminders/cron-state-repository.js';
import { createDueReminderScanner } from '../../jobs/reminders/due-reminder-scanner.js';

type QueryCall = Readonly<{
  text: string;
  values: ReadonlyArray<unknown> | undefined;
}>;

const createDbQueryClient = <Row extends Record<string, unknown>>(
  handler: (
    text: string,
    values: ReadonlyArray<unknown> | undefined,
  ) => Promise<ReadonlyArray<Row>>,
): DbQueryClient => {
  return {
    query: async <T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: ReadonlyArray<unknown>,
    ) => {
      const rows = (await handler(text, values)) as unknown as ReadonlyArray<T>;
      return { rows };
    },
  };
};

test('scanner computes since from watermark or bounded lookback when watermark is absent', async () => {
  const calls: QueryCall[] = [];
  const fixedNow = new Date('2026-04-19T10:00:00.000Z');
  const db = createDbQueryClient(async (text, values) => {
    calls.push({ text, values });
    return [];
  });

  const scanner = createDueReminderScanner({
    db,
  });

  const firstRun = await scanner.scanDueReminders({
    now: fixedNow,
    lastCheckedAt: null,
  });

  assert.equal(firstRun.since.getTime(), fixedNow.getTime() - MAX_LOOKBACK_MS);
  assert.equal(firstRun.now.getTime(), fixedNow.getTime());

  const secondRunWatermark = new Date('2026-04-19T09:59:00.000Z');
  const secondRun = await scanner.scanDueReminders({
    now: fixedNow,
    lastCheckedAt: secondRunWatermark,
  });

  assert.equal(secondRun.since.getTime(), secondRunWatermark.getTime());
  assert.equal(secondRun.now.getTime(), fixedNow.getTime());

  assert.equal(calls.length, 2);
  const firstValues = calls[0].values ?? [];
  const secondValues = calls[1].values ?? [];
  assert.equal((firstValues[0] as Date).getTime(), fixedNow.getTime() - MAX_LOOKBACK_MS);
  assert.equal((firstValues[1] as Date).getTime(), fixedNow.getTime());
  assert.equal((secondValues[0] as Date).getTime(), secondRunWatermark.getTime());
  assert.equal((secondValues[1] as Date).getTime(), fixedNow.getTime());
});

test('scanner returns reminders due in [since, now] while honoring snoozedUntil > nextTriggerAt > triggerAt precedence', async () => {
  const fixedNow = new Date('2026-04-19T10:00:00.000Z');
  const since = new Date('2026-04-19T09:55:00.000Z');
  type DueRow = Readonly<{
    note_id: string;
    user_id: string;
    trigger_at: Date | null;
    next_trigger_at: Date | null;
    snoozed_until: Date | null;
  }>;

  const db = createDbQueryClient<DueRow>(async () => {
    return [
      {
        note_id: 'note-a',
        user_id: 'user-1',
        trigger_at: new Date('2026-04-19T09:58:00.000Z'),
        next_trigger_at: new Date('2026-04-19T09:59:00.000Z'),
        snoozed_until: new Date('2026-04-19T09:56:00.000Z'),
      },
      {
        note_id: 'note-b',
        user_id: 'user-1',
        trigger_at: new Date('2026-04-19T09:58:00.000Z'),
        next_trigger_at: new Date('2026-04-19T09:57:00.000Z'),
        snoozed_until: new Date('2026-04-19T10:05:00.000Z'),
      },
      {
        note_id: 'note-c',
        user_id: 'user-1',
        trigger_at: new Date('2026-04-19T09:56:30.000Z'),
        next_trigger_at: new Date('2026-04-19T09:57:00.000Z'),
        snoozed_until: null,
      },
      {
        note_id: 'note-d',
        user_id: 'user-1',
        trigger_at: new Date('2026-04-19T09:57:30.000Z'),
        next_trigger_at: null,
        snoozed_until: null,
      },
      {
        note_id: 'note-e',
        user_id: 'user-1',
        trigger_at: new Date('2026-04-19T09:50:00.000Z'),
        next_trigger_at: null,
        snoozed_until: null,
      },
    ];
  });

  const scanner = createDueReminderScanner({
    db,
  });

  const result = await scanner.scanDueReminders({ now: fixedNow, lastCheckedAt: since });

  assert.deepEqual(
    result.reminders.map((item) => item.noteId),
    ['note-a', 'note-c', 'note-d'],
  );
  assert.equal(result.reminders[0].triggerTime.getTime(), Date.parse('2026-04-19T09:56:00.000Z'));
  assert.equal(result.reminders[1].triggerTime.getTime(), Date.parse('2026-04-19T09:57:00.000Z'));
  assert.equal(result.reminders[2].triggerTime.getTime(), Date.parse('2026-04-19T09:57:30.000Z'));
});

test('cron state repository upserts and persists durable watermark by key', async () => {
  const state = new Map<string, Date>();
  const db = createDbQueryClient<Record<string, unknown>>(async (text, values) => {
      const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();

      if (normalized.includes('select last_checked_at from cron_state')) {
        const key = values?.[0] as string;
        const found = state.get(key);
        return found
          ? [
              {
                last_checked_at: found,
              },
            ]
          : [];
      }

      if (normalized.includes('insert into cron_state')) {
        const key = values?.[0] as string;
        const lastCheckedAt = values?.[1] as Date;
        state.set(key, lastCheckedAt);
        return [];
      }

      throw new Error(`Unexpected query: ${text}`);
  });

  const repository = createCronStateRepository({ db });
  const key = 'check-reminders';

  const before = await repository.getLastCheckedAt(key);
  assert.equal(before, null);

  const first = new Date('2026-04-19T09:58:00.000Z');
  await repository.upsertLastCheckedAt({ key, lastCheckedAt: first });
  const afterFirst = await repository.getLastCheckedAt(key);
  assert.equal(afterFirst?.getTime(), first.getTime());

  const second = new Date('2026-04-19T09:59:30.000Z');
  await repository.upsertLastCheckedAt({ key, lastCheckedAt: second });
  const afterSecond = await repository.getLastCheckedAt(key);

  assert.equal(afterSecond?.getTime(), second.getTime());
  assert.equal(state.size, 1);
});
