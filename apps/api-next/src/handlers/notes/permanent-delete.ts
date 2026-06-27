import type { NotesService } from "@backend/notes/service";

import type { NotesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type PermanentDeleteResult = Readonly<{
  deleted: boolean;
}>;

export const createPermanentDeleteNoteHandler = (
  notesService: NotesService,
): NotesHandler<PermanentDeleteResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { noteId } = ctx.params;
    const deleted = await notesService.permanentlyDeleteNote({ userId, noteId });
    return { deleted };
  };
};