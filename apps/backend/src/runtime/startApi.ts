import { type Server } from 'node:net';

import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { evaluateReadiness, type ReadinessStatus } from '../health/readiness.js';
import { createApiServer } from './createApiServer.js';

type ApiLogger = Readonly<{
  info: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}>;

export type StartApiRuntimeOptions = Readonly<{
  port?: number;
  readinessProbe?: () => Promise<ReadinessStatus>;
  onDependencyDegraded?: (error: Error) => void;
  logger?: ApiLogger;
}>;

const defaultLogger: ApiLogger = {
  info: (message) => {
    console.log(message);
  },
  error: (message, error) => {
    console.error(message, error);
  },
};

const createDefaultReadinessProbe = (isDependencyDegraded: () => boolean): (() => Promise<ReadinessStatus>) => {
  return () =>
    evaluateReadiness({
      queryClient: pool,
      dependencyDegraded: isDependencyDegraded(),
    });
};

export const runInitialStartupChecks = async (
  readinessProbe: () => Promise<ReadinessStatus> = () =>
    evaluateReadiness({
      queryClient: pool,
      dependencyDegraded: false,
    }),
): Promise<void> => {
  const readiness = await readinessProbe();

  if (!readiness.ok) {
    throw new Error('Initial readiness check failed: database connectivity and schema_migrations are required.');
  }
};

export const startApiRuntime = async (options: StartApiRuntimeOptions = {}): Promise<Server> => {
  const logger = options.logger ?? defaultLogger;
  await runInitialStartupChecks(options.readinessProbe);

  let dependencyDegraded = false;

  pool.removeAllListeners('error');
  pool.on('error', (error) => {
    dependencyDegraded = true;

    if (options.onDependencyDegraded) {
      options.onDependencyDegraded(error as Error);
      return;
    }

    logger.error('[backend] database dependency degraded', error);
  });

  const app = createApiServer({
    isDependencyDegraded: () => dependencyDegraded,
    readinessProbe: createDefaultReadinessProbe(() => dependencyDegraded),
  });

  const port = options.port ?? config.PORT;

  return await new Promise<Server>((resolve) => {
    const server = app.listen(port, () => {
      logger.info(`[backend] API listening on http://localhost:${port}`);
      resolve(server);
    });
  });
};
