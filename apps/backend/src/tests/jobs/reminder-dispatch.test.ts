import assert from 'node:assert/strict';
import test from 'node:test';

import type { DbQueryClient } from '../../auth/contracts.js';
import {
  MAX_LOOKBACK_MS,
  createReminderEventId,
  type CronStateRepository,
  type DueReminderScanner,
  type ReminderDispatchQueue,
} from '../../jobs/reminders/contracts.js';
import { createCronStateRepository } from '../../jobs/reminders/cron-state-repository.js';
import { createReminderDispatchJob } from '../../jobs/reminders/dispatch-due-reminders.js';
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

const createDispatchHarness = (
  input: Readonly<{
    reminders: ReadonlyArray<Readonly<{ noteId: string; userId: string; triggerTime: Date }>>;
    initialWatermark?: Date | null;
    now: Date;
    enqueueImpl?: ReminderDispatchQueue['enqueue'];
  }>,
): Readonly<{
  scanner: DueReminderScanner;
  cronStateRepository: CronStateRepository;
  queue: ReminderDispatchQueue;
  events: string[];
  upsertCalls: Date[];
}> => {
  const events: string[] = [];
  const upsertCalls: Date[] = [];
  let watermark = input.initialWatermark ?? null;

  const scanner: DueReminderScanner = {
    scanDueReminders: async ({ lastCheckedAt }) => {
      events.push(`scan:${lastCheckedAt?.toISOString() ?? 'null'}`);
      return {
        since: lastCheckedAt ?? new Date(input.now.getTime() - MAX_LOOKBACK_MS),
        now: input.now,
        reminders: input.reminders,
      };
    },
  };

  const cronStateRepository: CronStateRepository = {
    getLastCheckedAt: async () => {
      events.push('get-watermark');
      return watermark;
    },
    upsertLastCheckedAt: async ({ lastCheckedAt }) => {
      events.push('set-watermark');
      upsertCalls.push(lastCheckedAt);
      watermark = lastCheckedAt;
    },
  };

  const queue: ReminderDispatchQueue = {
    enqueue: async (job) => {
      events.push(`enqueue:${job.jobKey}`);
      if (input.enqueueImpl) {
        return input.enqueueImpl(job);
      }

      return {
        status: 'enqueued',
      };
    },
  };

  return {
    scanner,
    cronStateRepository,
    queue,
    events,
    upsertCalls,
  };
};

test('dispatcher enqueues one job per occurrence with stable event identity and commit-ordered watermark', async () => {
  const now = new Date('2026-04-19T10:00:00.000Z');
  const reminders = [
    {
      noteId: 'note-1',
      userId: 'user-1',
      triggerTime: new Date('2026-04-19T09:59:00.000Z'),
    },
    {
      noteId: 'note-2',
      userId: 'user-1',
      triggerTime: new Date('2026-04-19T09:59:30.000Z'),
    },
  ] as const;

  const queuedJobKeys: string[] = [];
  const harness = createDispatchHarness({
    now,
    reminders,
    enqueueImpl: async (job) => {
      queuedJobKeys.push(job.jobKey);
      return { status: 'enqueued' };
    },
  });

  const dispatchJob = createReminderDispatchJob({
    scanner: harness.scanner,
    cronStateRepository: harness.cronStateRepository,
    queue: harness.queue,
    now: () => now,
  });

  const result = await dispatchJob.run();

  assert.equal(result.scanned, 2);
  assert.equal(result.enqueued, 2);
  assert.equal(result.duplicates, 0);
  assert.deepEqual(queuedJobKeys, [
    createReminderEventId('note-1', reminders[0].triggerTime),
    createReminderEventId('note-2', reminders[1].triggerTime),
  ]);
  assert.deepEqual(harness.events, [
    'get-watermark',
    'scan:null',
    `enqueue:${createReminderEventId('note-1', reminders[0].triggerTime)}`,
    `enqueue:${createReminderEventId('note-2', reminders[1].triggerTime)}`,
    'set-watermark',
  ]);
  assert.equal(harness.upsertCalls.length, 1);
  assert.equal(harness.upsertCalls[0].getTime(), now.getTime());
});

