import { Router } from 'express';

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
    validateRequest({ body: authCredentialsSchema }),
    withErrorBoundary(async (request, response) => {
      const body = request.body as { username: string; password: string; deviceId?: string };
      const session = await authService.register({
        username: body.username,
        password: body.password,
        deviceId: toDeviceId(body.deviceId),
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
    validateRequest({ body: logoutSchema }),
    withErrorBoundary(async (request, response) => {
      const body = request.body as { refreshToken?: string };
      const refreshToken = resolveRefreshToken(request, body.refreshToken);

      if (!refreshToken) {
        throw toAuthError('Refresh token is required');
      }

      await authService.logout({ refreshToken });
      clearAuthTransport(response);
      response.status(204).send();
    }),
  );

  router.post(
    '/upgrade-session',
    validateRequest({ body: upgradeSessionSchema }),
    withErrorBoundary(async (request, response) => {
      const body = request.body as { userId: string; deviceId?: string };
      const session = await authService.upgradeSession({
        userId: body.userId,
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
