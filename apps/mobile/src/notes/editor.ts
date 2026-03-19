import { SQLiteDatabase } from 'expo-sqlite/next';
import { Note, upsertNote } from '../db/notesRepo';
import { enqueueNoteOperation } from '../sync/noteOutbox';
import { nowMs } from '../../../../packages/shared/utils/time';
import {
  scheduleNoteReminderNotification,
  cancelNoteReminderNotification,
} from '../reminders/scheduleNoteReminder';

export const saveNoteOffline = async (
  db: SQLiteDatabase,
  note: Note,
  operation: 'create' | 'update',
  userId: string = 'local-user', // Default until we have auth
): Promise<void> => {
  const now = nowMs();
  const updatedNote = { ...note, updatedAt: now };

  // 1. Write to local DB
  await upsertNote(db, updatedNote);

  // 2. Enqueue to Outbox
  await enqueueNoteOperation(db, updatedNote, operation, userId, now);

  // 3. Schedule notification if note has reminder
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await scheduleNoteReminderNotification(db as any, updatedNote);
  } catch (e) {
    // Log but don't fail the save - notification is non-critical
    console.warn('[editor] Failed to schedule notification:', e);
  }
};

export const deleteNoteOffline = async (
  db: SQLiteDatabase,
  note: Note,
  userId: string = 'local-user',
): Promise<void> => {
  const now = nowMs();
  const deletedNote = { ...note, active: false, deletedAt: now, updatedAt: now };

  // 1. Write to local DB (Soft Delete)
  await upsertNote(db, deletedNote);

  // 2. Enqueue to Outbox
  await enqueueNoteOperation(db, deletedNote, 'delete', userId, now);

  // 3. Cancel any scheduled notification
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await cancelNoteReminderNotification(db as any, note.id);
  } catch (e) {
    // Log but don't fail the delete - notification is non-critical
    console.warn('[editor] Failed to cancel notification:', e);
  }
};

export const restoreNoteOffline = async (
  db: SQLiteDatabase,
  note: Note,
  userId: string = 'local-user',
): Promise<void> => {
  const now = nowMs();
  const restoredNote: Note = {
    ...note,
    active: true,
    deletedAt: undefined,
    // Clear all reminder/recurrence fields (stale reminders shouldn't fire)
    triggerAt: undefined,
    repeatRule: undefined,
    repeatConfig: undefined,
    snoozedUntil: undefined,
    scheduleStatus: undefined,
    timezone: undefined,
    repeat: undefined,
    baseAtLocal: undefined,
    startAt: undefined,
    nextTriggerAt: undefined,
    lastFiredAt: undefined,
    lastAcknowledgedAt: undefined,
    updatedAt: now,
  };

  // 1. Write to local DB
  await upsertNote(db, restoredNote);

  // 2. Enqueue to Outbox as update
  await enqueueNoteOperation(db, restoredNote, 'update', userId, now);
};
