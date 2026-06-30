import { NextResponse } from "next/server";

import { createReadinessProbe } from "@/server/startup";
import { withApiHandler } from "@/http/with-api-handler";

export const runtime = "nodejs";

const readinessProbe = createReadinessProbe();

const healthReadyHandler = withApiHandler(async () => {
  const readiness = await readinessProbe();

  return NextResponse.json(readiness, {
    status: readiness.ok ? 200 : 503,
  });
});

export const GET = healthReadyHandler;
export const OPTIONS = healthReadyHandler;