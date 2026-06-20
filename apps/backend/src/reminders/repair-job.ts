import type { RemindersRepository } from './repositories/reminders-repository.js';
import { createReminderDeliveryKey, type ReminderSchedulerService } from './scheduler-service.js';
import type { ScheduledTaskExecutor } from './scheduled-task-executor.js';

export type ReminderRepairJob = Readonly<{
  run: () => Promise<Readonly<{ candidates: number; executed: number; scheduled: number }>>;
}>;

export const createReminderRepairJob = (
  deps: Readonly<{
    remindersRepository: Pick<RemindersRepository, 'listRepairCandidates' | 'findById'>;
    executor: ScheduledTaskExecutor;
    schedulerService: ReminderSchedulerService;
    now?: () => Date;
    limit?: number;
  }>,
): ReminderRepairJob => {
  const now = deps.now ?? (() => new Date());
  const limit = deps.limit ?? 100;

  return {
    run: async () => {
      const runAt = now();
      const candidates = await deps.remindersRepository.listRepairCandidates({
        now: runAt,
        limit,
      });
      let executed = 0;
      let scheduled = 0;

      for (const initialReminder of candidates) {
        let reminder = initialReminder;
        if (reminder.nextTriggerAt === null) {
          continue;
        }

        while (reminder.nextTriggerAt && reminder.nextTriggerAt.getTime() <= runAt.getTime()) {
          const deliveryKey = createReminderDeliveryKey({
            reminderId: reminder.id,
            occurrenceAt: reminder.nextTriggerAt,
            version: reminder.version,
          });
          await deps.executor.execute({
            reminderId: reminder.id,
            occurrenceAt: reminder.nextTriggerAt.toISOString(),
            version: reminder.version,
            deliveryKey,
          });
          executed += 1;

          const refreshed = await deps.remindersRepository.findById({
            reminderId: reminder.id,
          });
          if (
            refreshed === null ||
            refreshed.nextTriggerAt === null ||
            refreshed.active !== true
          ) {
            reminder = refreshed ?? reminder;
            break;
          }

          const progressed =
            refreshed.version !== reminder.version ||
            refreshed.nextTriggerAt.getTime() !== reminder.nextTriggerAt.getTime();
          reminder = refreshed;
          if (!progressed) {
            break;
          }
        }

        if (
          reminder.nextTriggerAt !== null &&
          reminder.nextTriggerAt.getTime() > runAt.getTime() &&
          reminder.scheduleTargetId === null ||
          (reminder.nextTriggerAt !== null &&
            reminder.nextTriggerAt.getTime() > runAt.getTime() &&
            reminder.scheduleTargetVersion !== reminder.version)
        ) {
          const result = await deps.schedulerService.scheduleNextOccurrence(reminder);
          if (result.scheduled) {
            scheduled += 1;
          }
        }
      }

      return { candidates: candidates.length, executed, scheduled };
    },
  };
};
