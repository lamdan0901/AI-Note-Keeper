import {
  createDeviceTokensRepository,
  type DeviceTokensRepository,
} from "@backend/device-tokens/repositories/device-tokens-repository";
import { createFcmPushProvider } from "@backend/jobs/push/fcm-provider";
import type {
  PushProvider,
  PushRetryPolicy,
  PushRetryScheduler,
  PushTerminalFailureRecorder,
} from "@backend/jobs/push/contracts";
import { createPushDeliveryService } from "@backend/jobs/push/push-delivery-service";
import {
  createPushJobHandler,
  type PushJobHandler,
  type PushJobRunResult,
} from "@backend/jobs/push/push-job-handler";
import type {
  SubscriptionReminderDispatchQueue,
  SubscriptionReminderDispatchQueueJob,
  SubscriptionReminderQueueEnqueueResult,
} from "@backend/jobs/subscriptions/contracts";
import type {
  ReminderNotificationSender,
  ReminderNotificationSendResult,
} from "@backend/reminders/notification-sender";
import { renderReminderNotificationText } from "@backend/reminders/notification-text";

export type PushDispatchLogger = Readonly<{
  info: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}>;

export type JobKeyEnqueueResult = Readonly<{
  status: "enqueued" | "duplicate";
}>;

export const MAX_IN_MEMORY_JOB_KEYS = 50_000;
export const JOB_KEY_RETENTION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_CONCURRENT_PUSH_DISPATCHES = 20;

export type InMemoryJobKeyDeduper = Readonly<{
  tryEnqueue: (jobKey: string) => JobKeyEnqueueResult;
}>;

export type InMemoryJobKeyDeduperOptions = Readonly<{
  now?: () => number;
  maxKeys?: number;
  retentionWindowMs?: number;
}>;

/**
 * Ports jobKey dedup semantics from createInMemoryDispatchQueue in boss-adapter.ts.
 */
export const createInMemoryJobKeyDeduper = (
  options: InMemoryJobKeyDeduperOptions = {},
): InMemoryJobKeyDeduper => {
  const now = options.now ?? (() => Date.now());
  const maxKeys = options.maxKeys ?? MAX_IN_MEMORY_JOB_KEYS;
  const retentionWindowMs = options.retentionWindowMs ?? JOB_KEY_RETENTION_WINDOW_MS;
  const enqueuedJobKeys = new Map<string, number>();
  let enqueueCounter = 0;

  const pruneJobKeys = (nowMs: number): void => {
    enqueueCounter += 1;

    if (enqueuedJobKeys.size < maxKeys && enqueueCounter % 100 !== 0) {
      return;
    }

    const cutoffMs = nowMs - retentionWindowMs;
    for (const [jobKey, seenAt] of enqueuedJobKeys.entries()) {
      if (seenAt < cutoffMs) {
        enqueuedJobKeys.delete(jobKey);
      }
    }

    if (enqueuedJobKeys.size <= maxKeys) {
      return;
    }

    const overflow = enqueuedJobKeys.size - maxKeys;
    let removed = 0;
    for (const jobKey of enqueuedJobKeys.keys()) {
      enqueuedJobKeys.delete(jobKey);
      removed += 1;
      if (removed >= overflow) {
        break;
      }
    }
  };

  return {
    tryEnqueue: (jobKey) => {
      const nowMs = now();
      pruneJobKeys(nowMs);

      if (enqueuedJobKeys.has(jobKey)) {
        return { status: "duplicate" };
      }

      enqueuedJobKeys.set(jobKey, nowMs);
      return { status: "enqueued" };
    },
  };
};

export type PushDispatchConcurrencyLimiter = Readonly<{
  acquire: () => Promise<void>;
  release: () => void;
}>;

export const createPushDispatchConcurrencyLimiter = (
  maxConcurrent: number,
): PushDispatchConcurrencyLimiter => {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent <= 0) {
    throw new Error("maxConcurrent must be a positive integer");
  }

  let activeDispatches = 0;
  const waiters: Array<() => void> = [];

  return {
    acquire: async () => {
      while (activeDispatches >= maxConcurrent) {
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
      }

      activeDispatches += 1;
    },
    release: () => {
      activeDispatches = Math.max(0, activeDispatches - 1);
      const nextWaiter = waiters.shift();
      if (nextWaiter) {
        nextWaiter();
      }
    },
  };
};

const sanitizeLogText = (value?: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
};

const createNoopTerminalFailureRecorder = (): PushTerminalFailureRecorder => ({
  record: async () => undefined,
});

export type ComposedPushJobHandlerDeps = Readonly<{
  deviceTokensRepository?: Pick<DeviceTokensRepository, "deleteByDeviceIdForUser">;
  pushProvider?: PushProvider;
  retryScheduler: PushRetryScheduler;
  terminalFailureRecorder?: PushTerminalFailureRecorder;
  retryPolicy?: PushRetryPolicy;
  logger?: PushDispatchLogger;
}>;

export const createComposedPushJobHandler = (
  deps: ComposedPushJobHandlerDeps,
): PushJobHandler => {
  const deviceTokensRepository =
    deps.deviceTokensRepository ?? createDeviceTokensRepository();
  const pushProvider = deps.pushProvider ?? createFcmPushProvider();
  const terminalFailureRecorder =
    deps.terminalFailureRecorder ?? createNoopTerminalFailureRecorder();

  return createPushJobHandler({
    deliveryService: createPushDeliveryService({
      provider: pushProvider,
    }),
    deviceTokensRepository,
    retryScheduler: deps.retryScheduler,
    terminalFailureRecorder,
    retryPolicy: deps.retryPolicy,
  });
};

const toReminderSendResult = (
  pushResult: PushJobRunResult,
): ReminderNotificationSendResult => {
  if (pushResult.delivered > 0) {
    return {
      status: "sent",
      delivered: pushResult.delivered,
      failed: pushResult.terminalFailures,
      providerMessageId: `tokens:${pushResult.delivered}`,
    };
  }

  if (pushResult.retriesScheduled > 0) {
    return {
      status: "sent",
      delivered: 0,
      failed: 0,
      providerMessageId: `retries:${pushResult.retriesScheduled}`,
    };
  }

  return {
    status: "failed",
    delivered: 0,
    failed: pushResult.terminalFailures,
    reason: "all_push_attempts_failed",
  };
};

export type RetryAwareReminderNotificationSenderDeps = Readonly<{
  pushJobHandler: PushJobHandler;
  deviceTokensRepository: Pick<DeviceTokensRepository, "listByUserId">;
}>;

/**
 * api-next-only sender: delegates multi-token delivery to pushJobHandler (with retries).
 */
export const createRetryAwareReminderNotificationSender = (
  deps: RetryAwareReminderNotificationSenderDeps,
): ReminderNotificationSender => ({
  sendReminderNotification: async ({ reminder, deliveryKey, attempt }) => {
    const text = renderReminderNotificationText(reminder);
    const tokens = await deps.deviceTokensRepository.listByUserId(reminder.userId);

    if (tokens.length === 0) {
      return { status: "failed", delivered: 0, failed: 0, reason: "no_device_tokens" };
    }

    const pushResult = await deps.pushJobHandler.handle({
      userId: reminder.userId,
      reminderId: reminder.id,
      changeEventId: deliveryKey,
      isTrigger: true,
      attempt,
      tokens: tokens.map((token) => ({
        deviceId: token.deviceId,
        fcmToken: token.fcmToken,
      })),
      title: text.title,
      body: text.body,
    });

    return toReminderSendResult(pushResult);
  },
});

export type SubscriptionPushEnqueueBridgeDeps = Readonly<{
  pushJobHandler: PushJobHandler;
  deviceTokensRepository: Pick<DeviceTokensRepository, "listByUserId">;
  jobKeyDeduper: InMemoryJobKeyDeduper;
  concurrencyLimiter?: PushDispatchConcurrencyLimiter;
  maxConcurrentPushDispatches?: number;
  logger?: PushDispatchLogger;
}>;

const toSubscriptionReminderId = (
  job: SubscriptionReminderDispatchQueueJob,
): string => `subscription:${job.subscriptionId}:${job.kind}`;

/**
 * Maps SubscriptionReminderDispatchQueue.enqueue to token lookup + pushJobHandler.handle.
 * Mirrors boss-adapter subscriptionQueue + in-memory queue onEnqueue path.
 */
export const createSubscriptionPushEnqueueBridge = (
  deps: SubscriptionPushEnqueueBridgeDeps,
): SubscriptionReminderDispatchQueue => {
  const maxConcurrent =
    deps.maxConcurrentPushDispatches ?? DEFAULT_MAX_CONCURRENT_PUSH_DISPATCHES;
  const concurrencyLimiter =
    deps.concurrencyLimiter ?? createPushDispatchConcurrencyLimiter(maxConcurrent);
  const logger = deps.logger;

  return {
    enqueue: async (job) => {
      const dedupeResult = deps.jobKeyDeduper.tryEnqueue(job.jobKey);
      if (dedupeResult.status === "duplicate") {
        return { status: "duplicate" } satisfies SubscriptionReminderQueueEnqueueResult;
      }

      await concurrencyLimiter.acquire();

      try {
        const tokens = await deps.deviceTokensRepository.listByUserId(job.userId);

        if (tokens.length === 0) {
          logger?.info(
            `[push-dispatch] no device tokens for subscription event ${job.eventId}; skipping push`,
          );
          return { status: "enqueued" } satisfies SubscriptionReminderQueueEnqueueResult;
        }

        const result = await deps.pushJobHandler.handle({
          userId: job.userId,
          reminderId: toSubscriptionReminderId(job),
          changeEventId: job.eventId,
          isTrigger: true,
          attempt: 0,
          tokens: tokens.map((token) => ({
            deviceId: token.deviceId,
            fcmToken: token.fcmToken,
          })),
          title: job.title,
          body: job.body,
        });

        const title = sanitizeLogText(job.title);
        const body = sanitizeLogText(job.body);
        logger?.info(
          `[push-dispatch] subscription push completed event=${job.eventId} processed=${result.processed} delivered=${result.delivered} retries=${result.retriesScheduled} title="${title}" body="${body}"`,
        );

        return { status: "enqueued" } satisfies SubscriptionReminderQueueEnqueueResult;
      } finally {
        concurrencyLimiter.release();
      }
    },
  };
};

export type { PushJobHandler, PushJobRunResult, ReminderNotificationSender };