import { NextRequest, NextResponse } from "next/server";

import { createRemindersRepairCronHandler } from "@/handlers/cron/reminders-repair";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

/**
 * Reminder repair maintenance cron.
 *
 * Auth (not behind CORS or dependency gate):
 * - `Authorization: Bearer ${CRON_SECRET}` — set CRON_SECRET in env (see .env.example).
 * - No platform cron is configured; invoke manually or via Express worker / external scheduler.
 *
 * Returns `{ candidates, executed, scheduled }` from `@backend/reminders/repair-job`.
 */
const runRemindersRepairCron = async (request: NextRequest): Promise<NextResponse> => {
  const repairJob = getComposedServices().reminderRepairJob;

  if (!repairJob) {
    return NextResponse.json(
      { code: "not_found", message: "Not found", status: 404 },
      { status: 404 },
    );
  }

  const handler = createRemindersRepairCronHandler({ repairJob });
  return handler(request);
};

export const GET = runRemindersRepairCron;
export const POST = runRemindersRepairCron;