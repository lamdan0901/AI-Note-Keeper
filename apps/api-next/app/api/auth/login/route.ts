import { createLoginHandler } from "@/handlers/auth/login";
import { authCredentialsSchema } from "@/handlers/auth/shared";
import { createAuthPostHandler } from "@/http/auth/post-handler";
import { loginRateLimit } from "@/http/auth/rate-limit";
import { withApiHandler } from "@/http/with-api-handler";
import { getAuthService } from "@/server/auth-service";

export const runtime = "nodejs";

const loginHandler = withApiHandler(
  async (ctx) => {
    const handler = createLoginHandler(await getAuthService());
    return handler(ctx);
  },
  {
    validation: { body: authCredentialsSchema },
    middleware: [loginRateLimit],
    postHandler: createAuthPostHandler(),
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const POST = loginHandler;
export const OPTIONS = loginHandler;