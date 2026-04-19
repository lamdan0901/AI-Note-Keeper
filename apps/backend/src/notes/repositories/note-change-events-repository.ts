import { randomUUID } from 'node:crypto';

import type { DbQueryClient } from '../../auth/contracts.js';
import { pool } from '../../db/pool.js';

export type NoteChangeEventLookupInput = Readonly<{
  noteId: string;
  userId: string;
  operation: 'create' | 'update' | 'delete';
  payloadHash: string;
}>;

export type NoteChangeEventsRepository = Readonly<{
  isDuplicate: (input: NoteChangeEventLookupInput) => Promise<boolean>;
  appendEvent: (input: NoteChangeEventLookupInput & Readonly<{ deviceId: string; changedAt?: Date }>) => Promise<void>;
}>;

export const createNoteChangeEventsRepository = (
  deps: Readonly<{ db?: DbQueryClient }> = {},
): NoteChangeEventsRepository => {
  const db = deps.db ?? pool;

  return {
    isDuplicate: async ({ noteId, userId, operation, payloadHash }) => {
      const result = await db.query<{ id: string }>(
        `
          SELECT id
          FROM note_change_events
          WHERE note_id = $1
            AND user_id = $2
            AND operation = $3
            AND payload_hash = $4
          LIMIT 1
        `,
        [noteId, userId, operation, payloadHash],
      );

      return result.rows.length > 0;
    },

    appendEvent: async ({ noteId, userId, operation, payloadHash, deviceId, changedAt }) => {
      await db.query(
        `
          INSERT INTO note_change_events (
            id,
            note_id,
            user_id,
            operation,
            changed_at,
            device_id,
            payload_hash
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [randomUUID(), noteId, userId, operation, changedAt ?? new Date(), deviceId, payloadHash],
      );
    },
  };
};
