import assert from 'node:assert/strict';
import test from 'node:test';

import type { DbQueryClient } from '../../auth/contracts.js';
import type { ReminderRecord } from '../../reminders/contracts.js';
import type { RemindersRepository } from '../../reminders/repositories/reminders-repository.js';
import type { ReminderSchedulerService } from '../../reminders/scheduler-service.js';
import { runReminderScheduleBackfillCommand } from '../../reminders/backfill-schedules.js';

const createReminder = (input: Partial<ReminderRecord> = {}): ReminderRecord => ({
  id: 'reminder-1',
  userId: 'user-1',
  title: 'Reminder',
  triggerAt: new Date('2026-06-20T10:00:00.000Z'),
  done: null,
  repeatRule: 'none',
  repeatConfig: null,
  repeat: null,
  snoozedUntil: null,
  active: true,
  scheduleStatus: 'scheduled',
  timezone: 'UTC',
  baseAtLocal: null,
  startAt: null,
  nextTriggerAt: new Date('2026-06-20T10:05:00.000Z'),
  lastFiredAt: null,
  lastAcknowledgedAt: null,
  scheduleProvider: null,
  scheduleTargetId: null,
  scheduleTargetVersion: null,
  scheduleTargetFireAt: null,
  version: 1,
  createdAt: new Date('2026-06-20T09:00:00.000Z'),
  updatedAt: new Date('2026-06-20T09:00:00.000Z'),
  ...input,
});

test('backfill command dry-run reports future reminders without scheduling them', async () => {
  const queriedSql: string[] = [];
  const db: DbQueryClient = {
    query: async <Row extends Record<string, unknown> = Record<string, unknown>>(text: string) => {
      queriedSql.push(text);
      return {
        rows: [{ id: 'reminder-1' }, { id: 'reminder-2' }] as unknown as ReadonlyArray<Row>,
      };
    },
  };
  const remindersRepository: Pick<RemindersRepository, 'findById'> = {
    findById: async ({ reminderId }) => createReminder({ id: reminderId }),
  };
  let scheduledCalls = 0;
  const schedulerService: Pick<ReminderSchedulerService, 'scheduleNextOccurrence'> = {
    scheduleNextOccurrence: async () => {
      scheduledCalls += 1;
      return { scheduled: true, deliveryKey: 'unused' };
    },
  };

  const result = await runReminderScheduleBackfillCommand(
    ['node', 'backfill-reminder-schedules', '--dry-run'],
    {
      db,
      remindersRepository,
      schedulerService,
      now: () => new Date('2026-06-20T09:30:00.000Z'),
    },
  );

  assert.equal(queriedSql.length, 1);
  assert.match(queriedSql[0], /schedule_target_id is null/i);
  assert.equal(result.dryRun, true);
  assert.equal(result.candidateCount, 2);
  assert.deepEqual(result.results, [
    { reminderId: 'reminder-1', status: 'skipped', reason: 'dry_run' },
    { reminderId: 'reminder-2', status: 'skipped', reason: 'dry_run' },
  ]);
  assert.equal(scheduledCalls, 0);
});

test('backfill command schedules each candidate and reports failures or missing rows', async () => {
  const db: DbQueryClient = {
    query: async <Row extends Record<string, unknown> = Record<string, unknown>>() => {
      return {
        rows: [
          { id: 'reminder-1' },
          { id: 'reminder-2' },
          { id: 'missing-reminder' },
        ] as unknown as ReadonlyArray<Row>,
      };
    },
  };
  const remindersRepository: Pick<RemindersRepository, 'findById'> = {
    findById: async ({ reminderId }) => {
      if (reminderId === 'missing-reminder') {
        return null;
      }

      return createReminder({ id: reminderId });
    },
  };
  const scheduledReminderIds: string[] = [];
  const schedulerService: Pick<ReminderSchedulerService, 'scheduleNextOccurrence'> = {
    scheduleNextOccurrence: async (reminder) => {
      scheduledReminderIds.push(reminder.id);
      if (reminder.id === 'reminder-2') {
        return { scheduled: false, deliveryKey: 'key-2', reason: 'provider_failed' };
      }

      return { scheduled: true, deliveryKey: 'key-1' };
    },
  };

  const result = await runReminderScheduleBackfillCommand(
    ['node', 'backfill-reminder-schedules'],
    {
      db,
      remindersRepository,
      schedulerService,
      now: () => new Date('2026-06-20T09:30:00.000Z'),
    },
  );

  assert.deepEqual(scheduledReminderIds, ['reminder-1', 'reminder-2']);
  assert.equal(result.dryRun, false);
  assert.equal(result.candidateCount, 3);
  assert.deepEqual(result.results, [
    { reminderId: 'reminder-1', status: 'scheduled' },
    { reminderId: 'reminder-2', status: 'failed', reason: 'provider_failed' },
    { reminderId: 'missing-reminder', status: 'skipped', reason: 'not_found' },
  ]);
});
