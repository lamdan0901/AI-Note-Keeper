import cors from 'cors';
import express from 'express';

import { createDependencyGate, createHealthStatus } from '../health.js';
import { type ReadinessStatus } from '../health/readiness.js';
import { errorMiddleware, notFoundMiddleware } from '../middleware/error-middleware.js';
import { withErrorBoundary } from '../middleware/validate.js';

export type ApiServerFactoryOptions = Readonly<{
  readinessProbe?: () => Promise<ReadinessStatus>;
  isDependencyDegraded?: () => boolean;
}>;

export const createApiServer = (options: ApiServerFactoryOptions = {}): express.Express => {
  const app = express();
  const isDependencyDegraded = options.isDependencyDegraded ?? (() => false);

  app.use(cors());
  app.use(express.json());

  app.get('/health/live', (_request, response) => {
    response.json(createHealthStatus());
  });

  app.get(
    '/health/ready',
    withErrorBoundary(async (_request, response) => {
      if (!options.readinessProbe) {
        throw new Error('readinessProbe is required for /health/ready route.');
      }

      const readiness = await options.readinessProbe();
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
