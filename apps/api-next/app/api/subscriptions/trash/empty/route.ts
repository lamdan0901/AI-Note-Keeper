import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createEmptyTrashHandler } from "@/handlers/subscriptions/empty-trash";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const emptyTrashHandler = withApiHandler(
  async (ctx) => {
    const handler = createEmptyTrashHandler((await getComposedServices()).subscriptionsService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const DELETE = emptyTrashHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });