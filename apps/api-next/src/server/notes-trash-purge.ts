import { pool } from "@backend/db/pool";
import type { DbQueryClient } from "@backend/auth/contracts";
import type { ReminderRecord } from "@backend/reminders/contracts";
import type { ReminderSchedulerService } from "@backend/reminders/scheduler-service";

const TRASH_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_PURGE_LIMIT = 500;
// Safety cap: the cutoff is fixed per run and each batch permanently deletes its
// rows, so the candidate set shrinks monotonically and the drain loop always
// terminates. This bound only guards against an unexpected non-shrinking query.
const MAX_BATCHES = 10_000;

type DeletedTrashRow = Readonly<{
  id: string;
  user_id: string;
  schedule_target_id: string | null;
}>;

export type NotesTrashPurgeResult = Readonly<{
  scanned: number;
  deleted: number;
  batches: number;
  scheduleCancelFailures: number;
}>;

export type NotesTrashPurgeJob = Readonly<{
  run: (input?: Readonly<{ limit?: number }>) => Promise<NotesTrashPurgeResult>;
}>;

const resolveLimit = (limit: number | undefined): number => {
  const resolved = limit ?? DEFAULT_PURGE_LIMIT;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error("Notes trash purge limit must be a positive integer");
  }

  return resolved;
};

/**
 * `cancelCurrentSchedule` only reads `id`, `userId`, and `scheduleTargetId`
 * (see reminders/scheduler-service). The note row is already hard-deleted by the
 * time we call it, so we pass a minimal projection rather than rehydrating a
 * full ReminderRecord from columns we would otherwise have to re-select.
 */
const toScheduleCancelInput = (row: DeletedTrashRow): ReminderRecord =>
  ({
    id: row.id,
    userId: row.user_id,
    scheduleTargetId: row.schedule_target_id,
  }) as unknown as ReminderRecord;

const deleteExpiredTrashBatch = async (
  db: DbQueryClient,
  input: Readonly<{ cutoff: Date; limit: number }>,
): Promise<ReadonlyArray<DeletedTrashRow>> => {
  const result = await db.query<DeletedTrashRow>(
    `
      DELETE FROM notes
      WHERE id IN (
        SELECT id
        FROM notes
        WHERE active = false
          AND deleted_at IS NOT NULL
          AND deleted_at <= $1
        ORDER BY deleted_at ASC, updated_at ASC
        LIMIT $2
      )
      RETURNING id, user_id, schedule_target_id
    `,
    [input.cutoff, input.limit],
  );

  return result.rows;
};

export const createNotesTrashPurgeJob = (
  deps: Readonly<{
    schedulerService: Pick<ReminderSchedulerService, "cancelCurrentSchedule">;
    db?: DbQueryClient;
    now?: () => Date;
  }>,
): NotesTrashPurgeJob => {
  const db = deps.db ?? pool;
  const now = deps.now ?? (() => new Date());

  return {
    run: async (input) => {
      const limit = resolveLimit(input?.limit);
      const cutoff = new Date(now().getTime() - TRASH_RETENTION_MS);
      let deleted = 0;
      let batches = 0;
      let scheduleCancelFailures = 0;

      // Drain the whole overdue backlog in bounded batches so a single run keeps
      // up even when a large backlog has accumulated.
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const rows = await deleteExpiredTrashBatch(db, { cutoff, limit });
        if (rows.length === 0) {
          break;
        }

        batches += 1;
        deleted += rows.length;

        for (const row of rows) {
          if (!row.schedule_target_id) {
            continue;
          }

          // The row is already deleted; this cancels the external schedule.
          // A single failure must not abort the purge — track and continue.
          try {
            await deps.schedulerService.cancelCurrentSchedule(toScheduleCancelInput(row));
          } catch {
            scheduleCancelFailures += 1;
          }
        }

        if (rows.length < limit) {
          break;
        }
      }

      return {
        scanned: deleted,
        deleted,
        batches,
        scheduleCancelFailures,
      };
    },
  };
};
