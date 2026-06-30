import { createRestoreNoteHandler } from "@/handlers/notes/restore";
import { noteIdParamsSchema, toAuthenticatedContext } from "@/handlers/notes/shared";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const restoreNoteHandler = withApiHandler(
  async (ctx) => {
    const handler = createRestoreNoteHandler(getComposedServices().notesService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { params: noteIdParamsSchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const POST = restoreNoteHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });