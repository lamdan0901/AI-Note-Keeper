import { noteIdParamsSchema, toAuthenticatedContext } from "@/handlers/notes/shared";
import { createTrashNoteHandler } from "@/handlers/notes/trash";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const trashNoteHandler = withApiHandler(
  async (ctx) => {
    const handler = createTrashNoteHandler((await getComposedServices()).notesService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { params: noteIdParamsSchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const DELETE = trashNoteHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });