import { createAiRateLimiter, type AiRateLimiter } from "@backend/ai/rate-limit";
import { createAiService, type AiService } from "@backend/ai/service";
import { createAuthService, type AuthService } from "@backend/auth/service";
import {
  createDeviceTokensService,
  type DeviceTokensService,
} from "@backend/device-tokens/service";
import { createExpensesService, type ExpensesService } from "@backend/expenses/service";
import { createMergeService, type MergeService } from "@backend/merge/service";
import { createNotesService, type NotesService } from "@backend/notes/service";
import type { PushRetryScheduler } from "@backend/jobs/push/contracts";
import type { PushJobHandler } from "@backend/jobs/push/push-job-handler";
import type { SubscriptionReminderDispatchJob } from "@backend/jobs/subscriptions/dispatch-due-subscription-reminders";
import {
  createReminderSchedulerRuntime,
  type QstashVerifierConfig,
} from "@backend/reminders/runtime";
import type { ScheduledTaskExecutor } from "@backend/reminders/scheduled-task-executor";
import type { RemindersService } from "@backend/reminders/service";

import { composePushDispatchServices } from "@/server/compose-push-dispatch";
import {
  createComposedReminderRepairJob,
  type ReminderRepairJob,
} from "@/server/reminder-repair";
import {
  createSubscriptionsService,
  type SubscriptionsService,
} from "@backend/subscriptions/service";

import { isDependencyDegraded } from "@/server/startup";

export { isDependencyDegraded };

export type ComposedServices = Readonly<{
  authService: AuthService;
  notesService: NotesService;
  remindersService: RemindersService;
  subscriptionsService: SubscriptionsService;
  expensesService: ExpensesService;
  deviceTokensService: DeviceTokensService;
  mergeService: MergeService;
  aiService: AiService;
  aiRateLimiter: AiRateLimiter;
  reminderScheduledTaskExecutor?: ScheduledTaskExecutor;
  reminderQstashVerifierConfig?: QstashVerifierConfig;
  reminderRepairJob?: ReminderRepairJob;
  subscriptionReminderDispatchJob?: SubscriptionReminderDispatchJob;
  pushJobHandler?: PushJobHandler;
  pushRetryScheduler?: PushRetryScheduler;
  pushQstashVerifierConfig?: QstashVerifierConfig;
}>;

/**
 * Mirrors Express startApi.ts service wiring (lines 75–91).
 * Call after ensureApiNextStartup() so pool error handling is active.
 */
export const composeServices = (): ComposedServices => {
  const reminderRuntime = createReminderSchedulerRuntime();
  const notesService = createNotesService({
    remindersRepository: reminderRuntime.remindersRepository,
    schedulerService: reminderRuntime.schedulerService,
  });

  const pushDispatch = reminderRuntime.schedulerCallbacksEnabled
    ? composePushDispatchServices({ reminderRuntime })
    : undefined;

  return {
    authService: createAuthService(),
    notesService,
    remindersService: reminderRuntime.remindersService,
    subscriptionsService: createSubscriptionsService(),
    expensesService: createExpensesService(),
    deviceTokensService: createDeviceTokensService(),
    mergeService: createMergeService(),
    aiService: createAiService(),
    aiRateLimiter: createAiRateLimiter(),
    reminderScheduledTaskExecutor: pushDispatch?.reminderScheduledTaskExecutor,
    reminderQstashVerifierConfig: reminderRuntime.schedulerCallbacksEnabled
      ? (reminderRuntime.qstashVerifierConfig ?? undefined)
      : undefined,
    reminderRepairJob: reminderRuntime.schedulerCallbacksEnabled
      ? createComposedReminderRepairJob(reminderRuntime)
      : undefined,
    subscriptionReminderDispatchJob: pushDispatch?.subscriptionReminderDispatchJob,
    pushJobHandler: pushDispatch?.pushJobHandler,
    pushRetryScheduler: pushDispatch?.pushRetryScheduler,
    pushQstashVerifierConfig: pushDispatch?.pushQstashVerifierConfig,
  };
};

let composedServices: ComposedServices | null = null;

export const getComposedServices = (): ComposedServices => {
  if (composedServices === null) {
    composedServices = composeServices();
  }

  return composedServices;
};

export const setComposedServicesForTests = (services: ComposedServices): void => {
  composedServices = services;
};

export const resetComposedServicesForTests = (): void => {
  composedServices = null;
};