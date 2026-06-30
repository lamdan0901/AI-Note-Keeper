import { NextRequest, NextResponse } from "next/server";

import { createSubscriptionsDispatchCronHandler } from "@/handlers/cron/subscriptions-dispatch";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

/**
 * Subscription reminder dispatch cron.
 *
 * Vercel Cron entry (daily at 00:00 UTC): `0 0 * * *` → `/cron/subscriptions-dispatch`
 *
 * Auth (not behind CORS or dependency gate):
 * - Primary: `Authorization: Bearer ${CRON_SECRET}` — set CRON_SECRET in env (see .env.example).
 * - Secondary: `x-vercel-cron: 1` for Vercel Cron scheduled invocations.
 *
 * Returns `SubscriptionReminderDispatchRunResult` from
 * `@backend/jobs/subscriptions/dispatch-due-subscription-reminders`.
 */
const runSubscriptionsDispatchCron = async (request: NextRequest): Promise<NextResponse> => {
  const dispatchJob = getComposedServices().subscriptionReminderDispatchJob;

  if (!dispatchJob) {
    return NextResponse.json(
      { code: "not_found", message: "Not found", status: 404 },
      { status: 404 },
    );
  }

  const handler = createSubscriptionsDispatchCronHandler({ dispatchJob });
  return handler(request);
};

export const GET = runSubscriptionsDispatchCron;
export const POST = runSubscriptionsDispatchCron;