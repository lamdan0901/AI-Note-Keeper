import { createSyncNotesHandler } from "@/handlers/notes/sync";
import { syncBodySchema, toAuthenticatedContext } from "@/handlers/notes/shared";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const syncNotesHandler = withApiHandler(
  async (ctx) => {
    const handler = createSyncNotesHandler((await getComposedServices()).notesService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { body: syncBodySchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const POST = syncNotesHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });