import type { WorkerAdapter, WorkerHealthSnapshot, WorkerRuntimeStatus } from './contracts.js';
import { createCronStateRepository } from '../jobs/reminders/cron-state-repository.js';
import {
  createReminderDispatchJob,
  type ReminderDispatchJob,
} from '../jobs/reminders/dispatch-due-reminders.js';
import { createDueReminderScanner } from '../jobs/reminders/due-reminder-scanner.js';
import {
  createDeviceTokensRepository,
  type DeviceTokensRepository,
} from '../device-tokens/repositories/device-tokens-repository.js';
import { createFcmPushProvider } from '../jobs/push/fcm-provider.js';
import { createPushDeliveryService } from '../jobs/push/push-delivery-service.js';
import { createPushJobHandler, type PushJobHandler } from '../jobs/push/push-job-handler.js';
import type {
  CronStateRepository,
  DueReminderScanner,
  ReminderDispatchQueue,
  ReminderDispatchQueueJob,
  ReminderQueueEnqueueResult,
} from '../jobs/reminders/contracts.js';
import type {
  PushProvider,
  PushRetryScheduler,
  PushTerminalFailureRecord,
  PushTerminalFailureRecorder,
} from '../jobs/push/contracts.js';

type AdapterLogger = Readonly<{
  info: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}>;

const defaultLogger: AdapterLogger = {
  info: (message) => {
    console.log(message);
  },
  error: (message, error) => {
    console.error(message, error);
  },
};

export type PgBossAdapterOptions = Readonly<{
  logger?: AdapterLogger;
  dispatchIntervalMs?: number;
  maxConcurrentPushDispatches?: number;
  scheduler?: Readonly<{
    setInterval: (callback: () => void, ms: number) => NodeJS.Timeout;
    clearInterval: (handle: NodeJS.Timeout) => void;
    setTimeout?: (callback: () => void, ms: number) => NodeJS.Timeout;
    clearTimeout?: (handle: NodeJS.Timeout) => void;
  }>;
  queue?: ReminderDispatchQueue;
  scanner?: DueReminderScanner;
  cronStateRepository?: CronStateRepository;
  dispatchJob?: ReminderDispatchJob;
  pushJobHandler?: PushJobHandler;
  pushProvider?: PushProvider;
  deviceTokensRepository?: Pick<DeviceTokensRepository, 'listByUserId' | 'deleteByDeviceIdForUser'>;
  pushRetryScheduler?: PushRetryScheduler;
  terminalFailureRecorder?: PushTerminalFailureRecorder;
  now?: () => Date;
}>;

const defaultScheduler: Readonly<{
  setInterval: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearInterval: (handle: NodeJS.Timeout) => void;
  setTimeout: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimeout: (handle: NodeJS.Timeout) => void;
}> = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

const MAX_IN_MEMORY_JOB_KEYS = 50_000;
const JOB_KEY_RETENTION_WINDOW_MS = 24 * 60 * 60 * 1000;

const resolveDelayToNextBoundaryMs = (nowMs: number, intervalMs: number): number => {
  const remainderMs = nowMs % intervalMs;
  return remainderMs === 0 ? intervalMs : intervalMs - remainderMs;
};

