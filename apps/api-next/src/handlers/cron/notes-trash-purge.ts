import { NextRequest, NextResponse } from "next/server";

import { verifyCronAuth } from "@/http/auth/require-cron";
import { toErrorResponse } from "@/http/errors";
import type { NotesTrashPurgeJob } from "@/server/notes-trash-purge";

export type NotesTrashPurgeCronHandlerDeps = Readonly<{
  purgeJob: NotesTrashPurgeJob;
  verifyCronAuth?: (headers: Headers) => void;
}>;

export const createNotesTrashPurgeCronHandler = (deps: NotesTrashPurgeCronHandlerDeps) => {
  const authorize = deps.verifyCronAuth ?? verifyCronAuth;

  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      authorize(request.headers);
      const summary = await deps.purgeJob.run();
      return NextResponse.json(summary, { status: 200 });
    } catch (error) {
      return toErrorResponse(error, request);
    }
  };
};
