import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createMergeApplyHandler } from "@/handlers/merge/apply";
import { mergeApplyBodySchema } from "@/handlers/merge/shared";
import { requireAccessUser } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const applyHandler = withApiHandler(
  async (ctx) => {
    const handler = createMergeApplyHandler((await getComposedServices()).mergeService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUser()],
    validation: { body: mergeApplyBodySchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const POST = applyHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });