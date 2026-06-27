import type { SubscriptionRecord } from "@backend/subscriptions/contracts.js";
import type { SubscriptionsService } from "@backend/subscriptions/service";

import type { SubscriptionsHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type ListTrashedSubscriptionsResult = Readonly<{
  subscriptions: ReadonlyArray<SubscriptionRecord>;
}>;

export const createListTrashedSubscriptionsHandler = (
  subscriptionsService: SubscriptionsService,
): SubscriptionsHandler<ListTrashedSubscriptionsResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const subscriptions = await subscriptionsService.listTrashed({ userId });
    return { subscriptions };
  };
};