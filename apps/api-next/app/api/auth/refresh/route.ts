import { createRefreshHandler } from "@/handlers/auth/refresh";
import { refreshSchema } from "@/handlers/auth/shared";
import { createAuthPostHandler } from "@/http/auth/post-handler";
import { refreshRateLimit } from "@/http/auth/rate-limit";
import { withApiHandler } from "@/http/with-api-handler";
import { getAuthService } from "@/server/auth-service";

export const runtime = "nodejs";

const refreshHandler = withApiHandler(
  async (ctx) => {
    const handler = createRefreshHandler(await getAuthService());
    return handler(ctx);
  },
  {
    validation: { body: refreshSchema },
    middleware: [refreshRateLimit],
    postHandler: createAuthPostHandler(),
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const POST = refreshHandler;
export const OPTIONS = refreshHandler;