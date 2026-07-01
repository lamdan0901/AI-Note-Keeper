import { NextRequest, NextResponse } from "next/server";

import { createScheduledTaskPostHandler } from "@/handlers/internal/scheduled-task-post";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const services = (await getComposedServices());
  const executor = services.reminderScheduledTaskExecutor;
  const verifierConfig = services.reminderQstashVerifierConfig;

  if (!executor || !verifierConfig) {
    return NextResponse.json(
      { code: "not_found", message: "Not found", status: 404 },
      { status: 404 },
    );
  }

  const postHandler = createScheduledTaskPostHandler({ executor, verifierConfig });
  return postHandler(request);
}