import type { NotesService } from "@backend/notes/service";

import type { NotesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type TrashNoteResult = Readonly<{
  deleted: boolean;
}>;

export const createTrashNoteHandler = (
  notesService: NotesService,
): NotesHandler<TrashNoteResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { noteId } = ctx.params;
    const deleted = await notesService.trashNote({ userId, noteId });
    return { deleted };
  };
};