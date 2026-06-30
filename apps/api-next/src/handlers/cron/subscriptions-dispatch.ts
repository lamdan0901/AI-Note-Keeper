import { NextRequest, NextResponse } from "next/server";

import type { SubscriptionReminderDispatchJob } from "@backend/jobs/subscriptions/dispatch-due-subscription-reminders";

import { verifyCronAuth } from "@/http/auth/require-cron";
import { toErrorResponse } from "@/http/errors";

export type SubscriptionsDispatchCronHandlerDeps = Readonly<{
  dispatchJob: SubscriptionReminderDispatchJob;
  verifyCronAuth?: (headers: Headers) => void;
}>;

export const createSubscriptionsDispatchCronHandler = (
  deps: SubscriptionsDispatchCronHandlerDeps,
) => {
  const authorize = deps.verifyCronAuth ?? verifyCronAuth;

  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      authorize(request.headers);
      const summary = await deps.dispatchJob.run();
      return NextResponse.json(summary, { status: 200 });
    } catch (error) {
      return toErrorResponse(error, request);
    }
  };
};