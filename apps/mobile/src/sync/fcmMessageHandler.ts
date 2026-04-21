import * as Notifications from 'expo-notifications';
import { NativeModules, Platform } from 'react-native';
import { logSyncEvent } from '../reminders/logging';
import { getDb } from '../db/bootstrap';
import { upsertNote, deleteNote, getNoteById } from '../db/notesRepo';
import { fetchReminder } from './fetchReminder';
import { Note } from '../db/notesRepo';
import { buildNotificationText } from '../reminders/scheduler';
import type { Reminder } from '../../../../packages/shared/types/reminder';
import {
  hasNotificationSentWithin,
  recordNotificationSent,
  cleanOldRecords,
} from '../reminders/notificationLedger';

// Ledger dedup window for trigger FCM messages.
// Entries older than this are treated as stale so FCM can still display
// when the local alarm poisoned the ledger but failed to actually show
// a notification (e.g. MIUI/HyperOS silent suppression).
const TRIGGER_DEDUP_WINDOW_MS = 30_000;

// Legacy backend placeholder. When the FCM data payload contains this exact
// text we ignore it and render the notification from the local note instead,
// so older push senders can't override a freshly-synced note's real content.
const LEGACY_PLACEHOLDER_TITLE = 'Reminder';
const LEGACY_PLACEHOLDER_BODY = 'You have a reminder';

const isLegacyPlaceholder = (title: string, body: string): boolean => {
  return title === LEGACY_PLACEHOLDER_TITLE && body === LEGACY_PLACEHOLDER_BODY;
};

const resolveNotificationTextFromNote = async (
  reminderId: string,
  fallbackTitle: string,
  fallbackBody: string,
): Promise<{ title: string; body: string }> => {
  try {
    const db = await getDb();
    const note = await getNoteById(db, reminderId);
    if (note) {
      const text = buildNotificationText(note as unknown as Reminder);
      // buildNotificationText returns the same "Reminder"/"You have a reminder"
      // sentinel only when the note is truly empty; in that case the FCM
      // payload's title/body is no worse, so return whichever is non-empty.
      if (text.title && text.title !== LEGACY_PLACEHOLDER_TITLE) {
        return text;
      }
      if (text.body && text.body !== LEGACY_PLACEHOLDER_BODY) {
        return text;
      }
    }
  } catch (error) {
    logSyncEvent('warn', 'fcm_local_note_lookup_failed', {
      reminderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { title: fallbackTitle, body: fallbackBody };
};

export type FcmRemoteMessage = {
  messageId?: string;
  data?: {
    type?: string;
    id?: string;
    noteId?: string;
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

/**
 * Show a notification using the native NotificationHelper (same look as
 * offline local-alarm notifications: app icon + action buttons).
 * Falls back to Expo Notifications if the native module is unavailable.
 */
const showImmediateNotification = async (
  reminderId: string,
  title: string,
  body: string,
  eventId?: string,
): Promise<void> => {
  if (Platform.OS === 'android') {
    const { ReminderModule } = NativeModules;
    if (ReminderModule?.showNow) {
      ReminderModule.showNow(reminderId, title, body, eventId ?? '');
      logSyncEvent('info', 'fcm_native_notification_displayed', { reminderId });
      return;
    }
  }

  // Fallback (iOS or missing native module)
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { reminderId, eventId },
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    trigger: null,
  });
  logSyncEvent('info', 'fcm_immediate_notification_displayed', { reminderId });
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
    const reminderId =
      remoteMessage.data?.reminderId ?? remoteMessage.data?.noteId ?? remoteMessage.data?.id;
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
        await upsertNote(db, reminder as unknown as Note);

        // 2. Do NOT reschedule a local AlarmManager alarm here.
        //    If we're receiving an FCM message, the device is online
        //    and the server cron + FCM push path handles delivery.
        //    Local alarms are only armed when the device is offline.

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

  // For data-only messages (our default), Android does NOT auto-display
  // anything.  We always need to show the notification ourselves via
  // the handler — whether foreground, background, or killed.
  // (The background/killed path is handled by setBackgroundMessageHandler
  //  and the headless task, both of which call this same function.)

  const reminderId =
    remoteMessage.data?.reminderId ?? remoteMessage.data?.noteId ?? remoteMessage.data?.id;
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

  let title = titleText || bodyText || 'Reminder';
  let body =
    titleText && bodyText ? bodyText : titleText || bodyText ? '' : 'You have a reminder';

  // Defensive fallback: if the server sent the legacy placeholder, look up the
  // note locally and render real text. Covers older backend builds and any
  // future case where the push payload is missing the note fields.
  if (isLegacyPlaceholder(title, body) || (!titleText && !bodyText)) {
    const resolved = await resolveNotificationTextFromNote(reminderId, title, body);
    title = resolved.title;
    body = resolved.body;
  }

  if (remoteMessage.data?.type === 'trigger_reminder') {
    // Deduplicate using the notification ledger.
    // The local alarm (if it fired first) will have already recorded
    // an entry with the same eventId – in that case we skip.
    const eventId = remoteMessage.data?.eventId;
    if (eventId) {
      try {
        const db = await getDb();
        const alreadySent = await hasNotificationSentWithin(
          db,
          reminderId,
          eventId,
          TRIGGER_DEDUP_WINDOW_MS,
        );

        if (alreadySent) {
          logSyncEvent('info', 'fcm_trigger_suppressed_duplicate', {
            reminderId,
            eventId,
            reason: 'local_notification_already_sent',
            windowMs: TRIGGER_DEDUP_WINDOW_MS,
          });
          return;
        }

        // Opportunistic cleanup of old ledger entries (>7 days)
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

    // Show notification immediately (foreground path)
    try {
      await showImmediateNotification(reminderId, title, body, eventId);

      // Record delivery in the ledger so the local alarm (if it fires
      // later) knows not to duplicate.
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
    } catch (error) {
      logSyncEvent('error', 'fcm_trigger_notification_failed', {
        reminderId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to generic notification below
    }
  }

  // Fallback: show generic notification for any remaining message type
  try {
    await showImmediateNotification(reminderId, title, body, remoteMessage.data?.eventId);

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
