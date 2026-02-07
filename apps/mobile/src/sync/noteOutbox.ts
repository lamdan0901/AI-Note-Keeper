import { SQLiteDatabase } from 'expo-sqlite/next';
import { nowMs } from '../../../../packages/shared/utils/time';
import { calculatePayloadHash } from '../../../../packages/shared/utils/hash';
import { Note } from '../db/notesRepo';
import { getRetryDelayMs, shouldRetry } from './retryPolicy';

export type NoteOperation = 'create' | 'update' | 'delete';

type OutboxEntry = {
  noteId: string;
  userId: string;
  operation: NoteOperation;
  payloadJson: string;
  payloadHash: string;
  updatedAt: number;
  createdAt: number;
  attempts: number;
  lastAttemptAt: number | null;
  retryCount: number;
  nextRetryAt: number | null;
};

const serializePayload = (note: Note): string => JSON.stringify(note);

export const enqueueNoteOperation = async (
  db: SQLiteDatabase,
  note: Note,
  operation: NoteOperation,
  userId: string,
  now: number = nowMs(),
): Promise<void> => {
  // @ts-expect-error: will fix later
  const payloadHash = calculatePayloadHash(note);

  await db.runAsync(
    `INSERT INTO note_outbox (
        noteId,
        userId,
        operation,
        payloadJson,
        payloadHash,
        updatedAt,
        createdAt,
        attempts,
        lastAttemptAt,
        retryCount,
        nextRetryAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, NULL)
      ON CONFLICT(noteId) DO UPDATE SET
        userId = excluded.userId,
        operation = excluded.operation,
        payloadJson = excluded.payloadJson,
        payloadHash = excluded.payloadHash,
        updatedAt = excluded.updatedAt,
        createdAt = note_outbox.createdAt`,
    [note.id, userId, operation, serializePayload(note), payloadHash, now, now],
  );
  console.log(`[Outbox] Enqueued note operation: ${operation} for ${note.id}`);
};

/**
 * Get all pending operations that are ready to be retried
 */
export const getPendingOperations = async (
  db: SQLiteDatabase,
  now: number = nowMs(),
): Promise<OutboxEntry[]> => {
  const entries = await db.getAllAsync<OutboxEntry>(
    `SELECT * FROM note_outbox 
     WHERE nextRetryAt IS NULL OR nextRetryAt <= ? 
     ORDER BY createdAt ASC`,
    [now],
  );
  return entries;
};

/**
 * Get ALL outbox entries regardless of retry status (for conflict detection)
 */
export const getAllOutboxEntries = async (db: SQLiteDatabase): Promise<OutboxEntry[]> => {
  return await db.getAllAsync<OutboxEntry>(`SELECT * FROM note_outbox`);
};

/**
 * Mark an operation as failed and calculate next retry time
 */
export const markOperationFailed = async (
  db: SQLiteDatabase,
  noteId: string,
  error: string,
  now: number = nowMs(),
): Promise<void> => {
  const entry = await db.getFirstAsync<OutboxEntry>(
    `SELECT retryCount FROM note_outbox WHERE noteId = ?`,
    [noteId],
  );

  if (!entry) {
    console.warn(`[Outbox] Cannot mark failed - entry not found: ${noteId}`);
    return;
  }

  const newRetryCount = entry.retryCount + 1;

  if (shouldRetry(newRetryCount)) {
    const delayMs = getRetryDelayMs(newRetryCount);
    const nextRetryAt = now + delayMs;

    await db.runAsync(
      `UPDATE note_outbox 
       SET retryCount = ?, 
           nextRetryAt = ?, 
           lastAttemptAt = ?
       WHERE noteId = ?`,
      [newRetryCount, nextRetryAt, now, noteId],
    );

    console.log(
      `[Outbox] Marked ${noteId} for retry #${newRetryCount} at ${new Date(nextRetryAt).toISOString()}`,
    );
  } else {
    console.error(`[Outbox] Max retries exceeded for ${noteId}: ${error}`);
    // Keep in outbox but don't schedule retry - requires manual intervention
  }
};

/**
 * Clear successfully synced operations from outbox
 */
export const clearSuccessfulOperations = async (
  db: SQLiteDatabase,
  noteIds: string[],
): Promise<void> => {
  if (noteIds.length === 0) return;

  const placeholders = noteIds.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM note_outbox WHERE noteId IN (${placeholders})`, noteIds);

  console.log(`[Outbox] Cleared ${noteIds.length} successful operations`);
};

/**
 * Get count of pending operations
 */
export const getPendingCount = async (db: SQLiteDatabase): Promise<number> => {
  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM note_outbox`,
  );
  return result?.count || 0;
};

/**
 * Reset retry count for manual retry
 */
export const resetRetry = async (db: SQLiteDatabase, noteId: string): Promise<void> => {
  await db.runAsync(`UPDATE note_outbox SET retryCount = 0, nextRetryAt = NULL WHERE noteId = ?`, [
    noteId,
  ]);
  console.log(`[Outbox] Reset retry state for ${noteId}`);
};
