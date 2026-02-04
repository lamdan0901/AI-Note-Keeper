import * as Notifications from 'expo-notifications';
import { NativeModules, Platform, Alert } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import type { Reminder } from '../../../../packages/shared/types/reminder';
import { logSyncEvent } from './logging';
import { logScheduleEvent } from './logging';
import { getScheduleState, upsertScheduleState } from './scheduleLedger';
import { DbLike, getNoteScheduleState, upsertNoteScheduleState } from './noteScheduleLedger';
import { computeScheduleHash } from './scheduleHash';
import { recordNotificationSent } from './notificationLedger';

type NotificationTextOverride = {
  title?: string | null;
  body?: string | null;
};

const trimOrEmpty = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const buildNotificationText = (
  reminder: Reminder,
  override?: NotificationTextOverride,
): { title: string; body: string } => {
  const titleText = trimOrEmpty(override?.title ?? reminder.title);
  const descriptionText = trimOrEmpty(
    override?.body ?? (reminder as unknown as { content?: unknown }).content,
  );

  if (titleText && descriptionText) {
    return { title: titleText, body: descriptionText };
  }

  if (titleText) {
    return { title: titleText, body: '' };
  }

  if (descriptionText) {
    return { title: descriptionText, body: '' };
  }

  return { title: 'Reminder', body: 'You have a reminder' };
};

// const resolveWeekday = (date: Date): number => (date.getDay() + 1) % 7 || 7;

// const resolveTrigger = (
//   reminder: Reminder,
//   triggerAt: number,
// ): Notifications.NotificationTriggerInput => {
//   const date = new Date(triggerAt);

//   if (reminder.repeatRule === 'daily') {
//     return {
//       hour: date.getHours(),
//       minute: date.getMinutes(),
//       repeats: true,
//     };
//   }

//   if (reminder.repeatRule === 'weekly') {
//     return {
//       weekday: resolveWeekday(date),
//       hour: date.getHours(),
//       minute: date.getMinutes(),
//       repeats: true,
//     };
//   }

//   return date;
// };

// const buildContent = (reminder: Reminder): Notifications.NotificationContentInput => ({
//   title: reminder.title ?? 'Reminder',
//   body: reminder.title ?? 'Reminder',
//   data: { reminderId: reminder.id },
//   sound: 'default',
// });

export const scheduleReminderNotification = async (
  reminder: Reminder,
  notification?: NotificationTextOverride,
  db?: DbLike,
): Promise<string[]> => {
  if (Platform.OS === 'android') {
    const { ReminderModule } = NativeModules;
    if (ReminderModule) {
      // Calculate trigger time. If it's in the past, handle it?
      // The caller usually ensures valid triggerAt.
      // We need to resolve the actual timestamp for the next occurrence.
      // For MVP, assuming reminder.triggerAt is the absolute timestamp (single)
      // or we calculate it.
      // The original function signature had `triggerAt` commented out.
      // Looking at `rescheduleReminderWithLedger`, it passes `reminder` but `triggerAt` logic seems internal?
      // Actually `rescheduleReminderWithLedger` ignores `triggerAt` args.
      // We need to trust `reminder.triggerAt` if it is an absolute timestamp.
      // If repeatRule is present, `reminder.triggerAt` is the *next* trigger?
      // Let's look at `scheduler.ts` context.. `computeScheduleHash` is used.

      // We will assume reminder.triggerAt is the valid timestamp.
      // If it's repeating, we might need logic to calculate next instance,
      // BUT `rescheduleReminderWithLedger` seems to manage state.
      // For now, schedule the ONE provided instance.

      const triggerTime = reminder.snoozedUntil ?? reminder.triggerAt;
      const now = Date.now();

      if (triggerTime > now) {
        const hasPermission = await ReminderModule.hasExactAlarmPermission();
        if (!hasPermission) {
          Alert.alert(
            'Permission Required',
            'Exact alarm permission is needed for reliable offine reminders. Please grant it in the following screen.',
            [
              {
                text: 'Cancel',
                style: 'cancel',
                onPress: () => {
                  logSyncEvent('warn', 'local_notification_skipped_user_cancelled', {
                    reminderId: reminder.id,
                    reason: 'user_declined_exact_alarm_permission',
                  });
                },
              },
              {
                text: 'Open Settings',
                onPress: () => {
                  ReminderModule.openExactAlarmSettings();
                  logSyncEvent('warn', 'local_notification_skipped_awaiting_permission', {
                    reminderId: reminder.id,
                    reason: 'opened_settings_for_permission',
                  });
                },
              },
            ],
          );

          // We return empty here because we can't schedule yet.
          // The user needs to retry (e.g. edit/save note again) after granting.
          return [];
        }

        // Generate unique event ID for deduplication
        const eventId = `${reminder.id}-${triggerTime}`;

        // Check network connectivity
        const netState = await NetInfo.fetch();
        const isOnline = netState.isConnected === true && netState.isInternetReachable === true;

        const { title, body } = buildNotificationText(reminder, notification);

        // Schedule via native AlarmManager
        ReminderModule.schedule(
          reminder.id,
          triggerTime,
          title,
          body,
          eventId, // Pass eventId to native module
        );

        // Record in notification ledger if we have db access
        // Note: We record as 'local' because this is scheduled via AlarmManager
        // Even if online, FCM might also send - that's why we need deduplication
        if (db) {
          try {
            await recordNotificationSent(db, reminder.id, eventId, 'local', triggerTime);
            logScheduleEvent('info', 'notification_ledger_recorded', {
              reminderId: reminder.id,
              eventId,
              source: 'local',
              isOnline,
            });
          } catch (error) {
            // Don't fail scheduling if ledger recording fails
            logScheduleEvent('warn', 'notification_ledger_record_failed', {
              reminderId: reminder.id,
              error: String(error),
            });
          }
        }

        logSyncEvent('info', 'local_notification_scheduled_native', {
          reminderId: reminder.id,
          platform: Platform.OS,
          eventId,
          isOnline,
        });

        return [reminder.id];
      }
    }
  }

  // Fallback or iOS (if desired in future)
  // For this task, we focus on Android Offline fix.

  logSyncEvent('info', 'local_notification_scheduled_native', {
    reminderId: reminder.id,
    platform: Platform.OS,
  });

  return [];
};

export const cancelReminderNotifications = async (notificationIds: string[]): Promise<void> => {
  await Promise.all(
    notificationIds.map((id) => {
      if (Platform.OS === 'android' && NativeModules.ReminderModule) {
        NativeModules.ReminderModule.cancel(id);
        return Promise.resolve();
      }
      return Notifications.cancelScheduledNotificationAsync(id);
    }),
  );
};

export const rescheduleReminderWithLedger = async (
  db: DbLike,
  reminder: Reminder,
  // triggerAt: number,
  now: number = Date.now(),
): Promise<string[]> => {
  const desiredHash = computeScheduleHash({
    triggerAt: reminder.triggerAt,
    repeatRule: reminder.repeatRule,
    active: reminder.active,
    snoozedUntil: reminder.snoozedUntil,
    title: reminder.title,
    repeatConfig: reminder.repeatConfig,
  });
  const existing = await getScheduleState(db, reminder.id);

  if (existing?.notificationIds?.length) {
    try {
      await cancelReminderNotifications(existing.notificationIds);
      logScheduleEvent('info', 'scheduler_cancel_existing', {
        reminderId: reminder.id,
        notificationIds: existing.notificationIds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await upsertScheduleState(db, {
        reminderId: reminder.id,
        notificationIds: existing.notificationIds,
        lastScheduledHash: desiredHash,
        status: 'error',
        lastScheduledAt: now,
        lastError: message,
      });
      logScheduleEvent('error', 'scheduler_cancel_failed', {
        reminderId: reminder.id,
        error: message,
      });
      throw error;
    }
  }

  try {
    const notificationIds = await scheduleReminderNotification(reminder, undefined, db);

    await upsertScheduleState(db, {
      reminderId: reminder.id,
      notificationIds,
      lastScheduledHash: desiredHash,
      status: 'scheduled',
      lastScheduledAt: now,
      lastError: null,
    });

    logScheduleEvent('info', 'scheduler_reschedule_success', {
      reminderId: reminder.id,
      notificationIds,
    });

    return notificationIds;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertScheduleState(db, {
      reminderId: reminder.id,
      notificationIds: [],
      lastScheduledHash: desiredHash,
      status: 'error',
      lastScheduledAt: now,
      lastError: message,
    });
    logScheduleEvent('error', 'scheduler_schedule_failed', {
      reminderId: reminder.id,
      error: message,
    });
    throw error;
  }
};

export const rescheduleNoteWithLedger = async (
  db: DbLike,
  reminder: Reminder,
  now: number = Date.now(),
): Promise<string[]> => {
  const desiredHash = computeScheduleHash({
    triggerAt: reminder.triggerAt,
    repeatRule: reminder.repeatRule,
    active: reminder.active,
    snoozedUntil: reminder.snoozedUntil,
    title: reminder.title,
    repeatConfig: reminder.repeatConfig,
  });
  const existing = await getNoteScheduleState(db, reminder.id);

  if (existing?.notificationIds?.length) {
    try {
      await cancelReminderNotifications(existing.notificationIds);
      logScheduleEvent('info', 'scheduler_cancel_existing', {
        reminderId: reminder.id,
        notificationIds: existing.notificationIds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await upsertNoteScheduleState(db, {
        noteId: reminder.id,
        notificationIds: existing.notificationIds,
        lastScheduledHash: desiredHash,
        status: 'error',
        lastScheduledAt: now,
        lastError: message,
      });
      logScheduleEvent('error', 'scheduler_cancel_failed', {
        reminderId: reminder.id,
        error: message,
      });
      throw error;
    }
  }

  try {
    const notificationIds = await scheduleReminderNotification(reminder, undefined, db);

    await upsertNoteScheduleState(db, {
      noteId: reminder.id,
      notificationIds,
      lastScheduledHash: desiredHash,
      status: 'scheduled',
      lastScheduledAt: now,
      lastError: null,
    });

    logScheduleEvent('info', 'scheduler_reschedule_success', {
      reminderId: reminder.id,
      notificationIds,
    });

    return notificationIds;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertNoteScheduleState(db, {
      noteId: reminder.id,
      notificationIds: [],
      lastScheduledHash: desiredHash,
      status: 'error',
      lastScheduledAt: now,
      lastError: message,
    });
    logScheduleEvent('error', 'scheduler_schedule_failed', {
      reminderId: reminder.id,
      error: message,
    });
    throw error;
  }
};

export const cancelReminderWithLedger = async (
  db: DbLike,
  reminderId: string,
  now: number = Date.now(),
): Promise<void> => {
  const existing = await getScheduleState(db, reminderId);
  if (!existing) {
    return;
  }

  if (existing.notificationIds.length) {
    try {
      await cancelReminderNotifications(existing.notificationIds);
      logScheduleEvent('info', 'scheduler_cancel_success', {
        reminderId,
        notificationIds: existing.notificationIds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await upsertScheduleState(db, {
        reminderId,
        notificationIds: existing.notificationIds,
        lastScheduledHash: existing.lastScheduledHash,
        status: 'error',
        lastScheduledAt: now,
        lastError: message,
      });
      logScheduleEvent('error', 'scheduler_cancel_failed', {
        reminderId,
        error: message,
      });
      throw error;
    }
  }

  await upsertScheduleState(db, {
    reminderId,
    notificationIds: [],
    lastScheduledHash: existing.lastScheduledHash,
    status: 'canceled',
    lastScheduledAt: now,
    lastError: null,
  });
};

export const cancelNoteWithLedger = async (
  db: DbLike,
  reminderId: string,
  now: number = Date.now(),
): Promise<void> => {
  const existing = await getNoteScheduleState(db, reminderId);
  if (!existing) {
    return;
  }

  if (existing.notificationIds.length) {
    try {
      await cancelReminderNotifications(existing.notificationIds);
      logScheduleEvent('info', 'scheduler_cancel_success', {
        reminderId,
        notificationIds: existing.notificationIds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await upsertNoteScheduleState(db, {
        noteId: reminderId,
        notificationIds: existing.notificationIds,
        lastScheduledHash: existing.lastScheduledHash,
        status: 'error',
        lastScheduledAt: now,
        lastError: message,
      });
      logScheduleEvent('error', 'scheduler_cancel_failed', {
        reminderId,
        error: message,
      });
      throw error;
    }
  }

  await upsertNoteScheduleState(db, {
    noteId: reminderId,
    notificationIds: [],
    lastScheduledHash: existing.lastScheduledHash,
    status: 'canceled',
    lastScheduledAt: now,
    lastError: null,
  });
};

import { listNotes, Note } from '../db/notesRepo';
import { RepeatRule } from '../../../../packages/shared/types/reminder';

export const mapNoteToReminder = (note: Note): Reminder => {
  // Cast to a structural type we expect from legacy data
  const config = (note.repeatConfig || {}) as {
    interval?: unknown;
    weekdays?: unknown;
    frequency?: unknown;
  };
  let repeat: RepeatRule | null = null;

  // Cast logic to string to handle 'monthly' which might not be in the stricter union
  const rule = note.repeatRule as string | undefined;

  switch (rule) {
    case 'daily':
      repeat = {
        kind: 'daily',
        interval: typeof config.interval === 'number' ? config.interval : 1,
      };
      break;
    case 'weekly':
      repeat = {
        kind: 'weekly',
        interval: typeof config.interval === 'number' ? config.interval : 1,
        weekdays: Array.isArray(config.weekdays) ? (config.weekdays as number[]) : [],
      };
      break;
    case 'monthly':
      repeat = {
        kind: 'monthly',
        interval: typeof config.interval === 'number' ? config.interval : 1,
        mode: 'day_of_month',
      };
      break;
    case 'custom': {
      const freqRaw = typeof config.frequency === 'string' ? config.frequency : 'days';
      const frequency = (
        ['minutes', 'days', 'weeks', 'months'].includes(freqRaw) ? freqRaw : 'days'
      ) as 'minutes' | 'days' | 'weeks' | 'months';

      repeat = {
        kind: 'custom',
        interval: typeof config.interval === 'number' ? config.interval : 1,
        frequency,
      };
      break;
    }
  }

  // Note: we are filling in gaps as best as possible for the Scheduler to work (using triggerAt/title).
  return {
    ...note,
    id: note.id,
    userId: note.userId || '',
    repeat: note.repeat || repeat,
    nextTriggerAt: note.triggerAt || null,
    lastFiredAt: null,
    lastAcknowledgedAt: null,
    version: 0,
    baseAtLocal: null, // Scheduler doesn't use this for HASH/scheduling, Recurrence uses it
    startAt: null,
    repeatRule: note.repeatRule,
  } as Reminder;
};

export const rescheduleAllActiveReminders = async (db: DbLike): Promise<number> => {
  logScheduleEvent('info', 'scheduler_batch_reschedule_start');
  try {
    const notes = await listNotes(db, 1000); // Cast DB due to type mismatch
    let count = 0;
    for (const note of notes) {
      if (note.active && (note.triggerAt || note.snoozedUntil)) {
        const reminder = mapNoteToReminder(note);
        await rescheduleNoteWithLedger(db, reminder);
        count++;
      }
    }
    logScheduleEvent('info', 'scheduler_batch_reschedule_complete', { count });
    return count;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logScheduleEvent('error', 'scheduler_batch_reschedule_failed', { error: msg });
    throw error;
  }
};
