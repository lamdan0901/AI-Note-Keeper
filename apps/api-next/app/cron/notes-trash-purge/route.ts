import { NextRequest, NextResponse } from "next/server";

import { createNotesTrashPurgeCronHandler } from "@/handlers/cron/notes-trash-purge";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

/**
 * Notes trash purge maintenance cron.
 *
 * Auth:
 * - `Authorization: Bearer ${CRON_SECRET}` — set CRON_SECRET in env.
 *
 * Drains the full overdue backlog in batches; returns
 * `{ scanned, deleted, batches, scheduleCancelFailures }` for soft-deleted notes
 * older than the trash retention window.
 */
const runNotesTrashPurgeCron = async (request: NextRequest): Promise<NextResponse> => {
  const purgeJob = (await getComposedServices()).notesTrashPurgeJob;
  const handler = createNotesTrashPurgeCronHandler({ purgeJob });
  return handler(request);
};

export const GET = runNotesTrashPurgeCron;
export const POST = runNotesTrashPurgeCron;
