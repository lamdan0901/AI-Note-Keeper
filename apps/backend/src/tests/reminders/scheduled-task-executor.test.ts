import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReminderRecord, ReminderSchedulerPayload } from '../../reminders/contracts.js';
import { createScheduledTaskExecutor } from '../../reminders/scheduled-task-executor.js';
import { createReminderDeliveryKey } from '../../reminders/scheduler-service.js';

const createReminder = (
  input: Readonly<{
    id?: string;
    userId?: string;
    triggerAt?: Date;
    nextTriggerAt?: Date | null;
    snoozedUntil?: Date | null;
    repeat?: ReminderRecord['repeat'];
    startAt?: Date | null;
    baseAtLocal?: string | null;
    version?: number;
    active?: boolean;
    done?: boolean | null;
  }> = {},
): ReminderRecord => {
  const triggerAt = input.triggerAt ?? new Date('2026-06-13T10:05:00.000Z');
  return {
    id: input.id ?? 'reminder-1',
    userId: input.userId ?? 'user-1',
    title: 'Reminder',
    triggerAt,
    done: input.done ?? null,
    repeatRule: input.repeat?.kind ?? 'none',
    repeatConfig: null,
    repeat: input.repeat ?? null,
    snoozedUntil: input.snoozedUntil ?? null,
    active: input.active ?? true,
    scheduleStatus: 'scheduled',
    timezone: 'UTC',
    baseAtLocal: input.baseAtLocal ?? '2026-06-13T10:05:00',
    startAt: input.startAt ?? triggerAt,
    nextTriggerAt: input.nextTriggerAt ?? triggerAt,
    lastFiredAt: null,
    lastAcknowledgedAt: null,
    scheduleProvider: 'fake',
    scheduleTargetId: 'schedule-1',
    scheduleTargetVersion: input.version ?? 1,
    scheduleTargetFireAt: input.nextTriggerAt ?? triggerAt,
    version: input.version ?? 1,
    createdAt: new Date('2026-06-13T10:00:00.000Z'),
    updatedAt: new Date('2026-06-13T10:00:00.000Z'),
  };
};

const createPayload = (
  reminder: ReminderRecord,
  override: Partial<ReminderSchedulerPayload> = {},
): ReminderSchedulerPayload => {
  const occurrenceAt = override.occurrenceAt ?? reminder.nextTriggerAt?.toISOString();
  if (!occurrenceAt) {
    throw new Error('occurrenceAt is required for scheduled task payload');
  }

  return {
    reminderId: override.reminderId ?? reminder.id,
    occurrenceAt,
    version: override.version ?? reminder.version,
    deliveryKey:
      override.deliveryKey ??
      createReminderDeliveryKey({
        reminderId: override.reminderId ?? reminder.id,
        occurrenceAt: new Date(occurrenceAt),
        version: override.version ?? reminder.version,
      }),
  };
};

test('executor rejects version mismatch as stale and sends no push', async () => {
  const reminder = createReminder({ version: 4 });
  const payload = createPayload(reminder, { version: 3 });
  const staleReasons: string[] = [];
  let sendCalls = 0;

  const executor = createScheduledTaskExecutor({
    remindersRepository: {
      findById: async () => reminder,
      advanceAfterDelivery: async () => {
        throw new Error('advanceAfterDelivery should not run for stale tasks');
      },
    },
    deliveriesRepository: {
      insertPending: async () => {
        throw new Error('insertPending should not run for stale tasks');
      },
      markSent: async () => undefined,
      markFailed: async () => undefined,
      markCanceled: async () => undefined,
      markStale: async (input: Readonly<{ reason: string }>) => {
        staleReasons.push(input.reason);
      },
    },
    notificationSender: {
      sendReminderNotification: async () => {
        sendCalls += 1;
        return { status: 'sent', delivered: 1, failed: 0, providerMessageId: 'push-1' };
      },
    },
    schedulerService: {
      scheduleNextOccurrence: async () => ({ scheduled: false }),
      cancelCurrentSchedule: async () => undefined,
      clearScheduleMetadata: async () => undefined,
    },
  });

  const result = await executor.execute(payload);

  assert.equal(result.status, 'stale');
  assert.deepEqual(staleReasons, ['version_mismatch']);
  assert.equal(sendCalls, 0);
});

test('executor inserts one delivery row and treats duplicate occurrence as no-op', async () => {
  const reminder = createReminder();
  const payload = createPayload(reminder);
  const events: string[] = [];

  const executor = createScheduledTaskExecutor({
    remindersRepository: {
      findById: async () => reminder,
      advanceAfterDelivery: async () => {
        events.push('advance');
        return reminder;
      },
    },
    deliveriesRepository: {
      insertPending: async () => {
        events.push('insert');
        return {
          inserted: false,
          delivery: {
            id: 'delivery-1',
            reminderId: reminder.id,
            userId: reminder.userId,
            occurrenceAt: reminder.nextTriggerAt ?? reminder.triggerAt,
            reminderVersion: reminder.version,
            deliveryKey: payload.deliveryKey,
            status: 'pending',
            providerMessageId: null,
            attemptCount: 0,
            createdAt: new Date('2026-06-13T10:05:00.000Z'),
            sentAt: null,
            failureReason: null,
          },
        };
      },
      markSent: async () => {
        events.push('mark-sent');
      },
      markFailed: async () => {
        events.push('mark-failed');
      },
      markCanceled: async () => {
        events.push('mark-canceled');
      },
      markStale: async () => {
        events.push('mark-stale');
      },
    },
    notificationSender: {
      sendReminderNotification: async () => {
        events.push('send');
        return { status: 'sent', delivered: 1, failed: 0, providerMessageId: 'push-1' };
      },
    },
    schedulerService: {
      scheduleNextOccurrence: async () => {
        events.push('schedule-next');
        return { scheduled: true, deliveryKey: 'next-key' };
      },
      cancelCurrentSchedule: async () => undefined,
      clearScheduleMetadata: async () => {
        events.push('clear');
      },
    },
  });

  const result = await executor.execute(payload);

  assert.equal(result.status, 'duplicate');
  assert.deepEqual(events, ['insert']);
});

test('executor sends push, marks sent, advances recurrence, and schedules successor', async () => {
  const reminder = createReminder({
    repeat: { kind: 'daily', interval: 1 },
    startAt: new Date('2026-06-12T10:05:00.000Z'),
    nextTriggerAt: new Date('2026-06-13T10:05:00.000Z'),
    version: 2,
  });
  const payload = createPayload(reminder);
  const events: string[] = [];
  const successorAt = new Date('2026-06-14T10:05:00.000Z');
  const advancedReminder: ReminderRecord = {
    ...reminder,
    nextTriggerAt: successorAt,
    lastFiredAt: new Date('2026-06-13T10:05:30.000Z'),
    updatedAt: new Date('2026-06-13T10:05:30.000Z'),
  };

  const executor = createScheduledTaskExecutor({
    remindersRepository: {
      findById: async () => reminder,
      advanceAfterDelivery: async (input) => {
        events.push('advance');
        assert.equal(input.expectedVersion, 2);
        assert.equal(input.occurrenceAt.getTime(), Date.parse('2026-06-13T10:05:00.000Z'));
        assert.equal(input.nextTriggerAt?.getTime(), successorAt.getTime());
        assert.equal(input.scheduleStatus, 'scheduled');
        return advancedReminder;
      },
    },
    deliveriesRepository: {
      insertPending: async () => {
        events.push('insert');
        return {
          inserted: true,
          delivery: {
            id: 'delivery-1',
            reminderId: reminder.id,
            userId: reminder.userId,
            occurrenceAt: reminder.nextTriggerAt ?? reminder.triggerAt,
            reminderVersion: reminder.version,
            deliveryKey: payload.deliveryKey,
            status: 'pending',
            providerMessageId: null,
            attemptCount: 0,
            createdAt: new Date('2026-06-13T10:05:00.000Z'),
            sentAt: null,
            failureReason: null,
          },
        };
      },
      markSent: async () => {
        events.push('mark-sent');
      },
      markFailed: async () => {
        events.push('mark-failed');
      },
      markCanceled: async () => {
        events.push('mark-canceled');
      },
      markStale: async () => {
        events.push('mark-stale');
      },
    },
    notificationSender: {
      sendReminderNotification: async (input: Readonly<{ deliveryKey: string }>) => {
        events.push('send');
        assert.equal(input.deliveryKey, payload.deliveryKey);
        return { status: 'sent', delivered: 1, failed: 0, providerMessageId: 'push-1' };
      },
    },
    schedulerService: {
      scheduleNextOccurrence: async (nextReminder: ReminderRecord) => {
        events.push('schedule-next');
        assert.equal(nextReminder.nextTriggerAt?.getTime(), successorAt.getTime());
        return { scheduled: true, deliveryKey: 'next-key' };
      },
      cancelCurrentSchedule: async () => undefined,
      clearScheduleMetadata: async () => {
        events.push('clear');
      },
    },
    computeNext: () => successorAt.getTime(),
    now: () => new Date('2026-06-13T10:05:30.000Z'),
  });

  const result = await executor.execute(payload);

  assert.equal(result.status, 'sent');
  assert.deepEqual(events, ['insert', 'send', 'mark-sent', 'advance', 'schedule-next']);
});

test('executor advances delayed recurring execution from the fired occurrence and leaves overdue successor unscheduled', async () => {
  const reminder = createReminder({
    repeat: { kind: 'daily', interval: 1 },
    startAt: new Date('2026-06-10T10:05:00.000Z'),
    nextTriggerAt: new Date('2026-06-10T10:05:00.000Z'),
    version: 2,
  });
  const payload = createPayload(reminder);
  const events: string[] = [];
  const overdueSuccessorAt = new Date('2026-06-11T10:05:00.000Z');

  const executor = createScheduledTaskExecutor({
    remindersRepository: {
      findById: async () => reminder,
      advanceAfterDelivery: async (input) => {
        events.push('advance');
        assert.equal(input.nextTriggerAt?.getTime(), overdueSuccessorAt.getTime());
        return {
          ...reminder,
          nextTriggerAt: overdueSuccessorAt,
          lastFiredAt: new Date('2026-06-14T10:05:30.000Z'),
          updatedAt: new Date('2026-06-14T10:05:30.000Z'),
          scheduleProvider: null,
          scheduleTargetId: null,
          scheduleTargetVersion: null,
          scheduleTargetFireAt: null,
        };
      },
    },
    deliveriesRepository: {
      insertPending: async () => {
        events.push('insert');
        return {
          inserted: true,
          delivery: {
            id: 'delivery-1',
            reminderId: reminder.id,
            userId: reminder.userId,
            occurrenceAt: reminder.nextTriggerAt ?? reminder.triggerAt,
            reminderVersion: reminder.version,
            deliveryKey: payload.deliveryKey,
            status: 'pending',
            providerMessageId: null,
            attemptCount: 0,
            createdAt: new Date('2026-06-14T10:05:00.000Z'),
            sentAt: null,
            failureReason: null,
          },
        };
      },
      markSent: async () => {
        events.push('mark-sent');
      },
      markFailed: async () => {
        events.push('mark-failed');
      },
      markCanceled: async () => {
        events.push('mark-canceled');
      },
      markStale: async () => {
        events.push('mark-stale');
      },
    },
    notificationSender: {
      sendReminderNotification: async () => {
        events.push('send');
        return { status: 'sent', delivered: 1, failed: 0, providerMessageId: 'push-1' };
      },
    },
    schedulerService: {
      scheduleNextOccurrence: async () => {
        events.push('schedule-next');
        return { scheduled: true, deliveryKey: 'next-key' };
      },
      cancelCurrentSchedule: async () => undefined,
      clearScheduleMetadata: async () => {
        events.push('clear');
      },
    },
    computeNext: (nowMs, startAtMs, _baseAtLocal, repeat) => {
      if (repeat === null) {
        throw new Error('repeat is required');
      }
      const stepMs = 24 * 60 * 60 * 1000 * repeat.interval;
      const steps = Math.floor((nowMs - startAtMs) / stepMs) + 1;
      return startAtMs + steps * stepMs;
    },
    now: () => new Date('2026-06-14T10:05:30.000Z'),
  });

  const result = await executor.execute(payload);

  assert.equal(result.status, 'sent');
  assert.deepEqual(events, ['insert', 'send', 'mark-sent', 'advance']);
});

test('executor marks failed and does not advance recurrence when push fails', async () => {
  const reminder = createReminder();
  const payload = createPayload(reminder);
  const events: string[] = [];

  const executor = createScheduledTaskExecutor({
    remindersRepository: {
      findById: async () => reminder,
      advanceAfterDelivery: async () => {
        events.push('advance');
        return reminder;
      },
    },
    deliveriesRepository: {
      insertPending: async () => {
        events.push('insert');
        return {
          inserted: true,
          delivery: {
            id: 'delivery-1',
            reminderId: reminder.id,
            userId: reminder.userId,
            occurrenceAt: reminder.nextTriggerAt ?? reminder.triggerAt,
            reminderVersion: reminder.version,
            deliveryKey: payload.deliveryKey,
            status: 'pending',
            providerMessageId: null,
            attemptCount: 0,
            createdAt: new Date('2026-06-13T10:05:00.000Z'),
            sentAt: null,
            failureReason: null,
          },
        };
      },
      markSent: async () => {
        events.push('mark-sent');
      },
      markFailed: async (input: Readonly<{ reason: string }>) => {
        events.push(`mark-failed:${input.reason}`);
      },
      markCanceled: async () => {
        events.push('mark-canceled');
      },
      markStale: async () => {
        events.push('mark-stale');
      },
    },
    notificationSender: {
      sendReminderNotification: async () => {
        events.push('send');
        return { status: 'failed', delivered: 0, failed: 1, reason: 'push_failed' };
      },
    },
    schedulerService: {
      scheduleNextOccurrence: async () => {
        events.push('schedule-next');
        return { scheduled: true, deliveryKey: 'next-key' };
      },
      cancelCurrentSchedule: async () => undefined,
      clearScheduleMetadata: async () => {
        events.push('clear');
      },
    },
  });

  const result = await executor.execute(payload);

  assert.equal(result.status, 'failed');
  assert.deepEqual(events, ['insert', 'send', 'mark-failed:push_failed']);
});
