import { createListTrashedSubscriptionsHandler } from "@/handlers/subscriptions/list-trash";
import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const listTrashedSubscriptionsHandler = withApiHandler(
  async (ctx) => {
    const handler = createListTrashedSubscriptionsHandler(
      (await getComposedServices()).subscriptionsService,
    );
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const GET = listTrashedSubscriptionsHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });