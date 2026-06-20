import { createRequire } from 'node:module';

import type { ReminderRecord, ReminderRepeatRule, ReminderSchedulerPayload } from './contracts.js';
import type { ReminderNotificationSender } from './notification-sender.js';
import type { ReminderDeliveriesRepository } from './repositories/reminder-deliveries-repository.js';
import type { RemindersRepository } from './repositories/reminders-repository.js';
import {
  createReminderDeliveryKey,
  type ReminderSchedulerService,
} from './scheduler-service.js';

type ComputeNextTrigger = (
  now: number,
  startAt: number,
  baseAtLocal: string,
  repeat: ReminderRepeatRule | null,
  timezone?: string,
) => number | null;

const require = createRequire(import.meta.url);

const loadComputeNextTrigger = (): ComputeNextTrigger => {
  try {
    const shared = require('../../../../packages/shared/utils/recurrence.js') as {
      computeNextTrigger?: ComputeNextTrigger;
    };
    if (typeof shared.computeNextTrigger === 'function') {
      return shared.computeNextTrigger;
    }
  } catch {
    // Backend tests and local runs can execute before shared JS artifacts exist.
  }

  return (now, startAt, _baseAtLocal, repeat) => {
    if (!repeat) {
      return null;
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const stepMs = repeat.kind === 'daily' ? repeat.interval * dayMs : dayMs;
    const steps = Math.floor((now - startAt) / stepMs) + 1;
    return startAt + steps * stepMs;
  };
};

const isDueOccurrence = (reminder: ReminderRecord, occurrenceAt: Date): boolean => {
  const current = reminder.snoozedUntil ?? reminder.nextTriggerAt ?? reminder.triggerAt;
  return current.getTime() === occurrenceAt.getTime();
};

const computeNextAfter = (
  computeNext: ComputeNextTrigger,
  reminder: ReminderRecord,
  occurrenceAt: Date,
): Date | null => {
  if (!reminder.repeat || !reminder.startAt || !reminder.baseAtLocal) {
    return null;
  }

  const nextMs = computeNext(
    occurrenceAt.getTime(),
    reminder.startAt.getTime(),
    reminder.baseAtLocal,
    reminder.repeat,
    reminder.timezone,
  );

  return nextMs === null ? null : new Date(nextMs);
};

export type ScheduledTaskExecutor = Readonly<{
  execute: (payload: ReminderSchedulerPayload) => Promise<Readonly<{ status: string }>>;
}>;

export const createScheduledTaskExecutor = (
  deps: Readonly<{
    remindersRepository: Pick<RemindersRepository, 'findById' | 'advanceAfterDelivery'>;
    deliveriesRepository: ReminderDeliveriesRepository;
    notificationSender: ReminderNotificationSender;
    schedulerService: ReminderSchedulerService;
    computeNext?: ComputeNextTrigger;
    now?: () => Date;
  }>,
): ScheduledTaskExecutor => {
  const computeNext = deps.computeNext ?? loadComputeNextTrigger();
  const now = deps.now ?? (() => new Date());

  return {
    execute: async (payload) => {
      const occurrenceAt = new Date(payload.occurrenceAt);
      const reminder = await deps.remindersRepository.findById({
        reminderId: payload.reminderId,
      });

      if (!reminder) {
        return { status: 'missing' };
      }

      const terminalInput = {
        deliveryKey: payload.deliveryKey,
        reminderId: payload.reminderId,
        userId: reminder.userId,
        occurrenceAt,
        reminderVersion: payload.version,
      };

      if (!reminder.active || reminder.done === true) {
        await deps.deliveriesRepository.markCanceled({ ...terminalInput, reason: 'inactive' });
        return { status: 'canceled' };
      }

      if (reminder.version !== payload.version) {
        await deps.deliveriesRepository.markStale({
          ...terminalInput,
          reason: 'version_mismatch',
        });
        return { status: 'stale' };
      }

      if (!isDueOccurrence(reminder, occurrenceAt)) {
        await deps.deliveriesRepository.markStale({
          ...terminalInput,
          reason: 'occurrence_mismatch',
        });
        return { status: 'stale' };
      }

      const expectedKey = createReminderDeliveryKey({
        reminderId: reminder.id,
        occurrenceAt,
        version: reminder.version,
      });
      if (payload.deliveryKey !== expectedKey) {
        await deps.deliveriesRepository.markStale({
          ...terminalInput,
          reason: 'delivery_key_mismatch',
        });
        return { status: 'stale' };
      }

      const inserted = await deps.deliveriesRepository.insertPending({
        reminderId: reminder.id,
        userId: reminder.userId,
        occurrenceAt,
        reminderVersion: reminder.version,
        deliveryKey: payload.deliveryKey,
      });
      if (!inserted.inserted) {
        return { status: 'duplicate' };
      }

      const sendResult = await deps.notificationSender.sendReminderNotification({
        reminder,
        deliveryKey: payload.deliveryKey,
        attempt: inserted.delivery.attemptCount,
      });
      if (sendResult.status !== 'sent') {
        await deps.deliveriesRepository.markFailed({
          deliveryKey: payload.deliveryKey,
          reason: sendResult.reason ?? 'push_failed',
        });
        return { status: 'failed' };
      }

      await deps.deliveriesRepository.markSent({
        deliveryKey: payload.deliveryKey,
        providerMessageId: sendResult.providerMessageId,
      });

      const runNow = now();
      const nextTriggerAt = computeNextAfter(computeNext, reminder, occurrenceAt);
      const advanced = await deps.remindersRepository.advanceAfterDelivery({
        reminderId: reminder.id,
        userId: reminder.userId,
        occurrenceAt,
        expectedVersion: reminder.version,
        nextTriggerAt,
        scheduleStatus: nextTriggerAt ? 'scheduled' : 'unscheduled',
        runNow,
      });

      if (advanced && advanced.nextTriggerAt && advanced.nextTriggerAt.getTime() > runNow.getTime()) {
        await deps.schedulerService.scheduleNextOccurrence(advanced);
      } else if (advanced && advanced.nextTriggerAt === null) {
        await deps.schedulerService.clearScheduleMetadata(advanced);
      }

      return { status: 'sent' };
    },
  };
};
