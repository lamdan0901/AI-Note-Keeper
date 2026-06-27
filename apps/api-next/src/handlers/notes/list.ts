import type { NotesService } from "@backend/notes/service";
import type { NoteRecord } from "@backend/notes/contracts.js";

import type { NotesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type ListNotesResult = Readonly<{
  notes: ReadonlyArray<NoteRecord>;
}>;

export const createListNotesHandler = (
  notesService: NotesService,
): NotesHandler<ListNotesResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const notes = await notesService.listNotes({ userId });
    return { notes };
  };
};