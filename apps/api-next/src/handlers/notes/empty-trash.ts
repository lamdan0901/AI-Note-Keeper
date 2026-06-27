import type { NotesService } from "@backend/notes/service";

import type { NotesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type EmptyTrashResult = Readonly<{
  deleted: number;
}>;

export const createEmptyTrashHandler = (
  notesService: NotesService,
): NotesHandler<EmptyTrashResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const deleted = await notesService.emptyTrash({ userId });
    return { deleted };
  };
};