import {
  REMINDER_DISPATCH_CRON_KEY,
  createReminderEventId,
  type CronStateRepository,
  type DueReminderScanner,
  type ReminderDispatchQueue,
} from './contracts.js';

export type ReminderDispatchRunResult = Readonly<{
  cronKey: string;
  since: Date;
  now: Date;
  scanned: number;
  enqueued: number;
  duplicates: number;
}>;

export type ReminderDispatchJob = Readonly<{
  run: () => Promise<ReminderDispatchRunResult>;
}>;

export type ReminderDispatchJobDeps = Readonly<{
  scanner: DueReminderScanner;
  cronStateRepository: CronStateRepository;
  queue: ReminderDispatchQueue;
  now?: () => Date;
  cronKey?: string;
}>;

export const createReminderDispatchJob = (deps: ReminderDispatchJobDeps): ReminderDispatchJob => {
  const now = deps.now ?? (() => new Date());
  const cronKey = deps.cronKey ?? REMINDER_DISPATCH_CRON_KEY;

  return {
    run: async () => {
      const runNow = now();
      const lastCheckedAt = await deps.cronStateRepository.getLastCheckedAt(cronKey);
      const scan = await deps.scanner.scanDueReminders({
        now: runNow,
        lastCheckedAt,
      });

      let enqueued = 0;
      let duplicates = 0;

      for (const reminder of scan.reminders) {
        const eventId = createReminderEventId(reminder.noteId, reminder.triggerTime);
        const result = await deps.queue.enqueue({
          noteId: reminder.noteId,
          userId: reminder.userId,
          triggerTime: reminder.triggerTime,
          eventId,
          jobKey: eventId,
        });

        if (result.status === 'duplicate') {
          duplicates += 1;
          continue;
        }

        enqueued += 1;
      }

      // Watermark progression must only happen after enqueue work succeeded.
      await deps.cronStateRepository.upsertLastCheckedAt({
        key: cronKey,
        lastCheckedAt: scan.now,
      });

      return {
        cronKey,
        since: scan.since,
        now: scan.now,
        scanned: scan.reminders.length,
        enqueued,
        duplicates,
      };
    },
  };
};
