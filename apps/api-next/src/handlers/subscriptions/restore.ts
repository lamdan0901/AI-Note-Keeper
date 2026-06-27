import type { SubscriptionsService } from "@backend/subscriptions/service";

import type { SubscriptionsHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type RestoreSubscriptionResult = Readonly<{
  restored: boolean;
}>;

export const createRestoreSubscriptionHandler = (
  subscriptionsService: SubscriptionsService,
): SubscriptionsHandler<RestoreSubscriptionResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { subscriptionId } = ctx.params;
    const restored = await subscriptionsService.restore({ subscriptionId, userId });
    return { restored };
  };
};