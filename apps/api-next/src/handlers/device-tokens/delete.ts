import type { DeviceTokensService } from "@backend/device-tokens/service";

import type { DeviceTokensHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type DeleteDeviceTokenResult = Readonly<{
  deleted: boolean;
}>;

export const createDeleteDeviceTokenHandler = (
  deviceTokensService: DeviceTokensService,
): DeviceTokensHandler<DeleteDeviceTokenResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { deviceId } = ctx.params;

    const deleted = await deviceTokensService.deleteByDeviceId({
      userId,
      deviceId,
    });

    return { deleted };
  };
};