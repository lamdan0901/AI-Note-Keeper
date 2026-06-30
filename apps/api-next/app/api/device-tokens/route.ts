import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createUpsertDeviceTokenHandler } from "@/handlers/device-tokens/upsert";
import { upsertBodySchema } from "@/handlers/device-tokens/shared";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const upsertDeviceTokenHandler = withApiHandler(
  async (ctx) => {
    const handler = createUpsertDeviceTokenHandler(getComposedServices().deviceTokensService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { body: upsertBodySchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const POST = upsertDeviceTokenHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });