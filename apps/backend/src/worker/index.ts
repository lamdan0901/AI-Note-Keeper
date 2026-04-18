import { pathToFileURL } from 'node:url';

import { createPgBossAdapter } from './boss-adapter.js';
import type { WorkerAdapter, WorkerBootstrap } from './contracts.js';

type WorkerLogger = Readonly<{
  info: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}>;

export type StartWorkerOptions = Readonly<{
  adapter?: WorkerAdapter;
  logger?: WorkerLogger;
  installSignalHandlers?: boolean;
}>;

const defaultLogger: WorkerLogger = {
  info: (message) => {
    console.log(message);
  },
  error: (message, error) => {
    console.error(message, error);
  },
};

const isMainModule = (): boolean => {
  const executedPath = process.argv[1];

  if (!executedPath) {
    return false;
  }

  return pathToFileURL(executedPath).href === import.meta.url;
};

const installShutdownHandlers = (shutdown: () => Promise<void>, logger: WorkerLogger): void => {
  const stopOnce = async (signal: string): Promise<void> => {
    logger.info(`[worker] received ${signal}; stopping worker`);
    await shutdown();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void stopOnce('SIGINT');
  });

  process.once('SIGTERM', () => {
    void stopOnce('SIGTERM');
  });
};

export const startWorker = async (options: StartWorkerOptions = {}): Promise<WorkerBootstrap> => {
  const logger = options.logger ?? defaultLogger;
  const adapter = options.adapter ?? createPgBossAdapter({ logger });

  await adapter.start();

  const shutdown = async (): Promise<void> => {
    await adapter.stop();
  };

  if (options.installSignalHandlers ?? true) {
    installShutdownHandlers(shutdown, logger);
  }

  logger.info(`[worker] runtime started with adapter: ${adapter.name}`);

  return {
    adapterName: adapter.name,
    shutdown,
  };
};

if (isMainModule()) {
  startWorker().catch((error) => {
    defaultLogger.error('[worker] startup failed', error);
    process.exit(1);
  });
}
