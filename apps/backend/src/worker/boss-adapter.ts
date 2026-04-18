import type { WorkerAdapter, WorkerHealthSnapshot, WorkerRuntimeStatus } from './contracts.js';

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
}>;

export const createPgBossAdapter = (options: PgBossAdapterOptions = {}): WorkerAdapter => {
  const logger = options.logger ?? defaultLogger;
  let status: WorkerRuntimeStatus = 'idle';

  const toSnapshot = (nextStatus: WorkerRuntimeStatus): WorkerHealthSnapshot => ({
    status: nextStatus,
  });

  return {
    name: 'pg-boss-adapter',
    start: async () => {
      if (status === 'running') {
        return;
      }

      status = 'running';
      logger.info('[worker] adapter started (scaffold)');
    },
    stop: async () => {
      if (status === 'stopped') {
        return;
      }

      status = 'stopped';
      logger.info('[worker] adapter stopped (scaffold)');
    },
    health: async () => toSnapshot(status),
  };
};
