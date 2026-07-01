import { NextRequest, NextResponse } from "next/server";

import { createPushRetryPostHandler } from "@/handlers/internal/push-retry-post";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const services = (await getComposedServices());
  const pushJobHandler = services.pushJobHandler;
  const verifierConfig = services.pushQstashVerifierConfig;

  if (!pushJobHandler || !verifierConfig) {
    return NextResponse.json(
      { code: "not_found", message: "Not found", status: 404 },
      { status: 404 },
    );
  }

  const postHandler = createPushRetryPostHandler({ pushJobHandler, verifierConfig });
  return postHandler(request);
}