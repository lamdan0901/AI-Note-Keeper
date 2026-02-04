import * as Notifications from 'expo-notifications';
import { AppState, NativeModules, Platform } from 'react-native';
import { logSyncEvent } from '../reminders/logging';
import { getDb } from '../db/bootstrap';
import { upsertNote, deleteNote, getNoteById } from '../db/notesRepo';
import { fetchReminder } from './fetchReminder';
import {
  rescheduleNoteWithLedger,
  cancelNoteWithLedger,
  mapNoteToReminder,
} from '../reminders/scheduler';
import { Note } from '../db/notesRepo';
import {
  hasLocalNotificationSent,
  recordNotificationSent,
  cleanOldRecords,
} from '../reminders/notificationLedger';

export type FcmRemoteMessage = {
  messageId?: string;
  data?: {
    type?: string;
    id?: string;
    reminderId?: string;
    eventId?: string;
    title?: string;
    body?: string;
    [key: string]: unknown;
  };
  notification?: {
    title?: string;
    body?: string;
  };
};

const scheduleNativeNotification = async (
  reminderId: string,
  title: string,
  body: string,
  eventId?: string,
): Promise<boolean> => {
  if (Platform.OS !== 'android') {
    return false;
  }

  const { ReminderModule } = NativeModules;
  if (!ReminderModule?.schedule) {
    return false;
  }

  try {
    // Generate eventId if not provided (for FCM-triggered notifications)
    const finalEventId = eventId || `fcm-${Date.now()}`;
    ReminderModule.schedule(reminderId, Date.now() + 250, title, body, finalEventId);
    logSyncEvent('info', 'fcm_native_notification_displayed', { reminderId });
    return true;
  } catch (error) {
    logSyncEvent('error', 'fcm_native_notification_failed', {
      reminderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

const shouldSuppressTriggerNotification = async (reminderId: string): Promise<boolean> => {
  if (Platform.OS !== 'android') {
    return false;
  }

  try {
    const db = await getDb();
    const note = await getNoteById(db, reminderId);
    if (!note?.triggerAt) {
      return false;
    }

    const diff = Math.abs(Date.now() - note.triggerAt);
    return diff <= 60_000;
  } catch (error) {
    logSyncEvent('warn', 'fcm_trigger_suppress_check_failed', {
      reminderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

/**
 * Handle incoming FCM message.
 *
 * NOTE: When FCM includes a `notification` payload, Android automatically displays
 * it when the app is in background or killed. We only need to display a local
 * notification when in foreground AND no notification payload exists.
 */
export const handleFcmMessage = async (remoteMessage: FcmRemoteMessage): Promise<void> => {
  logSyncEvent('info', 'fcm_message_received', {
    messageId: remoteMessage.messageId,
    type: remoteMessage.data?.type,
    hasNotification: !!remoteMessage.notification,
  });

  // Handle Sync Events (Data-Only)
  if (remoteMessage.data?.type === 'sync_reminder') {
    const reminderId = remoteMessage.data?.reminderId ?? remoteMessage.data?.id;
    if (!reminderId) {
      logSyncEvent('warn', 'fcm_sync_missing_id', { messageId: remoteMessage.messageId });
      return;
    }

    try {
      const db = await getDb();
      const result = await fetchReminder(reminderId);

      if (result.status === 'ok') {
        // Reminder exists (create or update)
        const reminder = result.reminder;

        // 1. Update Local DB (Mirror Server)
        // We cast Reminder -> Note safely because they are compatible structs for storage
        // The fetchReminder returns shared Reminder type, but we store as Note in SQLite.
        // We can just spread it.
        await upsertNote(db, reminder as unknown as Note);

        // 2. Reschedule Alarm
        // We map it to the "Reminder" type expected by scheduler (though it's nearly identical)
        // mapNoteToReminder handles the specific `repeat` field logic if needed.
        const schedulerReminder = mapNoteToReminder(reminder as unknown as Note);
        await rescheduleNoteWithLedger(db, schedulerReminder);

        logSyncEvent('info', 'fcm_sync_processed_update', { reminderId });
      } else if (result.status === 'not_found') {
        // Reminder deleted on server

        // 1. Remove from Local DB
        // We use deleteNote which does physically delete it? Or soft delete?
        // `deleteNote` in repo deletes row. `deleteNoteOffline` does soft.
        // Sync usually mirrors state. If server says "it's gone", we should probably delete it or mark active=false.
        // If `fetchReminder` returns null, it's GONE from server DB (or at least filtered out).
        // Let's soft delete to be safe or hard delete?
        // NoteRepo `deleteNote` does `DELETE FROM notes`. That's fine for "sync".
        await deleteNote(db, reminderId);

        // 2. Cancel Alarm
        await cancelNoteWithLedger(db, reminderId);

        logSyncEvent('info', 'fcm_sync_processed_delete', { reminderId });
      } else {
        throw new Error(`Fetch failed: ${result.error}`);
      }
    } catch (error) {
      logSyncEvent('error', 'fcm_sync_failed', {
        reminderId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (remoteMessage.notification && AppState.currentState !== 'active') {
    logSyncEvent('info', 'fcm_notification_handled_by_android', {
      reminderId: remoteMessage.data?.reminderId ?? remoteMessage.data?.id,
    });
    return;
  }

  const reminderId = remoteMessage.data?.reminderId ?? remoteMessage.data?.id;
  if (!reminderId) {
    logSyncEvent('info', 'fcm_message_no_data', {
      messageId: remoteMessage.messageId,
    });
    return;
  }

  const rawTitle = remoteMessage.notification?.title ?? remoteMessage.data?.title ?? '';
  const rawBody = remoteMessage.notification?.body ?? remoteMessage.data?.body ?? '';

  const titleText = rawTitle.trim();
  const bodyText = rawBody.trim();

  const title = titleText || bodyText || 'Reminder';
  const body =
    titleText && bodyText ? bodyText : titleText || bodyText ? '' : 'You have a reminder';

  if (remoteMessage.data?.type === 'trigger_reminder') {
    const suppress = await shouldSuppressTriggerNotification(reminderId);
    if (suppress) {
      logSyncEvent('info', 'fcm_trigger_suppressed_local_alarm', { reminderId });
      return;
    }

    // Phase 3: Check notification ledger for duplicate prevention
    const eventId = remoteMessage.data?.eventId;
    if (eventId) {
      try {
        const db = await getDb();
        const alreadySent = await hasLocalNotificationSent(db, reminderId, eventId);

        if (alreadySent) {
          logSyncEvent('info', 'fcm_trigger_suppressed_duplicate', {
            reminderId,
            eventId,
            reason: 'local_notification_already_sent',
          });
          return;
        }

        // Periodically clean old ledger entries (>7 days) - do this opportunistically
        // We do this in the background, don't await
        cleanOldRecords(db, 7).catch((err) => {
          logSyncEvent('warn', 'fcm_ledger_cleanup_failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      } catch (error) {
        logSyncEvent('warn', 'fcm_ledger_check_failed', {
          reminderId,
          eventId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with notification even if ledger check fails
      }
    }

    const handled = await scheduleNativeNotification(reminderId, title, body, eventId);
    if (handled) {
      // Record FCM delivery in ledger
      if (eventId) {
        try {
          const db = await getDb();
          await recordNotificationSent(db, reminderId, eventId, 'fcm');
          logSyncEvent('info', 'fcm_delivery_recorded', { reminderId, eventId });
        } catch (error) {
          logSyncEvent('warn', 'fcm_ledger_record_failed', {
            reminderId,
            eventId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return;
    }
  }

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { reminderId, eventId: remoteMessage.data?.eventId },
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: null,
    });

    logSyncEvent('info', 'fcm_local_notification_displayed', { reminderId });

    // Record FCM delivery in ledger
    const eventId = remoteMessage.data?.eventId;
    if (eventId) {
      try {
        const db = await getDb();
        await recordNotificationSent(db, reminderId, eventId, 'fcm');
        logSyncEvent('info', 'fcm_delivery_recorded', { reminderId, eventId });
      } catch (error) {
        logSyncEvent('warn', 'fcm_ledger_record_failed', {
          reminderId,
          eventId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logSyncEvent('error', 'fcm_notification_failed', {
      reminderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Handle notification tap/interaction.
 * Called when user taps on a notification.
 */
export const handleNotificationResponse = (response: Notifications.NotificationResponse): void => {
  const data = response.notification.request.content.data;
  logSyncEvent('info', 'notification_tapped', {
    reminderId: data?.reminderId,
  });
  // Future: Navigate to the reminder/note
};