test('first dispatch run without persisted watermark is bounded by MAX_LOOKBACK_MS', async () => {
  const now = new Date('2026-04-19T10:00:00.000Z');
  let observedLastCheckedAt: Date | null = new Date('2020-01-01T00:00:00.000Z');

  const scanner: DueReminderScanner = {
    scanDueReminders: async ({ lastCheckedAt, now: scanNow }) => {
      observedLastCheckedAt = lastCheckedAt;
      return {
        since: new Date(scanNow.getTime() - MAX_LOOKBACK_MS),
        now: scanNow,
        reminders: [],
      };
    },
  };

  const cronStateRepository: CronStateRepository = {
    getLastCheckedAt: async () => null,
    upsertLastCheckedAt: async () => undefined,
  };

  const queue: ReminderDispatchQueue = {
    enqueue: async () => ({ status: 'enqueued' }),
  };

  const dispatchJob = createReminderDispatchJob({
    scanner,
    cronStateRepository,
    queue,
    now: () => now,
  });

  const result = await dispatchJob.run();

  assert.equal(observedLastCheckedAt, null);
  assert.equal(result.since.getTime(), now.getTime() - MAX_LOOKBACK_MS);
});

test('enqueue failure keeps watermark unchanged for retry-safe at-least-once delivery', async () => {
  const now = new Date('2026-04-19T10:00:00.000Z');
  const initialWatermark = new Date('2026-04-19T09:58:00.000Z');
  const reminders = [
    {
      noteId: 'note-1',
      userId: 'user-1',
      triggerTime: new Date('2026-04-19T09:59:00.000Z'),
    },
    {
      noteId: 'note-2',
      userId: 'user-1',
      triggerTime: new Date('2026-04-19T09:59:30.000Z'),
    },
  ] as const;

  let enqueueCount = 0;
  const harness = createDispatchHarness({
    now,
    reminders,
    initialWatermark,
    enqueueImpl: async (job) => {
      enqueueCount += 1;
      if (enqueueCount === 2) {
        throw new Error(`queue failed for ${job.noteId}`);
      }

      return { status: 'enqueued' };
    },
  });

  const dispatchJob = createReminderDispatchJob({
    scanner: harness.scanner,
    cronStateRepository: harness.cronStateRepository,
    queue: harness.queue,
    now: () => now,
  });

  await assert.rejects(
    async () => {
      await dispatchJob.run();
    },
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /queue failed for note-2/);
      return true;
    },
  );

  assert.equal(harness.upsertCalls.length, 0);
  assert.deepEqual(harness.events, [
    'get-watermark',
    `scan:${initialWatermark.toISOString()}`,
    `enqueue:${createReminderEventId('note-1', reminders[0].triggerTime)}`,
    `enqueue:${createReminderEventId('note-2', reminders[1].triggerTime)}`,
  ]);
});

test('restart simulation reuses event identities and dedupes duplicate occurrence keys', async () => {
  const now = new Date('2026-04-19T10:00:00.000Z');
  const reminders = [
    {
      noteId: 'note-1',
      userId: 'user-1',
      triggerTime: new Date('2026-04-19T09:59:00.000Z'),
    },
    {
      noteId: 'note-1',
      userId: 'user-1',
      triggerTime: new Date('2026-04-19T09:59:00.000Z'),
    },
  ] as const;

  const uniqueKeys = new Set<string>();
  const harness = createDispatchHarness({
    now,
    reminders,
    enqueueImpl: async (job) => {
      if (uniqueKeys.has(job.jobKey)) {
        return { status: 'duplicate' };
      }

      uniqueKeys.add(job.jobKey);
      return { status: 'enqueued' };
    },
  });

  const dispatchJob = createReminderDispatchJob({
    scanner: harness.scanner,
    cronStateRepository: harness.cronStateRepository,
    queue: harness.queue,
    now: () => now,
  });

  const first = await dispatchJob.run();
  const second = await dispatchJob.run();

  assert.equal(first.enqueued, 1);
  assert.equal(first.duplicates, 1);
  assert.equal(second.enqueued, 0);
  assert.equal(second.duplicates, 2);
  assert.equal(uniqueKeys.size, 1);
  assert.equal(uniqueKeys.has(createReminderEventId('note-1', reminders[0].triggerTime)), true);
});
