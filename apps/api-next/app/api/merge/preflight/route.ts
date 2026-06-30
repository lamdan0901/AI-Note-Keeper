import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createMergePreflightHandler } from "@/handlers/merge/preflight";
import { mergePreflightBodySchema } from "@/handlers/merge/shared";
import { requireAccessUser } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const preflightHandler = withApiHandler(
  async (ctx) => {
    const handler = createMergePreflightHandler(getComposedServices().mergeService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUser()],
    validation: { body: mergePreflightBodySchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const POST = preflightHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });