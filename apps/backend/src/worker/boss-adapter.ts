import type { WorkerAdapter, WorkerHealthSnapshot, WorkerRuntimeStatus } from './contracts.js';
import { createCronStateRepository } from '../jobs/reminders/cron-state-repository.js';
import {
  createReminderDispatchJob,
  type ReminderDispatchJob,
} from '../jobs/reminders/dispatch-due-reminders.js';
import { createDueReminderScanner } from '../jobs/reminders/due-reminder-scanner.js';
import { createPushDeliveryService } from '../jobs/push/push-delivery-service.js';
import { createPushJobHandler, type PushJobHandler } from '../jobs/push/push-job-handler.js';
import type {
  CronStateRepository,
  DueReminderScanner,
  ReminderDispatchQueue,
  ReminderQueueEnqueueResult,
} from '../jobs/reminders/contracts.js';
import type {
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

const createInMemoryDispatchQueue = (logger: AdapterLogger): ReminderDispatchQueue => {
  const enqueuedJobKeys = new Set<string>();

  return {
    enqueue: async (job) => {
      if (enqueuedJobKeys.has(job.jobKey)) {
        return {
          status: 'duplicate',
        } satisfies ReminderQueueEnqueueResult;
      }

      enqueuedJobKeys.add(job.jobKey);
      logger.info(`[worker] queued reminder occurrence ${job.eventId}`);

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
  const setTimeoutFn =
    scheduler.setTimeout ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimeoutFn =
    scheduler.clearTimeout ??
    ((handle: NodeJS.Timeout) => {
      clearTimeout(handle);
    });
  const dispatchIntervalMs = options.dispatchIntervalMs ?? 60_000;
  const queue = options.queue ?? createInMemoryDispatchQueue(logger);
  const scanner = options.scanner ?? createDueReminderScanner();
  const cronStateRepository = options.cronStateRepository ?? createCronStateRepository();
  const dispatchJob =
    options.dispatchJob ??
    createReminderDispatchJob({
      scanner,
      cronStateRepository,
      queue,
      now: options.now,
    });
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
  const inFlightPushJobs = createInFlightPushJobTracker();
  let pushRetriesScheduled = 0;
  let pushRetriesExecuted = 0;
  const scheduledPushRetryHandles = new Set<NodeJS.Timeout>();
  let pushJobHandlerRef: PushJobHandler | null = null;

  const pushRetryScheduler =
    options.pushRetryScheduler ??
    ({
      scheduleRetry: async ({ delayMs, job, jobKey }) => {
        pushRetriesScheduled += 1;
        logger.info(
          `[worker] scheduled push retry job=${jobKey} delay=${Math.round(delayMs / 1000)}s`,
        );

        let retryHandle: NodeJS.Timeout;
        retryHandle = setTimeoutFn(() => {
          scheduledPushRetryHandles.delete(retryHandle);

          if (status !== 'running' || pushJobHandlerRef === null) {
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
              });
            } catch (error) {
              logger.error(`[worker] push retry execution failed for job=${jobKey}`, error);
            }
          })();

          inFlightPushJobs.track(retryPromise);

          void retryPromise;
        }, delayMs);

        scheduledPushRetryHandles.add(retryHandle);
      },
    } satisfies PushRetryScheduler);

  const pushJobHandler =
    options.pushJobHandler ??
    createPushJobHandler({
      deliveryService: createPushDeliveryService({
        provider: {
          sendToToken: async () => ({
            ok: true,
          }),
        },
      }),
      deviceTokensRepository: {
        deleteByDeviceIdForUser: async () => false,
      },
      retryScheduler: pushRetryScheduler,
      terminalFailureRecorder,
    });

  pushJobHandlerRef = pushJobHandler;

  let dispatchHandle: NodeJS.Timeout | null = null;
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

  return {
    name: 'pg-boss-adapter',
    start: async () => {
      if (status === 'running') {
        return;
      }

      status = 'running';
      logger.info('[worker] adapter started (dispatch + push handlers enabled)');

      dispatchHandle = scheduler.setInterval(() => {
        void runDispatchCycle();
      }, dispatchIntervalMs);

      void runDispatchCycle();
    },
    stop: async () => {
      if (status === 'stopped') {
        return;
      }

      if (dispatchHandle) {
        scheduler.clearInterval(dispatchHandle);
        dispatchHandle = null;
      }

      for (const retryHandle of scheduledPushRetryHandles) {
        clearTimeoutFn(retryHandle);
      }

      scheduledPushRetryHandles.clear();

      if (inFlightDispatch) {
        await inFlightDispatch;
      }

      await inFlightPushJobs.waitForAll();

      status = 'stopped';
      logger.info('[worker] adapter stopped');
    },
    health: async () => toSnapshot(status),
  };
};
