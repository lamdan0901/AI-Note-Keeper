import type { Reminder } from '../../../../packages/shared/types/reminder';
import { computeScheduleHash } from './scheduleHash';
import { deleteScheduleState, getScheduleState, upsertScheduleState } from './scheduleLedger';
import { logScheduleEvent } from './logging';

export type ReconcileResultStatus = 'unchanged' | 'scheduled' | 'canceled' | 'error';

export type ReconcileResult = {
  reminderId: string;
  status: ReconcileResultStatus;
  notificationIds: string[];
  hash: string;
  error?: string;
};

export type ScheduleOperations = {
  schedule: (reminder: Reminder, triggerAt: number) => Promise<string[]>;
  cancel: (notificationIds: string[]) => Promise<void>;
};

type DbLike = {
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  runAsync(sql: string, params?: unknown[]): Promise<void>;
};

const resolveTriggerAt = (reminder: Reminder): number =>
  reminder.snoozedUntil ?? reminder.triggerAt;

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const reconcileSingle = async (
  db: DbLike,
  reminder: Reminder,
  scheduler: ScheduleOperations,
  now: number = Date.now(),
): Promise<ReconcileResult> => {
  const desiredHash = computeScheduleHash({
    triggerAt: reminder.triggerAt,
    repeatRule: reminder.repeatRule,
    active: reminder.active,
    snoozedUntil: reminder.snoozedUntil,
    title: reminder.title,
    repeatConfig: reminder.repeatConfig,
  });

  const existing = await getScheduleState(db, reminder.id);

  if (!reminder.active) {
    if (existing?.notificationIds?.length) {
      try {
        await scheduler.cancel(existing.notificationIds);
        logScheduleEvent('info', 'reconcile_cancel_inactive', {
          reminderId: reminder.id,
          notificationIds: existing.notificationIds,
        });
      } catch (error) {
        const message = stringifyError(error);
        await upsertScheduleState(db, {
          reminderId: reminder.id,
          notificationIds: existing.notificationIds,
          lastScheduledHash: desiredHash,
          status: 'error',
          lastScheduledAt: now,
          lastError: message,
        });
        logScheduleEvent('error', 'reconcile_cancel_failed', {
          reminderId: reminder.id,
          error: message,
        });
        return {
          reminderId: reminder.id,
          status: 'error',
          notificationIds: existing.notificationIds,
          hash: desiredHash,
          error: message,
        };
      }
    }

    if (existing) {
      await upsertScheduleState(db, {
        reminderId: reminder.id,
        notificationIds: [],
        lastScheduledHash: desiredHash,
        status: 'canceled',
        lastScheduledAt: now,
        lastError: null,
      });
    }

    return {
      reminderId: reminder.id,
      status: 'canceled',
      notificationIds: [],
      hash: desiredHash,
    };
  }

  const needsReschedule =
    !existing || existing.lastScheduledHash !== desiredHash || existing.status !== 'scheduled';

  if (!needsReschedule) {
    logScheduleEvent('info', 'reconcile_no_change', {
      reminderId: reminder.id,
      hash: desiredHash,
    });
    return {
      reminderId: reminder.id,
      status: 'unchanged',
      notificationIds: existing?.notificationIds ?? [],
      hash: desiredHash,
    };
  }

  if (existing?.notificationIds?.length) {
    try {
      await scheduler.cancel(existing.notificationIds);
      logScheduleEvent('info', 'reconcile_cancel_before_reschedule', {
        reminderId: reminder.id,
        notificationIds: existing.notificationIds,
      });
    } catch (error) {
      const message = stringifyError(error);
      await upsertScheduleState(db, {
        reminderId: reminder.id,
        notificationIds: existing.notificationIds,
        lastScheduledHash: desiredHash,
        status: 'error',
        lastScheduledAt: now,
        lastError: message,
      });
      logScheduleEvent('error', 'reconcile_cancel_failed', {
        reminderId: reminder.id,
        error: message,
      });
      return {
        reminderId: reminder.id,
        status: 'error',
        notificationIds: existing.notificationIds,
        hash: desiredHash,
        error: message,
      };
    }
  }

  try {
    const triggerAt = resolveTriggerAt(reminder);
    const notificationIds = await scheduler.schedule(reminder, triggerAt);

    await upsertScheduleState(db, {
      reminderId: reminder.id,
      notificationIds,
      lastScheduledHash: desiredHash,
      status: 'scheduled',
      lastScheduledAt: now,
      lastError: null,
    });

    logScheduleEvent('info', 'reconcile_schedule_success', {
      reminderId: reminder.id,
      triggerAt,
      notificationIds,
    });

    return {
      reminderId: reminder.id,
      status: 'scheduled',
      notificationIds,
      hash: desiredHash,
    };
  } catch (error) {
    const message = stringifyError(error);

    await upsertScheduleState(db, {
      reminderId: reminder.id,
      notificationIds: [],
      lastScheduledHash: desiredHash,
      status: 'error',
      lastScheduledAt: now,
      lastError: message,
    });

    logScheduleEvent('error', 'reconcile_schedule_failed', {
      reminderId: reminder.id,
      error: message,
    });

    return {
      reminderId: reminder.id,
      status: 'error',
      notificationIds: [],
      hash: desiredHash,
      error: message,
    };
  }
};

export const reconcileDeletedReminder = async (
  db: DbLike,
  reminderId: string,
  scheduler: ScheduleOperations,
  now: number = Date.now(),
): Promise<ReconcileResult> => {
  const existing = await getScheduleState(db, reminderId);
  const hash = existing?.lastScheduledHash ?? '';

  if (!existing) {
    logScheduleEvent('info', 'reconcile_delete_no_state', { reminderId });
    return {
      reminderId,
      status: 'canceled',
      notificationIds: [],
      hash,
    };
  }

  if (existing.notificationIds.length) {
    try {
      await scheduler.cancel(existing.notificationIds);
      logScheduleEvent('info', 'reconcile_delete_cancel_notifications', {
        reminderId,
        notificationIds: existing.notificationIds,
      });
    } catch (error) {
      const message = stringifyError(error);
      await upsertScheduleState(db, {
        reminderId,
        notificationIds: existing.notificationIds,
        lastScheduledHash: existing.lastScheduledHash,
        status: 'error',
        lastScheduledAt: now,
        lastError: message,
      });
      logScheduleEvent('error', 'reconcile_delete_cancel_failed', {
        reminderId,
        error: message,
      });
      return {
        reminderId,
        status: 'error',
        notificationIds: existing.notificationIds,
        hash,
        error: message,
      };
    }
  }

  try {
    await deleteScheduleState(db, reminderId);
  } catch (error) {
    const message = stringifyError(error);
    await upsertScheduleState(db, {
      reminderId,
      notificationIds: existing.notificationIds,
      lastScheduledHash: existing.lastScheduledHash,
      status: 'error',
      lastScheduledAt: now,
      lastError: message,
    });
    logScheduleEvent('error', 'reconcile_delete_cleanup_failed', {
      reminderId,
      error: message,
    });
    return {
      reminderId,
      status: 'error',
      notificationIds: existing.notificationIds,
      hash,
      error: message,
    };
  }

  logScheduleEvent('info', 'reconcile_delete_complete', { reminderId });
  return {
    reminderId,
    status: 'canceled',
    notificationIds: [],
    hash,
  };
};
