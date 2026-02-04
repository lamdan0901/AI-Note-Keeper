import { SQLiteDatabase } from 'expo-sqlite/next';
import { nowMs } from '../../../../packages/shared/utils/time';
import { calculatePayloadHash } from '../../../../packages/shared/utils/hash';
import { Note } from '../db/notesRepo';

export type NoteOperation = 'create' | 'update' | 'delete';

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
        lastAttemptAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
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
