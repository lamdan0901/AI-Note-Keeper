import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createRestoreSubscriptionHandler } from "@/handlers/subscriptions/restore";
import { subscriptionIdParamsSchema } from "@/handlers/subscriptions/shared";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const restoreSubscriptionHandler = withApiHandler(
  async (ctx) => {
    const handler = createRestoreSubscriptionHandler((await getComposedServices()).subscriptionsService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { params: subscriptionIdParamsSchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const POST = restoreSubscriptionHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });