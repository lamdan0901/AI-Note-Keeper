/**
 * Ledger for tracking note reminder notification state.
 * Uses note_schedule_meta table (no FK to reminders table).
 */

import { SQLiteDatabase } from 'expo-sqlite/next';

export type ScheduleLedgerStatus = 'scheduled' | 'canceled' | 'error';

export type NoteScheduleState = {
  noteId: string;
  notificationIds: string[];
  lastScheduledHash: string;
  status: ScheduleLedgerStatus;
  lastScheduledAt: number;
  lastError?: string | null;
};

type DbResultRow = {
  noteId: string;
  notificationIdsJson: string;
  lastScheduledHash: string;
  status: ScheduleLedgerStatus;
  lastScheduledAt: number;
  lastError: string | null;
};

export type DbLike = SQLiteDatabase;
const serializeNotificationIds = (ids: string[]): string => JSON.stringify(ids ?? []);

const parseNotificationIds = (json: string): string[] => {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const mapRow = (row: DbResultRow): NoteScheduleState => ({
  noteId: row.noteId,
  notificationIds: parseNotificationIds(row.notificationIdsJson),
  lastScheduledHash: row.lastScheduledHash,
  status: row.status,
  lastScheduledAt: row.lastScheduledAt,
  lastError: row.lastError,
});

export const getNoteScheduleState = async (
  db: DbLike,
  noteId: string,
): Promise<NoteScheduleState | null> => {
  const row = await db.getFirstAsync<DbResultRow>(
    `SELECT noteId, notificationIdsJson, lastScheduledHash, status, lastScheduledAt, lastError
     FROM note_schedule_meta
     WHERE noteId = ?`,
    [noteId],
  );
  return row ? mapRow(row) : null;
};

export const upsertNoteScheduleState = async (
  db: DbLike,
  state: NoteScheduleState,
): Promise<void> => {
  await db.runAsync(
    `INSERT INTO note_schedule_meta (
        noteId,
        notificationIdsJson,
        lastScheduledHash,
        status,
        lastScheduledAt,
        lastError
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(noteId) DO UPDATE SET
        notificationIdsJson = excluded.notificationIdsJson,
        lastScheduledHash = excluded.lastScheduledHash,
        status = excluded.status,
        lastScheduledAt = excluded.lastScheduledAt,
        lastError = excluded.lastError`,
    [
      state.noteId,
      serializeNotificationIds(state.notificationIds),
      state.lastScheduledHash,
      state.status,
      state.lastScheduledAt,
      state.lastError ?? null,
    ],
  );
};

export const deleteNoteScheduleState = async (db: DbLike, noteId: string): Promise<void> => {
  await db.runAsync('DELETE FROM note_schedule_meta WHERE noteId = ?', [noteId]);
};
