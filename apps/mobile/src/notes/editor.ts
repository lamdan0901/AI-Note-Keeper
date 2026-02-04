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
  const deletedNote = { ...note, active: false, updatedAt: now };

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
