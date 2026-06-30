import type { DeviceTokenRecord } from "@backend/device-tokens/contracts.js";
import type { DeviceTokensService } from "@backend/device-tokens/service";
import { AppError } from "@backend/middleware/error-middleware";

export type DeviceTokensServiceDouble = DeviceTokensService &
  Readonly<{ tokens: Map<string, DeviceTokenRecord> }>;

/**
 * Stateful in-memory DeviceTokensService double mirroring backend route contract tests.
 */
export const createDeviceTokensServiceDouble = (): DeviceTokensServiceDouble => {
  const tokens = new Map<string, DeviceTokenRecord>();

  return {
    tokens,
    upsert: async ({ userId, deviceId, fcmToken, platform }) => {
      if (platform !== "android") {
        throw new Error("Only android platform is supported for device tokens");
      }

      const existing = tokens.get(deviceId);
      const now = new Date();
      const record: DeviceTokenRecord = {
        id: existing?.id ?? `${userId}:${deviceId}`,
        userId,
        deviceId,
        fcmToken,
        platform: "android",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      tokens.set(deviceId, record);
      return record;
    },

    deleteByDeviceId: async ({ userId, deviceId }) => {
      const existing = tokens.get(deviceId);
      if (!existing) {
        return false;
      }

      if (existing.userId !== userId) {
        throw new AppError({
          code: "forbidden",
          message: "Device token does not belong to authenticated user",
        });
      }

      tokens.delete(deviceId);
      return true;
    },
  };
};