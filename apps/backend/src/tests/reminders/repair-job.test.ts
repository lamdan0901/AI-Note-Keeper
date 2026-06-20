import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReminderSchedulerPayload } from '../../reminders/contracts.js';
import { createReminderRepairJob } from '../../reminders/repair-job.js';

test('repair job executes overdue candidates through scheduled task executor', async () => {
  const executed: string[] = [];
  const now = new Date('2026-06-13T10:10:00.000Z');
  const job = createReminderRepairJob({
    remindersRepository: {
      listRepairCandidates: async () => [
        {
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
          version: 2,
          scheduleProvider: null,
          scheduleTargetId: null,
          scheduleTargetVersion: null,
          scheduleTargetFireAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      findById: async () => ({
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
        scheduleStatus: 'unscheduled',
        timezone: 'UTC',
        baseAtLocal: null,
        startAt: null,
        nextTriggerAt: null,
        lastFiredAt: new Date('2026-06-13T10:05:00.000Z'),
        lastAcknowledgedAt: null,
        version: 2,
        scheduleProvider: null,
        scheduleTargetId: null,
        scheduleTargetVersion: null,
        scheduleTargetFireAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    },
    executor: {
      execute: async (payload: ReminderSchedulerPayload) => {
        executed.push(`${payload.reminderId}:${payload.version}:${payload.deliveryKey}`);
        return { status: 'sent' };
      },
    },
    schedulerService: {
      scheduleNextOccurrence: async () => ({ scheduled: true }),
      cancelCurrentSchedule: async () => undefined,
      clearScheduleMetadata: async () => undefined,
    },
    now: () => now,
  });

  const result = await job.run();

  assert.equal(result.candidates, 1);
  assert.equal(result.executed, 1);
  assert.deepEqual(executed, ['reminder-1:2:reminder-1:1781345100000:v2']);
});
