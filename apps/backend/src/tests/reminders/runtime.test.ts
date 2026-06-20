import assert from 'node:assert/strict';
import test from 'node:test';

import type { NoteChangeEventsRepository } from '../../notes/repositories/note-change-events-repository.js';
import type {
  ReminderCreateInput,
  ReminderRecord,
} from '../../reminders/contracts.js';
import type { RemindersRepository } from '../../reminders/repositories/reminders-repository.js';
import { createReminderSchedulerRuntime } from '../../reminders/runtime.js';

const createReminderRecord = (input: ReminderCreateInput): ReminderRecord => ({
  id: input.id,
  userId: input.userId,
  title: input.title,
  triggerAt: input.triggerAt,
  done: input.done,
  repeatRule: input.repeatRule,
  repeatConfig: input.repeatConfig,
  repeat: input.repeat,
  snoozedUntil: input.snoozedUntil,
  active: input.active,
  scheduleStatus: input.scheduleStatus,
  timezone: input.timezone,
  baseAtLocal: input.baseAtLocal,
  startAt: input.startAt,
  nextTriggerAt: input.nextTriggerAt,
  lastFiredAt: input.lastFiredAt,
  lastAcknowledgedAt: input.lastAcknowledgedAt,
  scheduleProvider: input.scheduleProvider,
  scheduleTargetId: input.scheduleTargetId,
  scheduleTargetVersion: input.scheduleTargetVersion,
  scheduleTargetFireAt: input.scheduleTargetFireAt,
  version: input.version,
  createdAt: input.createdAt,
  updatedAt: input.updatedAt,
});

test('runtime enables qstash scheduler for reminder writes and exposes verifier config', async () => {
  const reminders = new Map<string, ReminderRecord>();
  const remindersRepository: RemindersRepository = {
    listByUser: async () => [],
    listRepairCandidates: async () => [],
    findById: async ({ reminderId }) => {
      for (const reminder of reminders.values()) {
        if (reminder.id === reminderId) {
          return reminder;
        }
      }
      return null;
    },
    findByIdForUser: async ({ reminderId, userId }) => reminders.get(`${userId}:${reminderId}`) ?? null,
    create: async (input: ReminderCreateInput) => {
      const reminder = createReminderRecord(input);
      reminders.set(`${reminder.userId}:${reminder.id}`, reminder);
      return reminder;
    },
    patch: async ({ reminderId, userId, patch }) => {
      const existing = reminders.get(`${userId}:${reminderId}`);
      if (!existing) {
        return null;
      }

      const next: ReminderRecord = {
        ...existing,
        ...(Object.hasOwn(patch, 'scheduleStatus')
          ? { scheduleStatus: patch.scheduleStatus ?? existing.scheduleStatus }
          : {}),
        ...(Object.hasOwn(patch, 'scheduleProvider')
          ? { scheduleProvider: patch.scheduleProvider ?? null }
          : {}),
        ...(Object.hasOwn(patch, 'scheduleTargetId')
          ? { scheduleTargetId: patch.scheduleTargetId ?? null }
          : {}),
        ...(Object.hasOwn(patch, 'scheduleTargetVersion')
          ? { scheduleTargetVersion: patch.scheduleTargetVersion ?? null }
          : {}),
        ...(Object.hasOwn(patch, 'scheduleTargetFireAt')
          ? { scheduleTargetFireAt: patch.scheduleTargetFireAt ?? null }
          : {}),
        ...(Object.hasOwn(patch, 'updatedAt')
          ? { updatedAt: patch.updatedAt ?? existing.updatedAt }
          : {}),
      };
      reminders.set(`${userId}:${reminderId}`, next);
      return next;
    },
    advanceAfterDelivery: async () => {
      throw new Error('advanceAfterDelivery should not run in runtime wiring test');
    },
    deleteByIdForUser: async () => false,
  };
  const noteChangeEventsRepository: NoteChangeEventsRepository = {
    isDuplicate: async () => false,
    appendEvent: async () => undefined,
  };
  const publishCalls: unknown[] = [];
  const runtime = createReminderSchedulerRuntime({
    remindersRepository,
    noteChangeEventsRepository,
    schedulerConfig: {
      REMINDER_SCHEDULER_PROVIDER: 'qstash',
      REMINDER_SCHEDULER_CALLBACK_BASE_URL: 'https://api.example.test',
      QSTASH_TOKEN: 'qstash-token',
      QSTASH_CURRENT_SIGNING_KEY: 'current-signing-key',
      QSTASH_NEXT_SIGNING_KEY: 'next-signing-key',
    },
    qstashClient: {
      publishJSON: async (input) => {
        publishCalls.push(input);
        return { messageId: 'msg_123' };
      },
      messages: {
        cancel: async () => undefined,
      },
    },
    now: () => new Date('2026-06-13T09:00:00.000Z'),
  });

  await runtime.remindersService.createReminder({
    userId: 'user-1',
    id: 'reminder-1',
    title: 'Recurring reminder',
    triggerAt: Date.parse('2026-06-13T10:05:00.000Z'),
    active: true,
    timezone: 'UTC',
    repeat: { kind: 'daily', interval: 1 },
    startAt: Date.parse('2026-06-13T10:05:00.000Z'),
    baseAtLocal: '2026-06-13T10:05:00',
  });

  assert.equal(runtime.schedulerCallbacksEnabled, true);
  assert.deepEqual(runtime.qstashVerifierConfig, {
    currentSigningKey: 'current-signing-key',
    nextSigningKey: 'next-signing-key',
    callbackUrl: 'https://api.example.test/internal/reminders/scheduled-task',
  });
  assert.deepEqual(publishCalls, [
    {
      url: 'https://api.example.test/internal/reminders/scheduled-task',
      body: {
        reminderId: 'reminder-1',
        occurrenceAt: '2026-06-13T10:05:00.000Z',
        version: 1,
        deliveryKey: 'reminder-1:1781345100000:v1',
      },
      delay: 3900,
    },
  ]);
});
