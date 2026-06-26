import { createHealthStatus } from "@backend/health";

import { withApiHandler } from "@/http/with-api-handler";

export const runtime = "nodejs";

const healthLiveHandler = withApiHandler(async () => createHealthStatus());

export const GET = healthLiveHandler;
export const OPTIONS = healthLiveHandler;