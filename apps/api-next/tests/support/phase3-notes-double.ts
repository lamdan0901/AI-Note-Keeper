import type { NoteSyncRequest, NoteSyncResponse } from "@backend/notes/contracts.js";
import type { NotesService } from "@backend/notes/service";

export type Phase3NotesSyncDouble = Readonly<{
  notesService: NotesService;
  getNoteMutationCount: () => number;
}>;

/**
 * Mirrors the notes sync double from backend phase3.http.contract.test.ts.
 * Tracks deduplicated mutations by userId + note id + operation + payloadHash.
 */
export const createPhase3NotesSyncDouble = (): Phase3NotesSyncDouble => {
  let noteMutationCount = 0;
  const noteReplayKeys = new Set<string>();

  const notesService: NotesService = {
    listNotes: async () => [],

    sync: async (input: NoteSyncRequest): Promise<NoteSyncResponse> => {
      for (const change of input.changes) {
        const key = `${input.userId}:${change.id}:${change.operation}:${change.payloadHash}`;
        if (noteReplayKeys.has(key)) {
          continue;
        }

        noteReplayKeys.add(key);
        noteMutationCount += 1;
      }

      return { notes: [], syncedAt: input.lastSyncAt + 1 };
    },

    restoreNote: async () => true,
    trashNote: async () => true,
    permanentlyDeleteNote: async () => true,
    emptyTrash: async () => 0,
    purgeExpiredTrash: async () => 0,
  };

  return {
    notesService,
    getNoteMutationCount: () => noteMutationCount,
  };
};