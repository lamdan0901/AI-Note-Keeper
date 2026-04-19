import { Router } from 'express';
import { z } from 'zod';

import { requireAccessUser, type AuthenticatedRequest } from '../auth/access-middleware.js';
import { validateRequest, withErrorBoundary } from '../middleware/validate.js';
import { createDeviceTokensService, type DeviceTokensService } from './service.js';

const upsertBodySchema = z.object({
  deviceId: z.string().min(1),
  fcmToken: z.string().min(1),
  platform: z.literal('android'),
});

const deviceIdParamsSchema = z.object({
  deviceId: z.string().min(1),
});

const getUserId = (request: AuthenticatedRequest): string => {
  return request.authUser.userId;
};

export const createDeviceTokensRoutes = (
  service: DeviceTokensService = createDeviceTokensService(),
): Router => {
  const router = Router();

  router.post(
    '/',
    requireAccessUser(),
    validateRequest({ body: upsertBodySchema }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const body = request.body as Readonly<{ deviceId: string; fcmToken: string; platform: 'android' }>;

      const token = await service.upsert({
        userId,
        deviceId: body.deviceId,
        fcmToken: body.fcmToken,
        platform: body.platform,
      });

      response.status(200).json({ token });
    }),
  );

  router.delete(
    '/:deviceId',
    requireAccessUser(),
    validateRequest({ params: deviceIdParamsSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const { deviceId } = request.params as Readonly<{ deviceId: string }>;
      const deleted = await service.deleteByDeviceId({ userId, deviceId });
      response.status(200).json({ deleted });
    }),
  );

  return router;
};
