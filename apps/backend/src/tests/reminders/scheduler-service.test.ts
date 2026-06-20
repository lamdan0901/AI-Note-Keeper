import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReminderPatchInput, ReminderRecord } from '../../reminders/contracts.js';
import type { RemindersRepository } from '../../reminders/repositories/reminders-repository.js';
import { createReminderSchedulerService } from '../../reminders/scheduler-service.js';
import type { SchedulerProvider } from '../../reminders/scheduler-provider.js';

const createRecord = (input: Partial<ReminderRecord> = {}): ReminderRecord => ({
  id: 'reminder-1',
  userId: 'user-1',
  title: 'Reminder',
  triggerAt: new Date('2026-06-13T10:00:00.000Z'),
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
  nextTriggerAt: new Date('2026-06-13T10:05:00.000Z'),
  lastFiredAt: null,
  lastAcknowledgedAt: null,
  scheduleProvider: null,
  scheduleTargetId: null,
  scheduleTargetVersion: null,
  scheduleTargetFireAt: null,
  version: 3,
  createdAt: new Date('2026-06-13T09:00:00.000Z'),
  updatedAt: new Date('2026-06-13T09:00:00.000Z'),
  ...input,
});

test('scheduler service persists metadata only after provider schedule succeeds', async () => {
  const patches: ReminderPatchInput[] = [];
  const provider: SchedulerProvider = {
    name: 'fake',
    scheduleOnce: async (input) => ({
      provider: 'fake',
      scheduleId: `schedule-${input.deliveryKey}`,
      fireAt: input.occurrenceAt,
    }),
    cancel: async () => undefined,
  };
  const repository: Pick<RemindersRepository, 'patch'> = {
    patch: async ({ patch }) => {
      patches.push(patch);
      return createRecord({
        scheduleProvider: patch.scheduleProvider ?? null,
        scheduleTargetId: patch.scheduleTargetId ?? null,
        scheduleTargetVersion: patch.scheduleTargetVersion ?? null,
        scheduleTargetFireAt: patch.scheduleTargetFireAt ?? null,
      });
    },
  };

  const service = createReminderSchedulerService({ provider, remindersRepository: repository });
  await service.scheduleNextOccurrence(createRecord());

  assert.equal(patches.length, 1);
  assert.equal(patches[0].scheduleProvider, 'fake');
  assert.equal(patches[0].scheduleTargetId, 'schedule-reminder-1:1781345100000:v3');
  assert.equal(patches[0].scheduleTargetVersion, 3);
  assert.equal(
    patches[0].scheduleTargetFireAt?.toISOString(),
    '2026-06-13T10:05:00.000Z',
  );
});

test('scheduler service leaves metadata empty when provider schedule fails', async () => {
  const patches: ReminderPatchInput[] = [];
  const provider: SchedulerProvider = {
    name: 'fake',
    scheduleOnce: async () => {
      throw new Error('provider down');
    },
    cancel: async () => undefined,
  };
  const repository: Pick<RemindersRepository, 'patch'> = {
    patch: async ({ patch }) => {
      patches.push(patch);
      return null;
    },
  };

  const service = createReminderSchedulerService({ provider, remindersRepository: repository });
  const result = await service.scheduleNextOccurrence(createRecord());

  assert.equal(result.scheduled, false);
  assert.equal(result.reason, 'provider_failed');
  assert.equal(patches.length, 0);
});

test('scheduler service cancels old target best effort and clears metadata', async () => {
  const canceled: string[] = [];
  const patches: ReminderPatchInput[] = [];
  const provider: SchedulerProvider = {
    name: 'fake',
    scheduleOnce: async () => {
      throw new Error('not used');
    },
    cancel: async ({ scheduleId }) => {
      canceled.push(scheduleId);
    },
  };
  const repository: Pick<RemindersRepository, 'patch'> = {
    patch: async ({ patch }) => {
      patches.push(patch);
      return null;
    },
  };

  const service = createReminderSchedulerService({ provider, remindersRepository: repository });
  await service.cancelCurrentSchedule(createRecord({ scheduleTargetId: 'schedule-old' }));

  assert.deepEqual(canceled, ['schedule-old']);
  assert.equal(patches[0].scheduleProvider, null);
  assert.equal(patches[0].scheduleTargetId, null);
  assert.equal(patches[0].scheduleTargetVersion, null);
  assert.equal(patches[0].scheduleTargetFireAt, null);
});
