import cors from 'cors';
import express from 'express';

import { createAuthRoutes } from '../auth/routes.js';
import type { AuthService } from '../auth/service.js';
import { createAiRoutes } from '../ai/routes.js';
import type { AiRateLimiter } from '../ai/rate-limit.js';
import type { AiService } from '../ai/service.js';
import { createDeviceTokensRoutes } from '../device-tokens/routes.js';
import type { DeviceTokensService } from '../device-tokens/service.js';
import { createDependencyGate, createHealthStatus } from '../health.js';
import { type ReadinessStatus } from '../health/readiness.js';
import { createMergeRoutes } from '../merge/routes.js';
import type { MergeService } from '../merge/service.js';
import { errorMiddleware, notFoundMiddleware } from '../middleware/error-middleware.js';
import { withErrorBoundary } from '../middleware/validate.js';
import { createNotesRoutes } from '../notes/routes.js';
import type { NotesService } from '../notes/service.js';
import { createRemindersRoutes } from '../reminders/routes.js';
import type { RemindersService } from '../reminders/service.js';
import { createSubscriptionsRoutes } from '../subscriptions/routes.js';
import type { SubscriptionsService } from '../subscriptions/service.js';

export type ApiServerFactoryOptions = Readonly<{
  readinessProbe?: () => Promise<ReadinessStatus>;
  isDependencyDegraded?: () => boolean;
  authService?: AuthService;
  notesService?: NotesService;
  remindersService?: RemindersService;
  subscriptionsService?: SubscriptionsService;
  deviceTokensService?: DeviceTokensService;
  mergeService?: MergeService;
  aiService?: AiService;
  aiRateLimiter?: AiRateLimiter;
}>;

const parseTrustProxySetting = (): boolean | number | string => {
  const raw = process.env.TRUST_PROXY;
  if (!raw) {
    return false;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'false' || normalized === 'off' || normalized === '0') {
    return false;
  }

  if (normalized === 'true' || normalized === 'on') {
    return 1;
  }

  if (/^\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }

  return raw;
};

export const createApiServer = (options: ApiServerFactoryOptions = {}): express.Express => {
  const app = express();
  const isDependencyDegraded = options.isDependencyDegraded ?? (() => false);
  const trustProxy = parseTrustProxySetting();

  app.set('trust proxy', trustProxy);

  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const defaultDevelopmentOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const effectiveAllowedOrigins =
    allowedOrigins.length > 0
      ? allowedOrigins
      : process.env.NODE_ENV === 'production'
        ? []
        : defaultDevelopmentOrigins;

  const isAllowedOrigin = (origin: string): boolean => {
    if (effectiveAllowedOrigins.length === 0) {
      return false;
    }

    return effectiveAllowedOrigins.includes(origin);
  };

  app.use(
    cors({
      credentials: true,
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }

        callback(null, isAllowedOrigin(origin));
      },
    }),
  );
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

  app.use('/api/auth', createAuthRoutes(options.authService));
  app.use('/api/notes', createNotesRoutes(options.notesService));
  app.use('/api/reminders', createRemindersRoutes(options.remindersService));
  app.use('/api/subscriptions', createSubscriptionsRoutes(options.subscriptionsService));
  app.use('/api/device-tokens', createDeviceTokensRoutes(options.deviceTokensService));
  app.use('/api/merge', createMergeRoutes(options.mergeService));
  app.use('/api/ai', createAiRoutes(options.aiService, options.aiRateLimiter));

  app.get('/api/sample', (_request, response) => {
    response.json({ message: 'Hello from the backend API!' });
  });

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
};
