import type { CronStateRepository } from '../reminders/contracts.js';
import {
  SUBSCRIPTION_REMINDER_DISPATCH_CRON_KEY,
  createSubscriptionReminderEventId,
  type SubscriptionReminderDispatchQueue,
  type SubscriptionReminderScanner,
  type SubscriptionReminderStateRepository,
} from './contracts.js';

export type SubscriptionReminderDispatchRunResult = Readonly<{
  cronKey: string;
  since: Date;
  now: Date;
  scanned: number;
  enqueued: number;
  duplicates: number;
}>;

export type SubscriptionReminderDispatchJob = Readonly<{
  run: () => Promise<SubscriptionReminderDispatchRunResult>;
}>;

export type SubscriptionReminderDispatchJobDeps = Readonly<{
  scanner: SubscriptionReminderScanner;
  cronStateRepository: CronStateRepository;
  queue: SubscriptionReminderDispatchQueue;
  stateRepository: SubscriptionReminderStateRepository;
  now?: () => Date;
  cronKey?: string;
}>;

export const createSubscriptionReminderDispatchJob = (
  deps: SubscriptionReminderDispatchJobDeps,
): SubscriptionReminderDispatchJob => {
  const now = deps.now ?? (() => new Date());
  const cronKey = deps.cronKey ?? SUBSCRIPTION_REMINDER_DISPATCH_CRON_KEY;

  return {
    run: async () => {
      const runNow = now();
      const lastCheckedAt = await deps.cronStateRepository.getLastCheckedAt(cronKey);
      const scan = await deps.scanner.scanDueReminders({ now: runNow, lastCheckedAt });

      let enqueued = 0;
      let duplicates = 0;

      for (const reminder of scan.reminders) {
        const eventId = createSubscriptionReminderEventId(
          reminder.subscriptionId,
          reminder.kind,
          reminder.triggerTime,
        );
        const result = await deps.queue.enqueue({
          subscriptionId: reminder.subscriptionId,
          userId: reminder.userId,
          kind: reminder.kind,
          triggerTime: reminder.triggerTime,
          anchorDate: reminder.anchorDate,
          eventId,
          jobKey: eventId,
          title: reminder.title,
          body: reminder.body,
        });

        if (reminder.kind === 'billing') {
          await deps.stateRepository.markBillingReminderSent({
            subscriptionId: reminder.subscriptionId,
            userId: reminder.userId,
            anchorDate: reminder.anchorDate,
            triggerTime: reminder.triggerTime,
          });
        } else {
          await deps.stateRepository.markTrialReminderSent({
            subscriptionId: reminder.subscriptionId,
            userId: reminder.userId,
            anchorDate: reminder.anchorDate,
            triggerTime: reminder.triggerTime,
          });
        }

        if (result.status === 'duplicate') {
          duplicates += 1;
          continue;
        }

        enqueued += 1;
      }

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
      } satisfies SubscriptionReminderDispatchRunResult;
    },
  };
};
