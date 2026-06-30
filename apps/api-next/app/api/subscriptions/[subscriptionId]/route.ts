import { toAuthenticatedContext } from "@/handlers/notes/shared";
import {
  subscriptionIdParamsSchema,
  updateSubscriptionSchema,
} from "@/handlers/subscriptions/shared";
import { createTrashSubscriptionHandler } from "@/handlers/subscriptions/trash";
import { createUpdateSubscriptionHandler } from "@/handlers/subscriptions/update";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const updateSubscriptionHandler = withApiHandler(
  async (ctx) => {
    const handler = createUpdateSubscriptionHandler(getComposedServices().subscriptionsService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { params: subscriptionIdParamsSchema, body: updateSubscriptionSchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

const trashSubscriptionHandler = withApiHandler(
  async (ctx) => {
    const handler = createTrashSubscriptionHandler(getComposedServices().subscriptionsService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { params: subscriptionIdParamsSchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const PATCH = updateSubscriptionHandler;
export const DELETE = trashSubscriptionHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });