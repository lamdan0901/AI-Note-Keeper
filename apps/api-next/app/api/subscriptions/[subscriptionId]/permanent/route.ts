import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createPermanentDeleteSubscriptionHandler } from "@/handlers/subscriptions/permanent-delete";
import { subscriptionIdParamsSchema } from "@/handlers/subscriptions/shared";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const permanentDeleteSubscriptionHandler = withApiHandler(
  async (ctx) => {
    const handler = createPermanentDeleteSubscriptionHandler(
      getComposedServices().subscriptionsService,
    );
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { params: subscriptionIdParamsSchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const DELETE = permanentDeleteSubscriptionHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });