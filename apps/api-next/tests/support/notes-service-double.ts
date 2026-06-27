import type {
  NoteRecord,
  NoteSyncChange,
  NoteSyncRequest,
  NoteSyncResponse,
} from "@backend/notes/contracts.js";
import type { NotesService } from "@backend/notes/service";

export type NotesServiceCall = Readonly<{
  method: string;
  args: Record<string, unknown>;
}>;

export type NotesServiceDouble = Readonly<{
  notesService: NotesService;
  calls: Array<NotesServiceCall>;
}>;

const createNote = (
  input: Readonly<{ id: string; userId: string; title: string | null; updatedAt: number }>,
): NoteRecord => {
  const timestamp = new Date(input.updatedAt);

  return {
    id: input.id,
    userId: input.userId,
    title: input.title,
    content: null,
    contentType: null,
    color: null,
    active: true,
    done: null,
    isPinned: null,
    triggerAt: null,
    repeatRule: null,
    repeatConfig: null,
    repeat: null,
    snoozedUntil: null,
    scheduleStatus: null,
    timezone: null,
    baseAtLocal: null,
    startAt: null,
    nextTriggerAt: null,
    lastFiredAt: null,
    lastAcknowledgedAt: null,
    version: 1,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

/**
 * Stateful in-memory NotesService double mirroring backend route contract tests.
 * Tracks sync idempotency via payloadHash and supports trash lifecycle operations.
 */
export const createNotesServiceDouble = (): NotesServiceDouble => {
  const calls: Array<NotesServiceCall> = [];
  const notesByUser = new Map<string, Map<string, NoteRecord>>();
  const seenPayloads = new Set<string>();

  const getUserMap = (userId: string): Map<string, NoteRecord> => {
    const existing = notesByUser.get(userId);
    if (existing) {
      return existing;
    }

    const created = new Map<string, NoteRecord>();
    notesByUser.set(userId, created);
    return created;
  };

  const applySyncChange = (userId: string, change: NoteSyncChange): void => {
    const dedupeKey = `${change.id}:${userId}:${change.operation}:${change.payloadHash}`;
    if (seenPayloads.has(dedupeKey)) {
      return;
    }

    const userNotes = getUserMap(userId);
    const existing = userNotes.get(change.id);

    if (change.operation === "delete") {
      if (existing && change.updatedAt > existing.updatedAt.getTime()) {
        userNotes.set(change.id, {
          ...existing,
          active: false,
          deletedAt: new Date(change.deletedAt ?? change.updatedAt),
          updatedAt: new Date(change.updatedAt),
          version: existing.version + 1,
        });
      }

      seenPayloads.add(dedupeKey);
      return;
    }

    if (!existing) {
      userNotes.set(
        change.id,
        createNote({
          id: change.id,
          userId,
          title: change.title ?? null,
          updatedAt: change.updatedAt,
        }),
      );
      seenPayloads.add(dedupeKey);
      return;
    }

    if (change.updatedAt > existing.updatedAt.getTime()) {
      userNotes.set(change.id, {
        ...existing,
        title: change.title ?? existing.title,
        active: change.active ?? existing.active,
        updatedAt: new Date(change.updatedAt),
        version: existing.version + 1,
      });
    }

    seenPayloads.add(dedupeKey);
  };

  const notesService: NotesService = {
    listNotes: async (input) => {
      calls.push({ method: "listNotes", args: input as Record<string, unknown> });
      return [...getUserMap(input.userId).values()];
    },

    sync: async (input: NoteSyncRequest): Promise<NoteSyncResponse> => {
      calls.push({ method: "sync", args: input as Record<string, unknown> });
      input.changes.forEach((change) => {
        applySyncChange(input.userId, change);
      });

      return {
        notes: [...getUserMap(input.userId).values()],
        syncedAt: Date.now(),
      };
    },

    restoreNote: async (input) => {
      calls.push({ method: "restoreNote", args: input as Record<string, unknown> });
      const userNotes = getUserMap(input.userId);
      const existing = userNotes.get(input.noteId);
      if (!existing) {
        return false;
      }

      userNotes.set(input.noteId, {
        ...existing,
        active: true,
        deletedAt: null,
        updatedAt: new Date(),
      });
      return true;
    },

    trashNote: async (input) => {
      calls.push({ method: "trashNote", args: input as Record<string, unknown> });
      const userNotes = getUserMap(input.userId);
      const existing = userNotes.get(input.noteId);
      if (!existing) {
        return false;
      }

      userNotes.set(input.noteId, {
        ...existing,
        active: false,
        deletedAt: new Date(),
        updatedAt: new Date(),
      });
      return true;
    },

    permanentlyDeleteNote: async (input) => {
      calls.push({
        method: "permanentlyDeleteNote",
        args: input as Record<string, unknown>,
      });
      const userNotes = getUserMap(input.userId);
      const existing = userNotes.get(input.noteId);
      if (!existing || existing.active) {
        return false;
      }

      userNotes.delete(input.noteId);
      return true;
    },

    emptyTrash: async (input) => {
      calls.push({ method: "emptyTrash", args: input as Record<string, unknown> });
      const userNotes = getUserMap(input.userId);
      const toDelete = [...userNotes.values()]
        .filter((note) => !note.active)
        .map((note) => note.id);
      toDelete.forEach((noteId) => {
        userNotes.delete(noteId);
      });

      return toDelete.length;
    },

    purgeExpiredTrash: async () => {
      calls.push({ method: "purgeExpiredTrash", args: {} });
      return 0;
    },
  };

  return { notesService, calls };
};