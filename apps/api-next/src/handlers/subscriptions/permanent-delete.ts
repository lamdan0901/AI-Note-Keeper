import type { SubscriptionsService } from "@backend/subscriptions/service";

import type { SubscriptionsHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type PermanentDeleteSubscriptionResult = Readonly<{
  deleted: boolean;
}>;

export const createPermanentDeleteSubscriptionHandler = (
  subscriptionsService: SubscriptionsService,
): SubscriptionsHandler<PermanentDeleteSubscriptionResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { subscriptionId } = ctx.params;
    const deleted = await subscriptionsService.permanentlyDelete({ subscriptionId, userId });
    return { deleted };
  };
};