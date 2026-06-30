import { createUpgradeSessionHandler } from "@/handlers/auth/upgrade-session";
import { upgradeSessionSchema } from "@/handlers/auth/shared";
import { createAuthPostHandler } from "@/http/auth/post-handler";
import { upgradeRateLimit } from "@/http/auth/rate-limit";
import { withApiHandler } from "@/http/with-api-handler";
import { getAuthService } from "@/server/auth-service";

export const runtime = "nodejs";

const upgradeSessionHandler = withApiHandler(
  async (ctx) => {
    const handler = createUpgradeSessionHandler(await getAuthService());
    return handler(ctx);
  },
  {
    validation: { body: upgradeSessionSchema },
    middleware: [upgradeRateLimit],
    postHandler: createAuthPostHandler(),
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const POST = upgradeSessionHandler;
export const OPTIONS = upgradeSessionHandler;