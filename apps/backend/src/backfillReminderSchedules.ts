import { pathToFileURL } from 'node:url';

import { pool } from './db/pool.js';
import { runReminderScheduleBackfillCommand } from './reminders/backfill-schedules.js';
import { createReminderSchedulerRuntime } from './reminders/runtime.js';

const isMainModule = (): boolean => {
  const executedPath = process.argv[1];

  if (!executedPath) {
    return false;
  }

  return pathToFileURL(executedPath).href === import.meta.url;
};

export const backfillReminderSchedules = async (
  argv: ReadonlyArray<string> = process.argv,
) => {
  const runtime = createReminderSchedulerRuntime();

  try {
    const result = await runReminderScheduleBackfillCommand(argv, {
      db: pool,
      remindersRepository: runtime.remindersRepository,
      schedulerService: runtime.schedulerService,
      log: (message) => {
        console.log(message);
      },
    });

    console.log(
      `[reminders:backfill-schedules] summary candidates=${result.candidateCount} scheduled=${result.scheduledCount} failed=${result.failedCount} skipped=${result.skippedCount}`,
    );

    return result;
  } finally {
    await pool.end();
  }
};

if (isMainModule()) {
  backfillReminderSchedules().catch((error) => {
    console.error('[reminders:backfill-schedules] command failed', error);
    process.exit(1);
  });
}
