import type { DeviceTokenRecord } from "@backend/device-tokens/contracts.js";
import type { DeviceTokensService } from "@backend/device-tokens/service";

import type { DeviceTokensHandler, UpsertBody } from "./shared";
import { requireAuthUserId } from "./shared";

type UpsertDeviceTokenResult = Readonly<{
  token: DeviceTokenRecord;
}>;

export const createUpsertDeviceTokenHandler = (
  deviceTokensService: DeviceTokensService,
): DeviceTokensHandler<UpsertDeviceTokenResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const body = ctx.body as UpsertBody;

    const token = await deviceTokensService.upsert({
      userId,
      deviceId: body.deviceId,
      fcmToken: body.fcmToken,
      platform: body.platform,
    });

    return { token };
  };
};