import { pathToFileURL } from 'node:url';

import cors from 'cors';
import express from 'express';

import { config } from './config.js';
import { pool } from './db/pool.js';
import { createDependencyGate, createHealthStatus } from './health.js';
import { evaluateReadiness, type ReadinessStatus } from './health/readiness.js';
import { errorMiddleware, notFoundMiddleware } from './middleware/error-middleware.js';
import { withErrorBoundary } from './middleware/validate.js';

type AppFactoryOptions = Readonly<{
  readinessProbe?: () => Promise<ReadinessStatus>;
  isDependencyDegraded?: () => boolean;
}>;

type StartServerOptions = Readonly<{
  port?: number;
  readinessProbe?: () => Promise<ReadinessStatus>;
  onDependencyDegraded?: (error: Error) => void;
}>;

const createDefaultReadinessProbe = (isDependencyDegraded: () => boolean): (() => Promise<ReadinessStatus>) => {
  return () =>
    evaluateReadiness({
      queryClient: pool,
      dependencyDegraded: isDependencyDegraded(),
    });
};

const isMainModule = (): boolean => {
  const executedPath = process.argv[1];

  if (!executedPath) {
    return false;
  }

  return pathToFileURL(executedPath).href === import.meta.url;
};

export const createApp = (options: AppFactoryOptions = {}): express.Express => {
  const app = express();
  const isDependencyDegraded = options.isDependencyDegraded ?? (() => false);
  const readinessProbe = options.readinessProbe ?? createDefaultReadinessProbe(isDependencyDegraded);

  app.use(cors());
  app.use(express.json());

  app.get('/health/live', (_request, response) => {
    response.json(createHealthStatus());
  });

  app.get(
    '/health/ready',
    withErrorBoundary(async (_request, response) => {
      const readiness = await readinessProbe();
      response.status(readiness.ok ? 200 : 503).json(readiness);
    }),
  );

  app.use('/api', createDependencyGate(isDependencyDegraded));

  app.get('/api/sample', (_request, response) => {
    response.json({ message: 'Hello from the backend API!' });
  });

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
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

export const startServer = async (options: StartServerOptions = {}): Promise<express.Express> => {
  await runInitialStartupChecks(options.readinessProbe);

  let dependencyDegraded = false;

  pool.removeAllListeners('error');
  pool.on('error', (error) => {
    dependencyDegraded = true;

    if (options.onDependencyDegraded) {
      options.onDependencyDegraded(error as Error);
      return;
    }

    console.error('[backend] database dependency degraded', error);
  });

  const app = createApp({
    isDependencyDegraded: () => dependencyDegraded,
    readinessProbe: () =>
      evaluateReadiness({
        queryClient: pool,
        dependencyDegraded,
      }),
  });

  const port = options.port ?? config.PORT;

  await new Promise<void>((resolve) => {
    app.listen(port, () => {
      console.log(`[backend] listening on http://localhost:${port}`);
      resolve();
    });
  });

  return app;
};

if (isMainModule()) {
  startServer().catch((error) => {
    console.error('[backend] startup failed', error);
    process.exit(1);
  });
}