import type { SubscriptionRecord } from "@backend/subscriptions/contracts.js";
import type { SubscriptionsService } from "@backend/subscriptions/service";

import type { CreateSubscriptionBody, SubscriptionsHandler } from "./shared";
import { requireAuthUserId, toDateOrNull } from "./shared";

type CreateSubscriptionResult = Readonly<{
  subscription: SubscriptionRecord;
}>;

export const createCreateSubscriptionHandler = (
  subscriptionsService: SubscriptionsService,
): SubscriptionsHandler<CreateSubscriptionResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const body = ctx.body as CreateSubscriptionBody;

    const subscription = await subscriptionsService.create({
      userId,
      serviceName: body.serviceName,
      category: body.category,
      price: body.price,
      currency: body.currency,
      billingCycle: body.billingCycle,
      billingCycleCustomDays: body.billingCycleCustomDays ?? null,
      nextBillingDate: new Date(body.nextBillingDate),
      notes: body.notes ?? null,
      trialEndDate: toDateOrNull(body.trialEndDate),
      status: body.status,
      reminderDaysBefore: body.reminderDaysBefore,
    });

    return { subscription };
  };
};