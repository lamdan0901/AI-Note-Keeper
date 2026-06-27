import type { SubscriptionRecord } from "@backend/subscriptions/contracts.js";
import type { SubscriptionsService } from "@backend/subscriptions/service";

import type { SubscriptionsHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type ListSubscriptionsResult = Readonly<{
  subscriptions: ReadonlyArray<SubscriptionRecord>;
}>;

export const createListSubscriptionsHandler = (
  subscriptionsService: SubscriptionsService,
): SubscriptionsHandler<ListSubscriptionsResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const subscriptions = await subscriptionsService.list({ userId });
    return { subscriptions };
  };
};