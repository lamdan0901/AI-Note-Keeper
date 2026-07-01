import type {
  ReminderNotificationSender,
} from "@backend/reminders/notification-sender";
import type {
  ReminderDeliveriesRepository,
} from "@backend/reminders/repositories/reminder-deliveries-repository";
import type { RemindersRepository } from "@backend/reminders/repositories/reminders-repository";
import {
  createScheduledTaskExecutor,
  type ScheduledTaskExecutor,
} from "@backend/reminders/scheduled-task-executor";
import {
  createRemindersService,
  type RemindersService,
} from "@backend/reminders/service";
import type { ReminderSchedulerService } from "@backend/reminders/scheduler-service";

import { computeNextTrigger } from "../../../../packages/shared/utils/recurrence";

type RemindersServiceDeps = Parameters<typeof createRemindersService>[0];
type ScheduledTaskExecutorDeps = Readonly<{
  remindersRepository: Pick<RemindersRepository, "findById" | "advanceAfterDelivery">;
  deliveriesRepository: ReminderDeliveriesRepository;
  notificationSender: ReminderNotificationSender;
  schedulerService: ReminderSchedulerService;
  now?: () => Date;
}>;

/**
 * api-next runs server code through the Next.js bundler rather than the old backend dist path.
 * Inject the shared recurrence implementation directly so recurrence does not depend on
 * backend-only dynamic module loading.
 */
export const createApiNextRemindersService = (
  deps: RemindersServiceDeps = {},
): RemindersService => {
  return createRemindersService({
    ...deps,
    computeNext: computeNextTrigger,
  });
};

/**
 * The scheduled-task executor advances recurring reminders after a QStash callback.
 * Use the shared recurrence implementation directly so weekly weekday rules stay intact.
 */
export const createApiNextScheduledTaskExecutor = (
  deps: ScheduledTaskExecutorDeps,
): ScheduledTaskExecutor => {
  return createScheduledTaskExecutor({
    ...deps,
    computeNext: computeNextTrigger,
  });
};
