import type { WorkerAdapter, WorkerHealthSnapshot, WorkerRuntimeStatus } from './contracts.js';
import { createCronStateRepository } from '../jobs/reminders/cron-state-repository.js';
import { createReminderDispatchJob, type ReminderDispatchJob } from '../jobs/reminders/dispatch-due-reminders.js';
import { createDueReminderScanner } from '../jobs/reminders/due-reminder-scanner.js';
import type {
  CronStateRepository,
  DueReminderScanner,
  ReminderDispatchQueue,
  ReminderQueueEnqueueResult,
} from '../jobs/reminders/contracts.js';

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
  }>;
  queue?: ReminderDispatchQueue;
  scanner?: DueReminderScanner;
  cronStateRepository?: CronStateRepository;
  dispatchJob?: ReminderDispatchJob;
  now?: () => Date;
}>;

const defaultScheduler: Readonly<{
  setInterval: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearInterval: (handle: NodeJS.Timeout) => void;
}> = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle),
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

export const createPgBossAdapter = (options: PgBossAdapterOptions = {}): WorkerAdapter => {
  const logger = options.logger ?? defaultLogger;
  const scheduler = options.scheduler ?? defaultScheduler;
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

  let status: WorkerRuntimeStatus = 'idle';
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
      skippedTicks,
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
      logger.info('[worker] adapter started (dispatch enabled)');

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

      if (inFlightDispatch) {
        await inFlightDispatch;
      }

      status = 'stopped';
      logger.info('[worker] adapter stopped');
    },
    health: async () => toSnapshot(status),
  };
};
