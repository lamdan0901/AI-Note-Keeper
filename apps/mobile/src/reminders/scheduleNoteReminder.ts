import type { Note } from '../db/notesRepo';
import type { Reminder } from '../../../../packages/shared/types/reminder';
import { scheduleReminderNotification, cancelReminderNotifications } from './scheduler';
import { DbLike, getNoteScheduleState, upsertNoteScheduleState } from './noteScheduleLedger';
import { computeScheduleHash } from './scheduleHash';
import { logScheduleEvent } from './logging';

/**
 * Convert a Note with reminder fields to a Reminder-like object for scheduling.
 */
const noteToReminder = (note: Note): Reminder => ({
  id: note.id,
  userId: note.userId ?? 'local-user',
  title: note.title ?? null,
  triggerAt: note.triggerAt!,
  repeatRule: note.repeatRule ?? 'none',
  repeatConfig: note.repeatConfig ?? null,
  repeat: note.repeat ?? null,
  snoozedUntil: note.snoozedUntil ?? null,
  active: note.active,
  scheduleStatus: note.scheduleStatus ?? 'unscheduled',
  timezone: note.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
  baseAtLocal: note.baseAtLocal ?? null,
  startAt: note.startAt ?? null,
  nextTriggerAt: note.nextTriggerAt ?? null,
  lastFiredAt: note.lastFiredAt ?? null,
  lastAcknowledgedAt: note.lastAcknowledgedAt ?? null,
  version: note.version ?? 0,
  updatedAt: note.updatedAt,
  createdAt: note.createdAt,
});

/**
 * Schedule a local notification for a note's reminder.
 * Cancels any existing notification for this note before scheduling.
 *
 * @param db - SQLite database instance
 * @param note - The note containing reminder fields
 * @returns The scheduled notification IDs, or empty array if no reminder
 */
export const scheduleNoteReminderNotification = async (
  db: DbLike,
  note: Note,
): Promise<string[]> => {
  const now = Date.now();

  // If note has no reminder or triggerAt is in the past, cancel any existing
  if (!note.triggerAt || note.triggerAt <= now) {
    const existing = await getNoteScheduleState(db, note.id);
    if (existing?.notificationIds?.length) {
      try {
        await cancelReminderNotifications(existing.notificationIds);
        logScheduleEvent('info', 'note_reminder_canceled', {
          noteId: note.id,
          reason: note.triggerAt ? 'past_time' : 'no_trigger',
        });
      } catch (e) {
        logScheduleEvent('error', 'note_reminder_cancel_failed', {
          noteId: note.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      await upsertNoteScheduleState(db, {
        noteId: note.id,
        notificationIds: [],
        lastScheduledHash: '',
        status: 'canceled',
        lastScheduledAt: now,
        lastError: null,
      });
    }
    return [];
  }

  // Note has a valid future reminder, schedule it
  const reminder = noteToReminder(note);
  const triggerAt = reminder.snoozedUntil ?? reminder.triggerAt;

  const desiredHash = computeScheduleHash({
    triggerAt: reminder.triggerAt,
    repeatRule: reminder.repeatRule,
    active: reminder.active,
    snoozedUntil: reminder.snoozedUntil,
    title: reminder.title,
    repeatConfig: reminder.repeatConfig,
  });

  // Cancel existing notifications first
  const existing = await getNoteScheduleState(db, note.id);
  if (existing?.notificationIds?.length) {
    try {
      await cancelReminderNotifications(existing.notificationIds);
      logScheduleEvent('info', 'note_reminder_cancel_before_schedule', {
        noteId: note.id,
        notificationIds: existing.notificationIds,
      });
    } catch (e) {
      logScheduleEvent('error', 'note_reminder_cancel_failed', {
        noteId: note.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  try {
    const noteTitle = (note.title ?? '').trim();
    const noteDescription = (note.content ?? '').trim();

    const notificationTitle =
      noteTitle.length > 0 ? noteTitle : noteDescription.length > 0 ? noteDescription : 'Reminder';
    const notificationBody =
      noteTitle.length > 0 && noteDescription.length > 0 ? noteDescription : '';

    const notificationIds = await scheduleReminderNotification(
      reminder,
      {
        title: notificationTitle,
        body: notificationBody,
      },
      db,
    );

    await upsertNoteScheduleState(db, {
      noteId: note.id,
      notificationIds,
      lastScheduledHash: desiredHash,
      status: 'scheduled',
      lastScheduledAt: now,
      lastError: null,
    });

    logScheduleEvent('info', 'note_reminder_scheduled', {
      noteId: note.id,
      triggerAt,
      notificationIds,
    });

    return notificationIds;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await upsertNoteScheduleState(db, {
      noteId: note.id,
      notificationIds: [],
      lastScheduledHash: desiredHash,
      status: 'error',
      lastScheduledAt: now,
      lastError: message,
    });

    logScheduleEvent('error', 'note_reminder_schedule_failed', {
      noteId: note.id,
      error: message,
    });

    throw error;
  }
};

/**
 * Cancel any scheduled notification for a note.
 *
 * @param db - SQLite database instance
 * @param noteId - The note ID to cancel notifications for
 */
export const cancelNoteReminderNotification = async (db: DbLike, noteId: string): Promise<void> => {
  const existing = await getNoteScheduleState(db, noteId);
  if (!existing?.notificationIds?.length) {
    return;
  }

  try {
    await cancelReminderNotifications(existing.notificationIds);
    logScheduleEvent('info', 'note_reminder_canceled', {
      noteId,
      notificationIds: existing.notificationIds,
    });
  } catch (e) {
    logScheduleEvent('error', 'note_reminder_cancel_failed', {
      noteId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  await upsertNoteScheduleState(db, {
    noteId,
    notificationIds: [],
    lastScheduledHash: existing.lastScheduledHash,
    status: 'canceled',
    lastScheduledAt: Date.now(),
    lastError: null,
  });
};
