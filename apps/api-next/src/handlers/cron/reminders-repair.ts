import { NextRequest, NextResponse } from "next/server";

import { verifyCronAuth } from "@/http/auth/require-cron";
import { toErrorResponse } from "@/http/errors";
import type { ReminderRepairJob } from "@/server/reminder-repair";

export type RemindersRepairCronHandlerDeps = Readonly<{
  repairJob: ReminderRepairJob;
  verifyCronAuth?: (headers: Headers) => void;
}>;

export const createRemindersRepairCronHandler = (deps: RemindersRepairCronHandlerDeps) => {
  const authorize = deps.verifyCronAuth ?? verifyCronAuth;

  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      authorize(request.headers);
      const summary = await deps.repairJob.run();
      return NextResponse.json(summary, { status: 200 });
    } catch (error) {
      return toErrorResponse(error, request);
    }
  };
};