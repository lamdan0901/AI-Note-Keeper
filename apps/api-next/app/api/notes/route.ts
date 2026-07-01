import { createListNotesHandler } from "@/handlers/notes/list";
import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const listNotesHandler = withApiHandler(
  async (ctx) => {
    const handler = createListNotesHandler((await getComposedServices()).notesService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const GET = listNotesHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });