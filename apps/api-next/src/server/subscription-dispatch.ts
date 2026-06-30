import { createCronStateRepository } from "@backend/jobs/reminders/cron-state-repository";
import {
  createSubscriptionReminderDispatchJob,
  type SubscriptionReminderDispatchJob,
} from "@backend/jobs/subscriptions/dispatch-due-subscription-reminders";
import type { SubscriptionReminderDispatchQueue } from "@backend/jobs/subscriptions/contracts";
import { createSubscriptionReminderScanner } from "@backend/jobs/subscriptions/scanner";
import { createSubscriptionReminderStateRepository } from "@backend/jobs/subscriptions/state-repository";
import {
  createDeviceTokensRepository,
  type DeviceTokensRepository,
} from "@backend/device-tokens/repositories/device-tokens-repository";
import type { CronStateRepository } from "@backend/jobs/reminders/contracts";
import type { SubscriptionReminderStateRepository } from "@backend/jobs/subscriptions/contracts";

export type { SubscriptionReminderDispatchJob };

export type ComposedSubscriptionReminderDispatchJobDeps = Readonly<{
  queue: SubscriptionReminderDispatchQueue;
  deviceTokensRepository?: Pick<DeviceTokensRepository, "listUserIdsWithTokens">;
  cronStateRepository?: CronStateRepository;
  stateRepository?: SubscriptionReminderStateRepository;
  now?: () => Date;
}>;

/**
 * Builds subscription reminder dispatch job with shared scanner/state wiring.
 * Mirrors apps/backend/src/worker/boss-adapter.ts subscription dispatch section.
 */
export const createComposedSubscriptionReminderDispatchJob = (
  deps: ComposedSubscriptionReminderDispatchJobDeps,
): SubscriptionReminderDispatchJob => {
  const deviceTokensRepository =
    deps.deviceTokensRepository ?? createDeviceTokensRepository();

  return createSubscriptionReminderDispatchJob({
    scanner: createSubscriptionReminderScanner({
      listUserIds: async () => deviceTokensRepository.listUserIdsWithTokens(),
    }),
    cronStateRepository: deps.cronStateRepository ?? createCronStateRepository(),
    queue: deps.queue,
    stateRepository: deps.stateRepository ?? createSubscriptionReminderStateRepository(),
    now: deps.now,
  });
};