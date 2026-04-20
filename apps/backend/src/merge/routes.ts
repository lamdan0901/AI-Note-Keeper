import { Router } from 'express';

import { requireAccessUser, type AuthenticatedRequest } from '../auth/access-middleware.js';
import { AppError } from '../middleware/error-middleware.js';
import { validateRequest, withErrorBoundary } from '../middleware/validate.js';
import {
  mergeApplyBodySchema,
  mergePreflightBodySchema,
  type MergeApplyBody,
  type MergePreflightBody,
} from './contracts.js';
import { createMergeService, type MergeService } from './service.js';

const requireUserId = (request: AuthenticatedRequest): string => {
  return request.authUser.userId;
};

const remapRateLimitError = (error: unknown): never => {
  if (error instanceof AppError && error.code === 'rate_limit') {
    throw new AppError({
      code: 'rate_limit',
      details: {
        retryAfterSeconds: error.details?.retryAfterSeconds,
        resetAt: error.details?.resetAt,
      },
    });
  }

  throw error;
};

export const createMergeRoutes = (service: MergeService = createMergeService()): Router => {
  const router = Router();

  router.post(
    '/preflight',
    requireAccessUser(),
    validateRequest({ body: mergePreflightBodySchema }),
    withErrorBoundary(async (request, response) => {
      const authRequest = request as AuthenticatedRequest;
      const body = request.body as MergePreflightBody;

      try {
        const result = await service.preflight({
          fromUserId: requireUserId(authRequest),
          toUserId: body.toUserId,
          username: body.username,
          password: body.password,
        });

        response.status(200).json(result);
      } catch (error) {
        remapRateLimitError(error);
      }
    }),
  );

  router.post(
    '/apply',
    requireAccessUser(),
    validateRequest({ body: mergeApplyBodySchema }),
    withErrorBoundary(async (request, response) => {
      const authRequest = request as AuthenticatedRequest;
      const body = request.body as MergeApplyBody;

      try {
        const result = await service.apply({
          fromUserId: requireUserId(authRequest),
          toUserId: body.toUserId,
          username: body.username,
          password: body.password,
          strategy: body.strategy,
        });

        response.status(200).json(result);
      } catch (error) {
        remapRateLimitError(error);
      }
    }),
  );

  return router;
};
