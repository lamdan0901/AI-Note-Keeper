import type { SubscriptionsService } from "@backend/subscriptions/service";

import type { SubscriptionsHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type TrashSubscriptionResult = Readonly<{
  deleted: boolean;
}>;

export const createTrashSubscriptionHandler = (
  subscriptionsService: SubscriptionsService,
): SubscriptionsHandler<TrashSubscriptionResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { subscriptionId } = ctx.params;
    const deleted = await subscriptionsService.trash({ subscriptionId, userId });
    return { deleted };
  };
};