const createInMemoryDispatchQueue = (
  logger: AdapterLogger,
  onEnqueue?: (job: ReminderDispatchQueueJob) => Promise<void>,
): ReminderDispatchQueue => {
  const enqueuedJobKeys = new Map<string, number>();
  let enqueueCounter = 0;

  const pruneJobKeys = (nowMs: number): void => {
    enqueueCounter += 1;

    // Cheap periodic prune during normal operation.
    if (enqueuedJobKeys.size < MAX_IN_MEMORY_JOB_KEYS && enqueueCounter % 100 !== 0) {
      return;
    }

    const cutoffMs = nowMs - JOB_KEY_RETENTION_WINDOW_MS;
    for (const [jobKey, seenAt] of enqueuedJobKeys.entries()) {
      if (seenAt < cutoffMs) {
        enqueuedJobKeys.delete(jobKey);
      }
    }

    if (enqueuedJobKeys.size <= MAX_IN_MEMORY_JOB_KEYS) {
      return;
    }

    const overflow = enqueuedJobKeys.size - MAX_IN_MEMORY_JOB_KEYS;
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
    enqueue: async (job) => {
      const nowMs = Date.now();
      pruneJobKeys(nowMs);

      if (enqueuedJobKeys.has(job.jobKey)) {
        return {
          status: 'duplicate',
        } satisfies ReminderQueueEnqueueResult;
      }

      enqueuedJobKeys.set(job.jobKey, nowMs);
      logger.info(`[worker] queued reminder occurrence ${job.eventId}`);

      if (onEnqueue) {
        await onEnqueue(job);
      }

      return {
        status: 'enqueued',
      } satisfies ReminderQueueEnqueueResult;
    },
  };
};

export const createInFlightPushJobTracker = (): Readonly<{
  track: (promise: Promise<void>) => void;
  hasInFlight: () => boolean;
  waitForAll: () => Promise<void>;
}> => {
  const inFlightPushJobs = new Set<Promise<void>>();

  return {
    track: (promise) => {
      inFlightPushJobs.add(promise);
      void promise.finally(() => {
        inFlightPushJobs.delete(promise);
      });
    },
    hasInFlight: () => inFlightPushJobs.size > 0,
    waitForAll: async () => {
      if (inFlightPushJobs.size === 0) {
        return;
      }

      await Promise.allSettled([...inFlightPushJobs]);
    },
  };
};

