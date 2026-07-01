import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createDeleteDeviceTokenHandler } from "@/handlers/device-tokens/delete";
import { deviceIdParamsSchema } from "@/handlers/device-tokens/shared";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const deleteDeviceTokenHandler = withApiHandler(
  async (ctx) => {
    const handler = createDeleteDeviceTokenHandler((await getComposedServices()).deviceTokensService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { params: deviceIdParamsSchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const DELETE = deleteDeviceTokenHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });