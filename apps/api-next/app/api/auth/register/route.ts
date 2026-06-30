import { createRegisterHandler } from "@/handlers/auth/register";
import { authCredentialsSchema } from "@/handlers/auth/shared";
import { createAuthPostHandler } from "@/http/auth/post-handler";
import { registerRateLimit } from "@/http/auth/rate-limit";
import { withApiHandler } from "@/http/with-api-handler";
import { getAuthService } from "@/server/auth-service";

export const runtime = "nodejs";

const registerHandler = withApiHandler(
  async (ctx) => {
    const handler = createRegisterHandler(await getAuthService());
    return handler(ctx);
  },
  {
    validation: { body: authCredentialsSchema },
    middleware: [registerRateLimit],
    postHandler: createAuthPostHandler(),
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const POST = registerHandler;
export const OPTIONS = registerHandler;