export const createPgBossAdapter = (options: PgBossAdapterOptions = {}): WorkerAdapter => {
  const logger = options.logger ?? defaultLogger;
  const scheduler = options.scheduler ?? defaultScheduler;
  const now = options.now ?? (() => new Date());
  const setTimeoutFn =
    scheduler.setTimeout ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimeoutFn =
    scheduler.clearTimeout ??
    ((handle: NodeJS.Timeout) => {
      clearTimeout(handle);
    });
  const dispatchIntervalMs = options.dispatchIntervalMs ?? 60_000;
  if (!Number.isInteger(dispatchIntervalMs) || dispatchIntervalMs <= 0) {
    throw new Error('dispatchIntervalMs must be a positive integer');
  }
  const maxConcurrentPushDispatches = options.maxConcurrentPushDispatches ?? 20;
  if (!Number.isInteger(maxConcurrentPushDispatches) || maxConcurrentPushDispatches <= 0) {
    throw new Error('maxConcurrentPushDispatches must be a positive integer');
  }
  const deviceTokensRepository = options.deviceTokensRepository ?? createDeviceTokensRepository();
  const terminalFailures: PushTerminalFailureRecord[] = [];
  const terminalFailureRecorder =
    options.terminalFailureRecorder ??
    ({
      record: async (failure) => {
        terminalFailures.push(failure);
        logger.error(
          `[worker] terminal push failure token=${failure.tokenIdentity} reason=${failure.reason}`,
        );
      },
    } satisfies PushTerminalFailureRecorder);

  let status: WorkerRuntimeStatus = 'idle';
  let stopRequested = false;
  let acceptingDispatchWork = false;
  let acceptingRetryWork = false;
  const inFlightPushJobs = createInFlightPushJobTracker();
  let pushRetriesScheduled = 0;
  let pushRetriesExecuted = 0;
  const scheduledPushRetryHandles = new Set<NodeJS.Timeout>();
  let pushJobHandlerRef: PushJobHandler | null = null;
  let activePushDispatches = 0;
  const pushDispatchWaiters: Array<() => void> = [];

  const waitForPushDispatchSlot = async (): Promise<void> => {
    while (activePushDispatches >= maxConcurrentPushDispatches) {
      await new Promise<void>((resolve) => {
        pushDispatchWaiters.push(resolve);
      });
    }

    activePushDispatches += 1;
  };

  const releasePushDispatchSlot = (): void => {
    activePushDispatches = Math.max(0, activePushDispatches - 1);
    const nextWaiter = pushDispatchWaiters.shift();
    if (nextWaiter) {
      nextWaiter();
    }
  };

  const drainPushDispatchWaiters = (): void => {
    while (pushDispatchWaiters.length > 0) {
      const waiter = pushDispatchWaiters.shift();
      if (waiter) {
        waiter();
      }
    }
  };

  const queue =
    options.queue ??
    createInMemoryDispatchQueue(logger, async (job) => {
      if (!acceptingDispatchWork || status !== 'running' || pushJobHandlerRef === null) {
        return;
      }

      await waitForPushDispatchSlot();

      if (!acceptingDispatchWork || status !== 'running' || pushJobHandlerRef === null) {
        releasePushDispatchSlot();
        return;
      }

      const pushDispatch = (async () => {
        const tokens = await deviceTokensRepository.listByUserId(job.userId);

        if (tokens.length === 0) {
          logger.info(
            `[worker] no device tokens for reminder event ${job.eventId}; skipping push dispatch`,
          );
          return;
        }

        const result = await pushJobHandlerRef.handle({
          userId: job.userId,
          reminderId: job.noteId,
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

        logger.info(
          `[worker] push dispatch completed event=${job.eventId} processed=${result.processed} delivered=${result.delivered} retries=${result.retriesScheduled} terminalFailures=${result.terminalFailures}`,
        );
      })()
        .catch((error) => {
          logger.error(`[worker] push dispatch failed for event=${job.eventId}`, error);
        })
        .finally(() => {
          releasePushDispatchSlot();
        });

      inFlightPushJobs.track(pushDispatch);
    });

  const scanner = options.scanner ?? createDueReminderScanner();
  const cronStateRepository = options.cronStateRepository ?? createCronStateRepository();
  const dispatchJob =
    options.dispatchJob ??
    createReminderDispatchJob({
      scanner,
      cronStateRepository,
      queue,
      now,
    });

  const pushRetryScheduler =
    options.pushRetryScheduler ??
    ({
      scheduleRetry: async ({ delayMs, job, jobKey }) => {
        if (!acceptingRetryWork || status !== 'running') {
          return;
        }

        pushRetriesScheduled += 1;
        logger.info(
          `[worker] scheduled push retry job=${jobKey} delay=${Math.round(delayMs / 1000)}s`,
        );

        /* eslint-disable prefer-const -- TDZ-safe self-reference for callback cleanup. */
        let retryHandle: NodeJS.Timeout;
        retryHandle = setTimeoutFn(() => {
          scheduledPushRetryHandles.delete(retryHandle);

          if (!acceptingRetryWork || status !== 'running' || pushJobHandlerRef === null) {
            return;
          }

          pushRetriesExecuted += 1;
          const retryPromise = (async () => {
            try {
              await pushJobHandlerRef.handle({
                userId: job.userId,
                reminderId: job.reminderId,
                changeEventId: job.changeEventId,
                isTrigger: job.isTrigger,
                attempt: job.attempt,
                tokens: [job.token],
                title: job.title,
                body: job.body,
              });
            } catch (error) {
              logger.error(`[worker] push retry execution failed for job=${jobKey}`, error);
            }
          })();

          inFlightPushJobs.track(retryPromise);

          void retryPromise;
        }, delayMs);
        /* eslint-enable prefer-const */

        scheduledPushRetryHandles.add(retryHandle);
      },
    } satisfies PushRetryScheduler);

  const pushJobHandler =
    options.pushJobHandler ??
    createPushJobHandler({
      deliveryService: createPushDeliveryService({
        provider: options.pushProvider ?? createFcmPushProvider(),
      }),
      deviceTokensRepository,
      retryScheduler: pushRetryScheduler,
      terminalFailureRecorder,
    });

  pushJobHandlerRef = pushJobHandler;

  let dispatchTimerHandle: NodeJS.Timeout | null = null;
  let inFlightDispatch: Promise<void> | null = null;
  let lastDispatchAt: string | null = null;
  let lastDispatchError: string | null = null;
  let skippedTicks = 0;

  const toSnapshot = (nextStatus: WorkerRuntimeStatus): WorkerHealthSnapshot => ({
    status: nextStatus,
    details: {
      dispatchIntervalMs,
      lastDispatchAt,
      lastDispatchError,
      dispatchInFlight: inFlightDispatch !== null,
      pushJobInFlight: inFlightPushJobs.hasInFlight(),
      skippedTicks,
      pushRetriesScheduled,
      pushRetriesExecuted,
      pushRetryTimersPending: scheduledPushRetryHandles.size,
      terminalPushFailures: terminalFailures.length,
    },
  });

  const runDispatchCycle = async (): Promise<void> => {
    if (status !== 'running') {
      return;
    }

    if (inFlightDispatch) {
      skippedTicks += 1;
      return;
    }

    inFlightDispatch = (async () => {
      try {
        const result = await dispatchJob.run();
        lastDispatchAt = result.now.toISOString();
        lastDispatchError = null;
        logger.info(
          `[worker] reminder dispatch completed scanned=${result.scanned} enqueued=${result.enqueued} duplicates=${result.duplicates}`,
        );
      } catch (error) {
        lastDispatchError = error instanceof Error ? error.message : String(error);
        logger.error('[worker] reminder dispatch failed', error);
      } finally {
        inFlightDispatch = null;
      }
    })();

    await inFlightDispatch;
  };

  const scheduleNextDispatchCycle = (): void => {
    if (status !== 'running' || stopRequested) {
      return;
    }

    const delayMs = resolveDelayToNextBoundaryMs(now().getTime(), dispatchIntervalMs);
    dispatchTimerHandle = setTimeoutFn(() => {
      dispatchTimerHandle = null;
      void runDispatchCycle().finally(() => {
        scheduleNextDispatchCycle();
      });
    }, delayMs);
  };

  return {
    name: 'pg-boss-adapter',
    start: async () => {
      if (status === 'running') {
        return;
      }

      stopRequested = false;
      acceptingDispatchWork = true;
      acceptingRetryWork = true;
      status = 'running';
      logger.info('[worker] adapter started (dispatch + push handlers enabled)');

      scheduleNextDispatchCycle();

      void runDispatchCycle();
    },
    stop: async () => {
      if (status === 'stopped') {
        return;
      }

      // Stop accepting new retry work immediately, but let in-flight dispatch finish
      // and enqueue corresponding push sends before we stop dispatch acceptance.
      stopRequested = true;
      acceptingRetryWork = false;

      if (dispatchTimerHandle) {
        clearTimeoutFn(dispatchTimerHandle);
        dispatchTimerHandle = null;
      }

      for (const retryHandle of scheduledPushRetryHandles) {
        clearTimeoutFn(retryHandle);
      }

      scheduledPushRetryHandles.clear();

      if (inFlightDispatch) {
        await inFlightDispatch;
      }

      acceptingDispatchWork = false;
      drainPushDispatchWaiters();

      await inFlightPushJobs.waitForAll();

      // Clear any retry timers that might have been added while waiting for in-flight jobs.
      for (const retryHandle of scheduledPushRetryHandles) {
        clearTimeoutFn(retryHandle);
      }

      scheduledPushRetryHandles.clear();
      drainPushDispatchWaiters();

      status = 'stopped';
      logger.info('[worker] adapter stopped');
    },
    health: async () => toSnapshot(status),
  };
};
