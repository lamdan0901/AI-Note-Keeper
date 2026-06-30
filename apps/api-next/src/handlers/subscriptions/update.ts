import type { SubscriptionRecord } from "@backend/subscriptions/contracts.js";
import type { SubscriptionsService } from "@backend/subscriptions/service";

import type { SubscriptionsHandler, UpdateSubscriptionBody } from "./shared";
import { buildUpdatePatch, requireAuthUserId } from "./shared";

type UpdateSubscriptionResult = Readonly<{
  subscription: SubscriptionRecord;
}>;

export const createUpdateSubscriptionHandler = (
  subscriptionsService: SubscriptionsService,
): SubscriptionsHandler<UpdateSubscriptionResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { subscriptionId } = ctx.params;
    const body = ctx.body as UpdateSubscriptionBody;

    const subscription = await subscriptionsService.update({
      subscriptionId,
      userId,
      patch: buildUpdatePatch(body),
    });

    return { subscription };
  };
};