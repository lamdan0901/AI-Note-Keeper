import type { DbQueryClient } from '../auth/contracts.js';
import type { ReminderRecord } from './contracts.js';
import type { RemindersRepository } from './repositories/reminders-repository.js';
import type { ReminderSchedulerService } from './scheduler-service.js';

type ReminderIdRow = Readonly<{ id: string }>;

export type ReminderScheduleBackfillItemResult = Readonly<{
  reminderId: string;
  status: 'scheduled' | 'failed' | 'skipped';
  reason?: string;
}>;

export type ReminderScheduleBackfillResult = Readonly<{
  dryRun: boolean;
  candidateCount: number;
  scheduledCount: number;
  failedCount: number;
  skippedCount: number;
  results: ReadonlyArray<ReminderScheduleBackfillItemResult>;
}>;

type ReminderScheduleBackfillDeps = Readonly<{
  db: DbQueryClient;
  remindersRepository: Pick<RemindersRepository, 'findById'>;
  schedulerService: Pick<ReminderSchedulerService, 'scheduleNextOccurrence'>;
  now?: () => Date;
  log?: (message: string) => void;
}>;

const listCandidateReminderIds = async (
  db: DbQueryClient,
  runAt: Date,
): Promise<ReadonlyArray<string>> => {
  const result = await db.query<ReminderIdRow>(
    `
      SELECT id
      FROM notes
      WHERE trigger_at IS NOT NULL
        AND active = true
        AND deleted_at IS NULL
        AND next_trigger_at IS NOT NULL
        AND next_trigger_at > $1
        AND (
          schedule_target_id IS NULL
          OR schedule_target_version IS DISTINCT FROM version
        )
      ORDER BY next_trigger_at ASC, updated_at ASC
    `,
    [runAt],
  );

  return result.rows.map((row) => row.id);
};

const isEligibleForBackfill = (reminder: ReminderRecord, runAt: Date): boolean => {
  if (!reminder.active || reminder.nextTriggerAt === null) {
    return false;
  }

  if (reminder.nextTriggerAt.getTime() <= runAt.getTime()) {
    return false;
  }

  return (
    reminder.scheduleTargetId === null || reminder.scheduleTargetVersion !== reminder.version
  );
};

const countByStatus = (
  results: ReadonlyArray<ReminderScheduleBackfillItemResult>,
  status: ReminderScheduleBackfillItemResult['status'],
): number => results.filter((result) => result.status === status).length;

export const runReminderScheduleBackfillCommand = async (
  argv: ReadonlyArray<string>,
  deps: ReminderScheduleBackfillDeps,
): Promise<ReminderScheduleBackfillResult> => {
  const dryRun = argv.includes('--dry-run');
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const runAt = now();
  const candidateReminderIds = await listCandidateReminderIds(deps.db, runAt);
  const results: ReminderScheduleBackfillItemResult[] = [];

  log(
    `[reminders:backfill-schedules] ${dryRun ? 'dry-run' : 'write'} mode; found ${candidateReminderIds.length} candidate reminder(s)`,
  );

  for (const reminderId of candidateReminderIds) {
    const reminder = await deps.remindersRepository.findById({ reminderId });

    if (reminder === null) {
      results.push({ reminderId, status: 'skipped', reason: 'not_found' });
      log(`[reminders:backfill-schedules] skip ${reminderId}: reminder no longer exists`);
      continue;
    }

    if (!isEligibleForBackfill(reminder, runAt)) {
      results.push({ reminderId, status: 'skipped', reason: 'not_eligible' });
      log(`[reminders:backfill-schedules] skip ${reminderId}: reminder is no longer eligible`);
      continue;
    }

    if (dryRun) {
      results.push({ reminderId, status: 'skipped', reason: 'dry_run' });
      log(`[reminders:backfill-schedules] would schedule ${reminderId}`);
      continue;
    }

    const scheduled = await deps.schedulerService.scheduleNextOccurrence(reminder);
    if (scheduled.scheduled) {
      results.push({ reminderId, status: 'scheduled' });
      log(`[reminders:backfill-schedules] scheduled ${reminderId}`);
      continue;
    }

    results.push({
      reminderId,
      status: 'failed',
      reason: scheduled.reason ?? 'unknown',
    });
    log(
      `[reminders:backfill-schedules] failed ${reminderId}: ${scheduled.reason ?? 'unknown'}`,
    );
  }

  return {
    dryRun,
    candidateCount: candidateReminderIds.length,
    scheduledCount: countByStatus(results, 'scheduled'),
    failedCount: countByStatus(results, 'failed'),
    skippedCount: countByStatus(results, 'skipped'),
    results,
  };
};
