import { Router, type RequestHandler } from 'express';

import { AppError } from '../middleware/error-middleware.js';
import { validateRequest, withErrorBoundary } from '../middleware/validate.js';
import {
  authCredentialsSchema,
  clearAuthTransport,
  logoutSchema,
  refreshSchema,
  resolveRefreshToken,
  upgradeSessionSchema,
  writeAuthTransport,
} from './http.js';
import { createAuthService, type AuthService } from './service.js';

const toAuthError = (message: string): AppError => {
  return new AppError({ code: 'auth', message });
};

const toDeviceId = (value: unknown): string | null => {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

type RateLimitState = Readonly<{
  count: number;
  resetAt: number;
}>;

const createAuthRateLimiter = (
  input: Readonly<{ maxRequests: number; windowMs: number }>,
): RequestHandler => {
  const byIp = new Map<string, RateLimitState>();
  const maxEntries = 5_000;
  let requestCounter = 0;

  const evictExpiredEntries = (now: number): void => {
    for (const [key, state] of byIp.entries()) {
      if (state.resetAt <= now) {
        byIp.delete(key);
      }
    }
  };

  const evictOldestWhenCapped = (): void => {
    if (byIp.size < maxEntries) {
      return;
    }

    const oldestKey = byIp.keys().next().value;
    if (typeof oldestKey === 'string') {
      byIp.delete(oldestKey);
    }
  };

  return (request, _response, next) => {
    const now = Date.now();
    requestCounter += 1;

    if (requestCounter % 100 === 0) {
      evictExpiredEntries(now);
    }

    const key = request.ip ?? 'unknown-ip';
    const existing = byIp.get(key);

    if (!existing || now >= existing.resetAt) {
      evictOldestWhenCapped();
      byIp.set(key, {
        count: 1,
        resetAt: now + input.windowMs,
      });
      next();
      return;
    }

    if (existing.count >= input.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      next(
        new AppError({
          code: 'rate_limit',
          details: {
            retryAfterSeconds,
            resetAt: new Date(existing.resetAt).toISOString(),
          },
        }),
      );
      return;
    }

    byIp.set(key, {
      ...existing,
      count: existing.count + 1,
    });

    next();
  };
};

const registerRateLimit = createAuthRateLimiter({ maxRequests: 20, windowMs: 60_000 });
const loginRateLimit = createAuthRateLimiter({ maxRequests: 30, windowMs: 60_000 });
const refreshRateLimit = createAuthRateLimiter({ maxRequests: 60, windowMs: 60_000 });
const upgradeRateLimit = createAuthRateLimiter({ maxRequests: 15, windowMs: 60_000 });
const logoutRateLimit = createAuthRateLimiter({ maxRequests: 60, windowMs: 60_000 });

const buildAuthResponse = (
  input: Readonly<{
    userId: string;
    username: string;
    accessToken: string;
    transport: 'cookie' | 'json';
    refreshToken?: string;
  }>,
): Record<string, unknown> => {
  if (input.transport === 'json') {
    return {
      userId: input.userId,
      username: input.username,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      transport: input.transport,
    };
  }

  return {
    userId: input.userId,
    username: input.username,
    accessToken: input.accessToken,
    transport: input.transport,
  };
};

export const createAuthRoutes = (authService: AuthService = createAuthService()): Router => {
  const router = Router();

  router.post(
    '/register',
    registerRateLimit,
    validateRequest({ body: authCredentialsSchema }),
    withErrorBoundary(async (request, response) => {
      const body = request.body as {
        username: string;
        password: string;
        deviceId?: string;
        guestUserId?: string;
      };
      const session = await authService.register({
        username: body.username,
        password: body.password,
        deviceId: toDeviceId(body.deviceId),
        guestUserId: typeof body.guestUserId === 'string' ? body.guestUserId : undefined,
      });

      const transport = writeAuthTransport(request, response, session.tokens);

      response.status(201).json(
        buildAuthResponse({
          userId: session.userId,
          username: session.username,
          accessToken: session.tokens.accessToken,
          refreshToken: transport.transport === 'json' ? session.tokens.refreshToken : undefined,
          transport: transport.transport,
        }),
      );
    }),
  );

  router.post(
    '/login',
    loginRateLimit,
    validateRequest({ body: authCredentialsSchema }),
    withErrorBoundary(async (request, response) => {
      const body = request.body as { username: string; password: string; deviceId?: string };
      const session = await authService.login({
        username: body.username,
        password: body.password,
        deviceId: toDeviceId(body.deviceId),
      });

      const transport = writeAuthTransport(request, response, session.tokens);

      response.status(200).json(
        buildAuthResponse({
          userId: session.userId,
          username: session.username,
          accessToken: session.tokens.accessToken,
          refreshToken: transport.transport === 'json' ? session.tokens.refreshToken : undefined,
          transport: transport.transport,
        }),
      );
    }),
  );

  router.post(
    '/refresh',
    refreshRateLimit,
    validateRequest({ body: refreshSchema }),
    withErrorBoundary(async (request, response) => {
      const body = request.body as { refreshToken?: string; deviceId?: string };
      const refreshToken = resolveRefreshToken(request, body.refreshToken);

      if (!refreshToken) {
        throw toAuthError('Refresh token is required');
      }

      const session = await authService.refresh({
        refreshToken,
        deviceId: toDeviceId(body.deviceId),
      });

      const transport = writeAuthTransport(request, response, session.tokens);

      response.status(200).json(
        buildAuthResponse({
          userId: session.userId,
          username: session.username,
          accessToken: session.tokens.accessToken,
          refreshToken: transport.transport === 'json' ? session.tokens.refreshToken : undefined,
          transport: transport.transport,
        }),
      );
    }),
  );

  router.post(
    '/logout',
    logoutRateLimit,
    validateRequest({ body: logoutSchema }),
    withErrorBoundary(async (request, response) => {
      const body = request.body as { refreshToken?: string };
      const refreshToken = resolveRefreshToken(request, body.refreshToken);

      if (!refreshToken) {
        throw toAuthError('Refresh token is required');
      }

      await authService.logout({ refreshToken });
      clearAuthTransport(request, response);
      response.status(204).send();
    }),
  );

  router.post(
    '/upgrade-session',
    upgradeRateLimit,
    validateRequest({ body: upgradeSessionSchema }),
    withErrorBoundary(async (request, response) => {
      const body = request.body as {
        userId: string;
        legacySessionToken?: string;
        deviceId?: string;
      };
      const session = await authService.upgradeSession({
        userId: body.userId,
        legacySessionToken: body.legacySessionToken,
        deviceId: toDeviceId(body.deviceId),
      });

      const transport = writeAuthTransport(request, response, session.tokens);

      response.status(200).json(
        buildAuthResponse({
          userId: session.userId,
          username: session.username,
          accessToken: session.tokens.accessToken,
          refreshToken: transport.transport === 'json' ? session.tokens.refreshToken : undefined,
          transport: transport.transport,
        }),
      );
    }),
  );

  return router;
};
