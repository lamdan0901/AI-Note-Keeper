import type { DbQueryClient } from '../../auth/contracts.js';
import { pool } from '../../db/pool.js';
import {
  MAX_LOOKBACK_MS,
  resolveReminderTriggerTime,
  type DueReminderScanner,
  type ReminderDueCandidate,
  type ReminderScanInput,
  type ReminderScanResult,
} from './contracts.js';

type DueReminderRow = Readonly<{
  note_id: string;
  user_id: string;
  trigger_at: Date | null;
  next_trigger_at: Date | null;
  snoozed_until: Date | null;
}>;

const toDateOrNull = (value: Date | string | number | null): Date | null => {
  if (value === null) {
    return null;
  }

  const next = value instanceof Date ? value : new Date(value);
  return Number.isNaN(next.getTime()) ? null : next;
};

const toCandidate = (row: DueReminderRow): ReminderDueCandidate => {
  return {
    noteId: row.note_id,
    userId: row.user_id,
    triggerAt: toDateOrNull(row.trigger_at),
    nextTriggerAt: toDateOrNull(row.next_trigger_at),
    snoozedUntil: toDateOrNull(row.snoozed_until),
  };
};

export const resolveScanSince = (input: ReminderScanInput): Date => {
  if (input.lastCheckedAt) {
    return input.lastCheckedAt;
  }

  return new Date(input.now.getTime() - MAX_LOOKBACK_MS);
};

export const createDueReminderScanner = (
  deps: Readonly<{ db?: DbQueryClient }> = {},
): DueReminderScanner => {
  const db = deps.db ?? pool;

  return {
    scanDueReminders: async (input): Promise<ReminderScanResult> => {
      const since = resolveScanSince(input);
      const now = input.now;

      const result = await db.query<DueReminderRow>(
        `
          SELECT
            id AS note_id,
            user_id,
            trigger_at,
            next_trigger_at,
            snoozed_until
          FROM notes
          WHERE active = true
            AND deleted_at IS NULL
            AND trigger_at IS NOT NULL
            AND COALESCE(snoozed_until, next_trigger_at, trigger_at) >= $1
            AND COALESCE(snoozed_until, next_trigger_at, trigger_at) <= $2
          ORDER BY COALESCE(snoozed_until, next_trigger_at, trigger_at) ASC
        `,
        [since, now],
      );

      const reminders = result.rows
        .map(toCandidate)
        .map((candidate) => {
          const triggerTime = resolveReminderTriggerTime(candidate);
          return {
            noteId: candidate.noteId,
            userId: candidate.userId,
            triggerTime,
          };
        })
        .filter((item): item is Readonly<{ noteId: string; userId: string; triggerTime: Date }> => {
          if (item.triggerTime === null) {
            return false;
          }

          const timestamp = item.triggerTime.getTime();
          return timestamp >= since.getTime() && timestamp <= now.getTime();
        });

      return {
        since,
        now,
        reminders,
      };
    },
  };
};
