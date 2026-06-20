import assert from 'node:assert/strict';
import test from 'node:test';

import type { NoteChangeEventsRepository } from '../../notes/repositories/note-change-events-repository.js';
import type {
  ReminderCreateInput,
  ReminderPatchInput,
  ReminderRecord,
  ReminderRepeatRule,
  ReminderSchedulerPayload,
} from '../../reminders/contracts.js';
import { createReminderRepairJob } from '../../reminders/repair-job.js';
import type {
  ReminderDeliveriesRepository,
  ReminderDeliveryRecord,
} from '../../reminders/repositories/reminder-deliveries-repository.js';
import type { RemindersRepository } from '../../reminders/repositories/reminders-repository.js';
import type { SchedulerProvider } from '../../reminders/scheduler-provider.js';
import { createReminderDeliveryKey, createReminderSchedulerService } from '../../reminders/scheduler-service.js';
import { createScheduledTaskExecutor } from '../../reminders/scheduled-task-executor.js';
import { createRemindersService } from '../../reminders/service.js';

type ComputeNextTrigger = (
  now: number,
  startAt: number,
  baseAtLocal: string,
  repeat: ReminderRepeatRule | null,
  timezone?: string,
) => number | null;

type EventLog = string[];

const computeNext: ComputeNextTrigger = (now, startAt, _baseAtLocal, repeat) => {
  if (!repeat) {
    return startAt > now ? startAt : null;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;
  const toNext = (stepMs: number): number | null => {
    if (!Number.isFinite(stepMs) || stepMs <= 0) {
      return null;
    }

    if (startAt > now) {
      return startAt;
    }

    const steps = Math.floor((now - startAt) / stepMs) + 1;
    return startAt + steps * stepMs;
  };

  if (repeat.kind === 'daily') {
    return toNext(repeat.interval * dayMs);
  }

  if (repeat.kind === 'weekly') {
    return toNext(repeat.interval * weekMs);
  }

  return null;
};

const cloneReminder = (value: ReminderRecord): ReminderRecord => ({
  ...value,
  triggerAt: new Date(value.triggerAt.getTime()),
  repeatConfig: value.repeatConfig ? { ...value.repeatConfig } : null,
  repeat: value.repeat ? structuredClone(value.repeat) : null,
  snoozedUntil: value.snoozedUntil ? new Date(value.snoozedUntil.getTime()) : null,
  startAt: value.startAt ? new Date(value.startAt.getTime()) : null,
  nextTriggerAt: value.nextTriggerAt ? new Date(value.nextTriggerAt.getTime()) : null,
  lastFiredAt: value.lastFiredAt ? new Date(value.lastFiredAt.getTime()) : null,
  lastAcknowledgedAt: value.lastAcknowledgedAt
    ? new Date(value.lastAcknowledgedAt.getTime())
    : null,
  scheduleTargetFireAt: value.scheduleTargetFireAt
    ? new Date(value.scheduleTargetFireAt.getTime())
    : null,
  createdAt: new Date(value.createdAt.getTime()),
  updatedAt: new Date(value.updatedAt.getTime()),
});

const createReminderRecord = (
  input: Readonly<{
    id: string;
    userId: string;
    triggerAt: Date;
    updatedAt: Date;
    createdAt?: Date;
    title?: string | null;
    repeat?: ReminderRepeatRule | null;
    startAt?: Date | null;
    baseAtLocal?: string | null;
    nextTriggerAt?: Date | null;
    snoozedUntil?: Date | null;
    active?: boolean;
    done?: boolean | null;
    scheduleStatus?: string;
    version?: number;
    scheduleProvider?: string | null;
    scheduleTargetId?: string | null;
    scheduleTargetVersion?: number | null;
    scheduleTargetFireAt?: Date | null;
    lastFiredAt?: Date | null;
    lastAcknowledgedAt?: Date | null;
  }>,
): ReminderRecord => ({
  id: input.id,
  userId: input.userId,
  title: input.title ?? null,
  triggerAt: input.triggerAt,
  done: input.done ?? null,
  repeatRule: input.repeat?.kind ?? 'none',
  repeatConfig: null,
  repeat: input.repeat ?? null,
  snoozedUntil: input.snoozedUntil ?? null,
  active: input.active ?? true,
  scheduleStatus: input.scheduleStatus ?? 'scheduled',
  timezone: 'UTC',
  baseAtLocal: input.baseAtLocal ?? null,
  startAt: input.startAt ?? null,
  nextTriggerAt: input.nextTriggerAt ?? null,
  lastFiredAt: input.lastFiredAt ?? null,
  lastAcknowledgedAt: input.lastAcknowledgedAt ?? null,
  scheduleProvider: input.scheduleProvider ?? null,
  scheduleTargetId: input.scheduleTargetId ?? null,
  scheduleTargetVersion: input.scheduleTargetVersion ?? null,
  scheduleTargetFireAt: input.scheduleTargetFireAt ?? null,
  version: input.version ?? 1,
  createdAt: input.createdAt ?? input.updatedAt,
  updatedAt: input.updatedAt,
});

const createChangeEventsRepository = (): NoteChangeEventsRepository => {
  const dedupe = new Set<string>();

  return {
    isDuplicate: async ({ noteId, userId, operation, payloadHash }) => {
      return dedupe.has(`${userId}:${noteId}:${operation}:${payloadHash}`);
    },
    appendEvent: async ({ noteId, userId, operation, payloadHash }) => {
      dedupe.add(`${userId}:${noteId}:${operation}:${payloadHash}`);
    },
  };
};

type SchedulerHarness = Readonly<{
  events: EventLog;
  remindersRepository: RemindersRepository;
  reminderService: ReturnType<typeof createRemindersService>;
  scheduledTaskExecutor: ReturnType<typeof createScheduledTaskExecutor>;
  repairJob: ReturnType<typeof createReminderRepairJob>;
  deliveries: Map<string, ReminderDeliveryRecord>;
  getReminder: (userId: string, reminderId: string) => Promise<ReminderRecord | null>;
  getScheduledPayloadById: (scheduleId: string) => ReminderSchedulerPayload | null;
  getOnlyScheduledPayload: () => Readonly<{ scheduleId: string; payload: ReminderSchedulerPayload }>;
  insertReminder: (reminder: ReminderRecord) => void;
  resetEvents: () => void;
  setNow: (next: Date) => void;
}>;

const createSchedulerHarness = (initialNow: Date): SchedulerHarness => {
  const events: EventLog = [];
  const remindersByKey = new Map<string, ReminderRecord>();
  const deliveries = new Map<string, ReminderDeliveryRecord>();
  const scheduledPayloads = new Map<string, ReminderSchedulerPayload>();
  let deliveryId = 0;
  let now = new Date(initialNow.getTime());

  const reminderKey = (userId: string, reminderId: string): string => `${userId}:${reminderId}`;
  const occurrenceKey = (reminderId: string, occurrenceAt: Date): string =>
    `${reminderId}:${occurrenceAt.getTime()}`;

  const applyPatch = (current: ReminderRecord, patch: ReminderPatchInput): ReminderRecord => ({
    ...current,
    ...(Object.hasOwn(patch, 'title') ? { title: patch.title ?? null } : {}),
    ...(Object.hasOwn(patch, 'triggerAt') ? { triggerAt: patch.triggerAt ?? current.triggerAt } : {}),
    ...(Object.hasOwn(patch, 'done') ? { done: patch.done ?? null } : {}),
    ...(Object.hasOwn(patch, 'repeatRule') ? { repeatRule: patch.repeatRule ?? null } : {}),
    ...(Object.hasOwn(patch, 'repeatConfig') ? { repeatConfig: patch.repeatConfig ?? null } : {}),
    ...(Object.hasOwn(patch, 'repeat') ? { repeat: patch.repeat ?? null } : {}),
    ...(Object.hasOwn(patch, 'snoozedUntil') ? { snoozedUntil: patch.snoozedUntil ?? null } : {}),
    ...(Object.hasOwn(patch, 'active') ? { active: patch.active ?? current.active } : {}),
    ...(Object.hasOwn(patch, 'scheduleStatus')
      ? { scheduleStatus: patch.scheduleStatus ?? current.scheduleStatus }
      : {}),
    ...(Object.hasOwn(patch, 'timezone') ? { timezone: patch.timezone ?? current.timezone } : {}),
    ...(Object.hasOwn(patch, 'baseAtLocal') ? { baseAtLocal: patch.baseAtLocal ?? null } : {}),
    ...(Object.hasOwn(patch, 'startAt') ? { startAt: patch.startAt ?? null } : {}),
    ...(Object.hasOwn(patch, 'nextTriggerAt') ? { nextTriggerAt: patch.nextTriggerAt ?? null } : {}),
    ...(Object.hasOwn(patch, 'lastFiredAt') ? { lastFiredAt: patch.lastFiredAt ?? null } : {}),
    ...(Object.hasOwn(patch, 'lastAcknowledgedAt')
      ? { lastAcknowledgedAt: patch.lastAcknowledgedAt ?? null }
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
    ...(Object.hasOwn(patch, 'version') ? { version: patch.version ?? current.version } : {}),
    ...(Object.hasOwn(patch, 'updatedAt') ? { updatedAt: patch.updatedAt ?? current.updatedAt } : {}),
  });

  const remindersRepository: RemindersRepository = {
    listByUser: async ({ userId, updatedSince }) => {
      return [...remindersByKey.values()]
        .filter((item) => {
          if (item.userId !== userId) {
            return false;
          }

          if (!updatedSince) {
            return true;
          }

          return item.updatedAt.getTime() > updatedSince.getTime();
        })
        .map(cloneReminder);
    },
    listRepairCandidates: async ({ now: runAt, limit }) => {
      return [...remindersByKey.values()]
        .filter((item) => {
          if (!item.active || item.nextTriggerAt === null) {
            return false;
          }

          return (
            item.nextTriggerAt.getTime() <= runAt.getTime() ||
            item.scheduleTargetId === null ||
            item.scheduleTargetVersion !== item.version
          );
        })
        .sort((left, right) => {
          const nextDelta =
            (left.nextTriggerAt?.getTime() ?? Number.POSITIVE_INFINITY) -
            (right.nextTriggerAt?.getTime() ?? Number.POSITIVE_INFINITY);
          if (nextDelta !== 0) {
            return nextDelta;
          }

          return left.updatedAt.getTime() - right.updatedAt.getTime();
        })
        .slice(0, limit)
        .map(cloneReminder);
    },
    findById: async ({ reminderId }) => {
      for (const record of remindersByKey.values()) {
        if (record.id === reminderId) {
          return cloneReminder(record);
        }
      }

      return null;
    },
    findByIdForUser: async ({ reminderId, userId }) => {
      const found = remindersByKey.get(reminderKey(userId, reminderId));
      return found ? cloneReminder(found) : null;
    },
    create: async (input: ReminderCreateInput) => {
      const created = cloneReminder({
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

      remindersByKey.set(reminderKey(created.userId, created.id), cloneReminder(created));
      return cloneReminder(created);
    },
    patch: async ({ reminderId, userId, patch }) => {
      const current = remindersByKey.get(reminderKey(userId, reminderId));
      if (!current) {
        return null;
      }

      const next = cloneReminder(applyPatch(cloneReminder(current), patch));
      remindersByKey.set(reminderKey(userId, reminderId), cloneReminder(next));
      return cloneReminder(next);
    },
    advanceAfterDelivery: async ({
      reminderId,
      userId,
      occurrenceAt,
      expectedVersion,
      nextTriggerAt,
      scheduleStatus,
      runNow,
    }) => {
      const current = remindersByKey.get(reminderKey(userId, reminderId));
      if (!current) {
        return null;
      }

      const currentOccurrence = current.snoozedUntil ?? current.nextTriggerAt ?? current.triggerAt;
      if (
        current.version !== expectedVersion ||
        !current.active ||
        currentOccurrence.getTime() !== occurrenceAt.getTime()
      ) {
        return null;
      }

      const next = cloneReminder({
        ...current,
        lastFiredAt: occurrenceAt,
        nextTriggerAt,
        scheduleStatus,
        scheduleProvider: null,
        scheduleTargetId: null,
        scheduleTargetVersion: null,
        scheduleTargetFireAt: null,
        snoozedUntil: null,
        updatedAt: runNow,
      });

      remindersByKey.set(reminderKey(userId, reminderId), cloneReminder(next));
      return cloneReminder(next);
    },
    deleteByIdForUser: async ({ reminderId, userId }) => {
      return remindersByKey.delete(reminderKey(userId, reminderId));
    },
  };

  const deliveriesRepository: ReminderDeliveriesRepository = {
    insertPending: async ({ reminderId, userId, occurrenceAt, reminderVersion, deliveryKey }) => {
      const byOccurrence = occurrenceKey(reminderId, occurrenceAt);
      const existing = deliveries.get(byOccurrence) ?? deliveries.get(deliveryKey);
      if (existing) {
        return { inserted: false, delivery: existing };
      }

      const created: ReminderDeliveryRecord = {
        id: `delivery-${++deliveryId}`,
        reminderId,
        userId,
        occurrenceAt,
        reminderVersion,
        deliveryKey,
        status: 'pending',
        providerMessageId: null,
        attemptCount: 0,
        createdAt: new Date(now.getTime()),
        sentAt: null,
        failureReason: null,
      };

      deliveries.set(byOccurrence, created);
      deliveries.set(deliveryKey, created);
      events.push(`delivery:${deliveryKey}`);
      return { inserted: true, delivery: created };
    },
    markSent: async ({ deliveryKey, providerMessageId }) => {
      const existing = deliveries.get(deliveryKey);
      if (!existing) {
        throw new Error(`Missing delivery ${deliveryKey}`);
      }

      const next: ReminderDeliveryRecord = {
        ...existing,
        status: 'sent',
        providerMessageId: providerMessageId ?? null,
        attemptCount: existing.attemptCount + 1,
        sentAt: new Date(now.getTime()),
        failureReason: null,
      };
      deliveries.set(deliveryKey, next);
      deliveries.set(occurrenceKey(next.reminderId, next.occurrenceAt), next);
    },
    markFailed: async ({ deliveryKey, reason }) => {
      const existing = deliveries.get(deliveryKey);
      if (!existing) {
        throw new Error(`Missing delivery ${deliveryKey}`);
      }

      const next: ReminderDeliveryRecord = {
        ...existing,
        status: 'failed',
        attemptCount: existing.attemptCount + 1,
        failureReason: reason,
      };
      deliveries.set(deliveryKey, next);
      deliveries.set(occurrenceKey(next.reminderId, next.occurrenceAt), next);
    },
    markCanceled: async ({ deliveryKey, reminderId, userId, occurrenceAt, reminderVersion, reason }) => {
      const next: ReminderDeliveryRecord = {
        id: `delivery-${++deliveryId}`,
        reminderId,
        userId,
        occurrenceAt,
        reminderVersion,
        deliveryKey,
        status: 'canceled',
        providerMessageId: null,
        attemptCount: 0,
        createdAt: new Date(now.getTime()),
        sentAt: null,
        failureReason: reason,
      };
      deliveries.set(deliveryKey, next);
      deliveries.set(occurrenceKey(reminderId, occurrenceAt), next);
    },
    markStale: async ({ deliveryKey, reminderId, userId, occurrenceAt, reminderVersion, reason }) => {
      const next: ReminderDeliveryRecord = {
        id: `delivery-${++deliveryId}`,
        reminderId,
        userId,
        occurrenceAt,
        reminderVersion,
        deliveryKey,
        status: 'stale',
        providerMessageId: null,
        attemptCount: 0,
        createdAt: new Date(now.getTime()),
        sentAt: null,
        failureReason: reason,
      };
      deliveries.set(deliveryKey, next);
      deliveries.set(occurrenceKey(reminderId, occurrenceAt), next);
    },
  };

  const provider: SchedulerProvider = {
    name: 'fake',
    scheduleOnce: async (payload) => {
      const scheduleId = `schedule-${payload.deliveryKey}`;
      scheduledPayloads.set(scheduleId, {
        reminderId: payload.reminderId,
        occurrenceAt: payload.occurrenceAt.toISOString(),
        version: payload.version,
        deliveryKey: payload.deliveryKey,
      });
      events.push(`schedule:${payload.reminderId}:${payload.version}`);
      return {
        provider: 'fake',
        scheduleId,
        fireAt: payload.occurrenceAt,
      };
    },
    cancel: async ({ scheduleId }) => {
      scheduledPayloads.delete(scheduleId);
      events.push(`cancel:${scheduleId}`);
    },
  };

  const schedulerService = createReminderSchedulerService({
    provider,
    remindersRepository,
    now: () => new Date(now.getTime()),
  });

  const scheduledTaskExecutor = createScheduledTaskExecutor({
    remindersRepository,
    deliveriesRepository,
    notificationSender: {
      sendReminderNotification: async ({ reminder }) => {
        events.push(`send:${reminder.id}`);
        return {
          status: 'sent',
          delivered: 1,
          failed: 0,
          providerMessageId: `push:${reminder.id}`,
        };
      },
    },
    schedulerService,
    computeNext,
    now: () => new Date(now.getTime()),
  });

  const repairJob = createReminderRepairJob({
    remindersRepository,
    executor: scheduledTaskExecutor,
    schedulerService,
    now: () => new Date(now.getTime()),
  });

  const reminderService = createRemindersService({
    remindersRepository,
    noteChangeEventsRepository: createChangeEventsRepository(),
    schedulerService,
    now: () => new Date(now.getTime()),
    computeNext,
  });

  return {
    events,
    remindersRepository,
    reminderService,
    scheduledTaskExecutor,
    repairJob,
    deliveries,
    getReminder: async (userId, reminderId) => {
      return await remindersRepository.findByIdForUser({ userId, reminderId });
    },
    getScheduledPayloadById: (scheduleId) => {
      return scheduledPayloads.get(scheduleId) ?? null;
    },
    getOnlyScheduledPayload: () => {
      const first = [...scheduledPayloads.entries()][0];
      if (!first) {
        throw new Error('Expected one scheduled payload');
      }

      if (scheduledPayloads.size !== 1) {
        throw new Error(`Expected one scheduled payload, found ${scheduledPayloads.size}`);
      }

      return { scheduleId: first[0], payload: first[1] };
    },
    insertReminder: (reminder) => {
      remindersByKey.set(reminderKey(reminder.userId, reminder.id), cloneReminder(reminder));
    },
    resetEvents: () => {
      events.splice(0, events.length);
    },
    setNow: (next) => {
      now = new Date(next.getTime());
    },
  };
};

test('create reminder schedules exactly one next occurrence', async () => {
  const now = new Date('2026-06-13T09:00:00.000Z');
  const harness = createSchedulerHarness(now);

  await harness.reminderService.createReminder({
    id: 'reminder-1',
    userId: 'user-1',
    title: 'Reminder',
    triggerAt: Date.parse('2026-06-13T10:05:00.000Z'),
    active: true,
    timezone: 'UTC',
    repeat: { kind: 'daily', interval: 1 },
    startAt: Date.parse('2026-06-13T10:05:00.000Z'),
    baseAtLocal: '2026-06-13T10:05:00',
    updatedAt: now.getTime(),
    createdAt: now.getTime(),
  });

  const scheduledReminder = await harness.getReminder('user-1', 'reminder-1');
  assert.notEqual(scheduledReminder, null);
  assert.equal(scheduledReminder?.scheduleTargetVersion, 1);
  assert.equal(scheduledReminder?.scheduleTargetId?.startsWith('schedule-'), true);
  assert.equal(scheduledReminder?.scheduleTargetFireAt?.toISOString(), '2026-06-13T10:05:00.000Z');
});

test('update reminder cancels old schedule and creates replacement from edit time forward', async () => {
  const now = new Date('2026-06-13T09:00:00.000Z');
  const harness = createSchedulerHarness(now);

  await harness.reminderService.createReminder({
    id: 'reminder-1',
    userId: 'user-1',
    title: 'Recurring reminder',
    triggerAt: Date.parse('2026-06-13T10:05:00.000Z'),
    active: true,
    timezone: 'UTC',
    repeat: { kind: 'daily', interval: 1 },
    startAt: Date.parse('2026-06-13T10:05:00.000Z'),
    baseAtLocal: '2026-06-13T10:05:00',
    updatedAt: now.getTime(),
    createdAt: now.getTime(),
  });
  const beforeUpdate = await harness.getReminder('user-1', 'reminder-1');
  assert.notEqual(beforeUpdate, null);
  if (!beforeUpdate?.scheduleTargetId) {
    throw new Error('Expected reminder schedule metadata before update');
  }

  harness.resetEvents();
  harness.setNow(new Date('2026-06-13T09:30:00.000Z'));
  const updated = await harness.reminderService.updateReminder({
    userId: 'user-1',
    reminderId: 'reminder-1',
    patch: {
      startAt: Date.parse('2026-06-13T11:15:00.000Z'),
      baseAtLocal: '2026-06-13T11:15:00',
      updatedAt: Date.parse('2026-06-13T09:30:00.000Z'),
    },
  });

  assert.notEqual(updated, null);
  assert.equal(updated?.version, 2);
  assert.deepEqual(harness.events, [
    `cancel:${beforeUpdate.scheduleTargetId}`,
    'schedule:reminder-1:2',
  ]);
});

test('delete reminder cancels schedule and stale callback is ignored', async () => {
  const now = new Date('2026-06-13T09:00:00.000Z');
  const harness = createSchedulerHarness(now);

  await harness.reminderService.createReminder({
    id: 'reminder-1',
    userId: 'user-1',
    title: 'Reminder',
    triggerAt: Date.parse('2026-06-13T10:05:00.000Z'),
    active: true,
    timezone: 'UTC',
    repeat: { kind: 'daily', interval: 1 },
    startAt: Date.parse('2026-06-13T10:05:00.000Z'),
    baseAtLocal: '2026-06-13T10:05:00',
    updatedAt: now.getTime(),
    createdAt: now.getTime(),
  });
  const scheduledReminder = await harness.getReminder('user-1', 'reminder-1');
  assert.notEqual(scheduledReminder, null);
  if (!scheduledReminder?.nextTriggerAt || !scheduledReminder.scheduleTargetId) {
    throw new Error('Expected scheduled reminder state before delete');
  }
  const scheduled = {
    scheduleId: scheduledReminder.scheduleTargetId,
    payload: {
      reminderId: scheduledReminder.id,
      occurrenceAt: scheduledReminder.nextTriggerAt.toISOString(),
      version: scheduledReminder.version,
      deliveryKey: createReminderDeliveryKey({
        reminderId: scheduledReminder.id,
        occurrenceAt: scheduledReminder.nextTriggerAt,
        version: scheduledReminder.version,
      }),
    } satisfies ReminderSchedulerPayload,
  };

  harness.resetEvents();
  const deleted = await harness.reminderService.deleteReminder({
    userId: 'user-1',
    reminderId: 'reminder-1',
  });

  assert.equal(deleted, true);
  assert.deepEqual(harness.events, [`cancel:${scheduled.scheduleId}`]);

  harness.resetEvents();
  const result = await harness.scheduledTaskExecutor.execute(scheduled.payload);
  assert.equal(result.status, 'missing');
  assert.deepEqual(harness.events, []);
});

test('duplicate scheduled task execution sends only one delivery for the occurrence', async () => {
  const now = new Date('2026-06-13T09:00:00.000Z');
  const harness = createSchedulerHarness(now);

  await harness.reminderService.createReminder({
    id: 'reminder-1',
    userId: 'user-1',
    title: 'Reminder',
    triggerAt: Date.parse('2026-06-13T10:05:00.000Z'),
    active: true,
    timezone: 'UTC',
    repeat: { kind: 'daily', interval: 1 },
    startAt: Date.parse('2026-06-13T10:05:00.000Z'),
    baseAtLocal: '2026-06-13T10:05:00',
    updatedAt: now.getTime(),
    createdAt: now.getTime(),
  });
  const scheduledReminder = await harness.getReminder('user-1', 'reminder-1');
  assert.notEqual(scheduledReminder, null);
  if (!scheduledReminder?.nextTriggerAt) {
    throw new Error('Expected scheduled reminder state before execution');
  }
  const scheduled = {
    payload: {
      reminderId: scheduledReminder.id,
      occurrenceAt: scheduledReminder.nextTriggerAt.toISOString(),
      version: scheduledReminder.version,
      deliveryKey: createReminderDeliveryKey({
        reminderId: scheduledReminder.id,
        occurrenceAt: scheduledReminder.nextTriggerAt,
        version: scheduledReminder.version,
      }),
    } satisfies ReminderSchedulerPayload,
  };

  harness.resetEvents();
  const first = await harness.scheduledTaskExecutor.execute(scheduled.payload);
  const second = await harness.scheduledTaskExecutor.execute(scheduled.payload);

  assert.equal(first.status, 'sent');
  assert.equal(second.status, 'stale');
  assert.deepEqual(harness.events, [
    `delivery:${scheduled.payload.deliveryKey}`,
    'send:reminder-1',
    'schedule:reminder-1:1',
  ]);
});

test('repair job backfills missed occurrence after simulated downtime', async () => {
  const now = new Date('2026-06-13T10:10:00.000Z');
  const harness = createSchedulerHarness(now);
  const occurrenceAt = new Date('2026-06-13T10:05:00.000Z');
  const overdueReminder = createReminderRecord({
    id: 'reminder-1',
    userId: 'user-1',
    title: 'Reminder',
    triggerAt: occurrenceAt,
    nextTriggerAt: occurrenceAt,
    updatedAt: new Date('2026-06-13T09:55:00.000Z'),
    active: true,
    version: 2,
    scheduleProvider: null,
    scheduleTargetId: null,
    scheduleTargetVersion: null,
    scheduleTargetFireAt: null,
  });
  harness.insertReminder(overdueReminder);

  const result = await harness.repairJob.run();

  assert.equal(result.candidates, 1);
  assert.equal(result.executed, 1);
  assert.equal(result.scheduled, 0);
  assert.deepEqual(harness.events, [
    `delivery:${createReminderDeliveryKey({
      reminderId: 'reminder-1',
      occurrenceAt,
      version: 2,
    })}`,
    'send:reminder-1',
  ]);
});

test('repair job replays every missed recurring occurrence in order before recreating the next future schedule', async () => {
  const now = new Date('2026-06-14T10:05:30.000Z');
  const harness = createSchedulerHarness(now);
  const firstOccurrence = new Date('2026-06-10T10:05:00.000Z');
  harness.insertReminder(
    createReminderRecord({
      id: 'reminder-1',
      userId: 'user-1',
      title: 'Recurring reminder',
      triggerAt: firstOccurrence,
      nextTriggerAt: firstOccurrence,
      startAt: firstOccurrence,
      baseAtLocal: '2026-06-10T10:05:00',
      repeat: { kind: 'daily', interval: 1 },
      updatedAt: new Date('2026-06-10T09:55:00.000Z'),
      active: true,
      version: 2,
      scheduleProvider: null,
      scheduleTargetId: null,
      scheduleTargetVersion: null,
      scheduleTargetFireAt: null,
    }),
  );

  const result = await harness.repairJob.run();
  const repaired = await harness.getReminder('user-1', 'reminder-1');

  assert.equal(result.candidates, 1);
  assert.equal(result.executed, 5);
  assert.equal(result.scheduled, 0);
  assert.notEqual(repaired, null);
  assert.equal(repaired?.nextTriggerAt?.toISOString(), '2026-06-15T10:05:00.000Z');
  assert.deepEqual(harness.events, [
    `delivery:${createReminderDeliveryKey({
      reminderId: 'reminder-1',
      occurrenceAt: new Date('2026-06-10T10:05:00.000Z'),
      version: 2,
    })}`,
    'send:reminder-1',
    `delivery:${createReminderDeliveryKey({
      reminderId: 'reminder-1',
      occurrenceAt: new Date('2026-06-11T10:05:00.000Z'),
      version: 2,
    })}`,
    'send:reminder-1',
    `delivery:${createReminderDeliveryKey({
      reminderId: 'reminder-1',
      occurrenceAt: new Date('2026-06-12T10:05:00.000Z'),
      version: 2,
    })}`,
    'send:reminder-1',
    `delivery:${createReminderDeliveryKey({
      reminderId: 'reminder-1',
      occurrenceAt: new Date('2026-06-13T10:05:00.000Z'),
      version: 2,
    })}`,
    'send:reminder-1',
    `delivery:${createReminderDeliveryKey({
      reminderId: 'reminder-1',
      occurrenceAt: new Date('2026-06-14T10:05:00.000Z'),
      version: 2,
    })}`,
    'send:reminder-1',
    'schedule:reminder-1:2',
  ]);
});
