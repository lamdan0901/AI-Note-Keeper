import {
  createReminderRepairJob,
  type ReminderRepairJob,
} from "@backend/reminders/repair-job";
import type { ReminderSchedulerRuntime } from "@backend/reminders/runtime";

export type { ReminderRepairJob };

/**
 * Builds the reminder repair job from the shared scheduler runtime.
 * Mirrors apps/backend/src/worker/boss-adapter.ts — no new scheduler instances.
 */
export const createComposedReminderRepairJob = (
  runtime: Pick<
    ReminderSchedulerRuntime,
    "remindersRepository" | "scheduledTaskExecutor" | "schedulerService"
  >,
): ReminderRepairJob => {
  return createReminderRepairJob({
    remindersRepository: runtime.remindersRepository,
    executor: runtime.scheduledTaskExecutor,
    schedulerService: runtime.schedulerService,
  });
};