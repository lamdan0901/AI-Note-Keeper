import { AppError } from '../middleware/error-middleware.js';
import type { DeviceTokenRecord, DeviceTokenUpsertInput } from './contracts.js';
import {
  createDeviceTokensRepository,
  type DeviceTokensRepository,
} from './repositories/device-tokens-repository.js';

type DeviceTokensServiceDeps = Readonly<{
  repository?: DeviceTokensRepository;
}>;

export type DeviceTokensService = Readonly<{
  upsert: (input: DeviceTokenUpsertInput) => Promise<DeviceTokenRecord>;
  deleteByDeviceId: (input: Readonly<{ userId: string; deviceId: string }>) => Promise<boolean>;
}>;

const toForbiddenError = (): AppError => {
  return new AppError({
    code: 'forbidden',
    message: 'Device token does not belong to authenticated user',
  });
};

const toValidationError = (message: string): AppError => {
  return new AppError({
    code: 'validation',
    message,
  });
};

export const createDeviceTokensService = (
  deps: DeviceTokensServiceDeps = {},
): DeviceTokensService => {
  const repository = deps.repository ?? createDeviceTokensRepository();

  return {
    upsert: async ({ userId, deviceId, fcmToken, platform }) => {
      if (platform !== 'android') {
        throw toValidationError('Only android platform is supported for device tokens');
      }

      return await repository.upsertByDeviceId({ userId, deviceId, fcmToken, platform });
    },

    deleteByDeviceId: async ({ userId, deviceId }) => {
      const existing = await repository.findByDeviceId(deviceId);
      if (!existing) {
        return false;
      }

      if (existing.userId !== userId) {
        throw toForbiddenError();
      }

      return await repository.deleteByDeviceIdForUser({ userId, deviceId });
    },
  };
};
