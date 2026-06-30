import { readReminderSchedulerConfig } from "@backend/config";
import {
  createDeviceTokensRepository,
  type DeviceTokensRepository,
} from "@backend/device-tokens/repositories/device-tokens-repository";
import type { PushRetryScheduler } from "@backend/jobs/push/contracts";
import type { PushJobHandler } from "@backend/jobs/push/push-job-handler";
import type { SubscriptionReminderDispatchJob } from "@backend/jobs/subscriptions/dispatch-due-subscription-reminders";
import {
  createScheduledTaskExecutor,
  type ScheduledTaskExecutor,
} from "@backend/reminders/scheduled-task-executor";
import type { QstashVerifierConfig, ReminderSchedulerRuntime } from "@backend/reminders/runtime";

import {
  createComposedPushJobHandler,
  createInMemoryJobKeyDeduper,
  createRetryAwareReminderNotificationSender,
  createSubscriptionPushEnqueueBridge,
} from "@/server/push-dispatch";
import { createPushRetryCallbackUrl, createQstashPushRetryScheduler } from "@/server/qstash-push-retry-scheduler";
import { createComposedSubscriptionReminderDispatchJob } from "@/server/subscription-dispatch";

export type ComposedPushDispatchServices = Readonly<{
  subscriptionReminderDispatchJob: SubscriptionReminderDispatchJob;
  pushJobHandler: PushJobHandler;
  pushRetryScheduler: PushRetryScheduler;
  pushQstashVerifierConfig: QstashVerifierConfig;
  reminderScheduledTaskExecutor: ScheduledTaskExecutor;
}>;

export type ComposePushDispatchServicesDeps = Readonly<{
  reminderRuntime: ReminderSchedulerRuntime;
  deviceTokensRepository?: Pick<
    DeviceTokensRepository,
    "listByUserId" | "listUserIdsWithTokens" | "deleteByDeviceIdForUser"
  >;
  pushJobHandler?: PushJobHandler;
}>;

/**
 * Wires push retry, subscription dispatch, and retry-aware reminder executor
 * when scheduler callbacks are enabled.
 */
export const composePushDispatchServices = (
  deps: ComposePushDispatchServicesDeps,
): ComposedPushDispatchServices => {
  const { reminderRuntime } = deps;
  const deviceTokensRepository =
    deps.deviceTokensRepository ?? createDeviceTokensRepository();
  const schedulerConfig = readReminderSchedulerConfig();

  const pushRetryScheduler = createQstashPushRetryScheduler({
    callbackBaseUrl: schedulerConfig.REMINDER_SCHEDULER_CALLBACK_BASE_URL,
    qstashToken: schedulerConfig.QSTASH_TOKEN,
    qstashUrl: schedulerConfig.QSTASH_URL,
  });
  const pushJobHandler =
    deps.pushJobHandler ??
    createComposedPushJobHandler({
      deviceTokensRepository,
      retryScheduler: pushRetryScheduler,
    });
  const jobKeyDeduper = createInMemoryJobKeyDeduper();
  const subscriptionQueue = createSubscriptionPushEnqueueBridge({
    pushJobHandler,
    deviceTokensRepository,
    jobKeyDeduper,
  });
  const subscriptionReminderDispatchJob = createComposedSubscriptionReminderDispatchJob({
    deviceTokensRepository,
    queue: subscriptionQueue,
  });
  const retryAwareSender = createRetryAwareReminderNotificationSender({
    pushJobHandler,
    deviceTokensRepository,
  });
  const reminderScheduledTaskExecutor = createScheduledTaskExecutor({
    remindersRepository: reminderRuntime.remindersRepository,
    deliveriesRepository: reminderRuntime.deliveriesRepository,
    notificationSender: retryAwareSender,
    schedulerService: reminderRuntime.schedulerService,
  });

  if (
    !schedulerConfig.QSTASH_CURRENT_SIGNING_KEY ||
    !schedulerConfig.QSTASH_NEXT_SIGNING_KEY ||
    !schedulerConfig.REMINDER_SCHEDULER_CALLBACK_BASE_URL
  ) {
    throw new Error("QStash signing keys and callback base URL are required for push retry");
  }

  const pushQstashVerifierConfig: QstashVerifierConfig = {
    currentSigningKey: schedulerConfig.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: schedulerConfig.QSTASH_NEXT_SIGNING_KEY,
    callbackUrl: createPushRetryCallbackUrl(schedulerConfig.REMINDER_SCHEDULER_CALLBACK_BASE_URL),
  };

  return {
    subscriptionReminderDispatchJob,
    pushJobHandler,
    pushRetryScheduler,
    pushQstashVerifierConfig,
    reminderScheduledTaskExecutor,
  };
};