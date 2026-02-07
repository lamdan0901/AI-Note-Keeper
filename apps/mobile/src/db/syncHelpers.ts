import { SQLiteDatabase } from 'expo-sqlite/next';
import { Note, NoteRow, mapNoteRow } from '../db/notesRepo';

export type SyncStatus = 'synced' | 'pending' | 'conflict';

/**
 * Get all notes with pending sync status
 */
export const getNotesWithPendingSync = async (db: SQLiteDatabase): Promise<Note[]> => {
  const rows = await db.getAllAsync<NoteRow>(
    `SELECT * FROM notes WHERE syncStatus = 'pending' AND active = 1 ORDER BY updatedAt ASC`,
  );
  return rows.map(mapNoteRow);
};

/**
 * Update sync status for a note
 */
export const updateNoteSyncStatus = async (
  db: SQLiteDatabase,
  noteId: string,
  syncStatus: SyncStatus,
  serverVersion?: number,
): Promise<void> => {
  if (serverVersion !== undefined) {
    await db.runAsync(`UPDATE notes SET syncStatus = ?, serverVersion = ? WHERE id = ?`, [
      syncStatus,
      serverVersion,
      noteId,
    ]);
  } else {
    await db.runAsync(`UPDATE notes SET syncStatus = ? WHERE id = ?`, [syncStatus, noteId]);
  }
};

/**
 * Mark note as pending sync
 */
export const markNotePending = async (db: SQLiteDatabase, noteId: string): Promise<void> => {
  await updateNoteSyncStatus(db, noteId, 'pending');
};

/**
 * Mark note as synced
 */
export const markNoteSynced = async (
  db: SQLiteDatabase,
  noteId: string,
  serverVersion: number,
): Promise<void> => {
  await updateNoteSyncStatus(db, noteId, 'synced', serverVersion);
};

/**
 * Mark note as conflicted
 */
export const markNoteConflict = async (db: SQLiteDatabase, noteId: string): Promise<void> => {
  await updateNoteSyncStatus(db, noteId, 'conflict');
};
