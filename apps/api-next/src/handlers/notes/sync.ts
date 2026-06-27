import type { NoteSyncChange, NoteSyncResponse } from "@backend/notes/contracts.js";
import type { NotesService } from "@backend/notes/service";

import type { NotesHandler } from "./shared";
import { normalizeSyncChanges, requireAuthUserId } from "./shared";

type SyncBody = Readonly<{
  lastSyncAt: number;
  changes: ReadonlyArray<NoteSyncChange>;
}>;

export const createSyncNotesHandler = (
  notesService: NotesService,
): NotesHandler<NoteSyncResponse> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const body = ctx.body as SyncBody;
    const normalizedChanges = normalizeSyncChanges(userId, body.changes);

    return notesService.sync({
      userId,
      lastSyncAt: body.lastSyncAt,
      changes: normalizedChanges,
    });
  };
};