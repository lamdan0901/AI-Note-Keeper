import type { NotesService } from "@backend/notes/service";

import type { NotesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type RestoreNoteResult = Readonly<{
  restored: boolean;
}>;

export const createRestoreNoteHandler = (
  notesService: NotesService,
): NotesHandler<RestoreNoteResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { noteId } = ctx.params;
    const restored = await notesService.restoreNote({ userId, noteId });
    return { restored };
  };
};