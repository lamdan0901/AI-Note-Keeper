import { createLogoutHandler } from "@/handlers/auth/logout";
import { logoutSchema } from "@/handlers/auth/shared";
import { createAuthPostHandler } from "@/http/auth/post-handler";
import { logoutRateLimit } from "@/http/auth/rate-limit";
import { withApiHandler } from "@/http/with-api-handler";
import { getAuthService } from "@/server/auth-service";

export const runtime = "nodejs";

const logoutHandler = withApiHandler(
  async (ctx) => {
    const handler = createLogoutHandler(await getAuthService());
    return handler(ctx);
  },
  {
    validation: { body: logoutSchema },
    middleware: [logoutRateLimit],
    postHandler: createAuthPostHandler(),
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const POST = logoutHandler;
export const OPTIONS = logoutHandler;