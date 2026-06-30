import { NextResponse } from "next/server";

import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createCreateSubscriptionHandler } from "@/handlers/subscriptions/create";
import { createListSubscriptionsHandler } from "@/handlers/subscriptions/list";
import { createSubscriptionSchema } from "@/handlers/subscriptions/shared";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const listSubscriptionsHandler = withApiHandler(
  async (ctx) => {
    const handler = createListSubscriptionsHandler(getComposedServices().subscriptionsService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    requireHealthyDependencies: true,
    cors: true,
  },
);

const createSubscriptionHandler = withApiHandler(
  async (ctx) => {
    const handler = createCreateSubscriptionHandler(getComposedServices().subscriptionsService);
    const result = await handler(toAuthenticatedContext(ctx));
    return NextResponse.json(result, { status: 201 });
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { body: createSubscriptionSchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const GET = listSubscriptionsHandler;
export const POST = createSubscriptionHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });