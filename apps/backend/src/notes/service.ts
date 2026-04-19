import { AppError } from '../middleware/error-middleware.js';
import {
  hasOwnField,
  toCanonicalPatch,
  type NoteRecord,
  type NoteSyncChange,
  type NoteSyncRequest,
  type NoteSyncResponse,
} from './contracts.js';
import {
  createNoteChangeEventsRepository,
  type NoteChangeEventsRepository,
} from './repositories/note-change-events-repository.js';
import {
  createNotesRepository,
  type NoteCreateInput,
  type NotePatchInput,
  type NotesRepository,
} from './repositories/notes-repository.js';

const TRASH_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

type NotesServiceDeps = Readonly<{
  notesRepository?: NotesRepository;
  noteChangeEventsRepository?: NoteChangeEventsRepository;
  now?: () => Date;
}>;

export type NotesService = Readonly<{
  listNotes: (input: Readonly<{ userId: string }>) => Promise<ReadonlyArray<NoteRecord>>;
  sync: (input: NoteSyncRequest) => Promise<NoteSyncResponse>;
  restoreNote: (input: Readonly<{ userId: string; noteId: string }>) => Promise<boolean>;
  trashNote: (input: Readonly<{ userId: string; noteId: string }>) => Promise<boolean>;
  permanentlyDeleteNote: (input: Readonly<{ userId: string; noteId: string }>) => Promise<boolean>;
  emptyTrash: (input: Readonly<{ userId: string }>) => Promise<number>;
  purgeExpiredTrash: (input: Readonly<{ userId: string }>) => Promise<number>;
}>;

const toDate = (value: number | null | undefined): Date | null => {
  if (value === null || value === undefined) {
    return null;
  }

  return new Date(value);
};

const toForbiddenError = (): AppError => {
  return new AppError({
    code: 'forbidden',
    message: 'Cross-user note mutation is not allowed',
  });
};

const makeNoteCreateInput = (change: NoteSyncChange, userId: string): NoteCreateInput => {
  const canonical = toCanonicalPatch(change);

  return {
    id: change.id,
    userId,
    title: change.title ?? null,
    content: change.content ?? null,
    contentType: change.contentType ?? null,
    color: change.color ?? null,
    active: change.active ?? change.operation !== 'delete',
    done: change.done ?? null,
    isPinned: change.isPinned ?? null,
    triggerAt: toDate(change.triggerAt),
    repeatRule: change.repeatRule ?? null,
    repeatConfig: change.repeatConfig ?? null,
    repeat: canonical.repeat ?? null,
    snoozedUntil: toDate(change.snoozedUntil),
    scheduleStatus: change.scheduleStatus ?? null,
    timezone: change.timezone ?? null,
    baseAtLocal: canonical.baseAtLocal ?? null,
    startAt: canonical.startAt ?? null,
    nextTriggerAt: canonical.nextTriggerAt ?? null,
    lastFiredAt: canonical.lastFiredAt ?? null,
    lastAcknowledgedAt: canonical.lastAcknowledgedAt ?? null,
    version: 1,
    deletedAt: toDate(change.deletedAt),
    createdAt: new Date(change.createdAt ?? change.updatedAt),
    updatedAt: new Date(change.updatedAt),
  };
};

const makePatchInput = (change: NoteSyncChange, currentVersion: number): NotePatchInput => {
  const patch: NotePatchInput = {
    updatedAt: new Date(change.updatedAt),
    version: currentVersion + 1,
  };

  const changeRecord = change as Record<string, unknown>;

  if (hasOwnField(changeRecord, 'title')) {
    patch.title = change.title ?? null;
  }
  if (hasOwnField(changeRecord, 'content')) {
    patch.content = change.content ?? null;
  }
  if (hasOwnField(changeRecord, 'contentType')) {
    patch.contentType = change.contentType ?? null;
  }
  if (hasOwnField(changeRecord, 'color')) {
    patch.color = change.color ?? null;
  }
  if (hasOwnField(changeRecord, 'active')) {
    patch.active = change.active ?? true;
  }
  if (hasOwnField(changeRecord, 'done')) {
    patch.done = change.done ?? null;
  }
  if (hasOwnField(changeRecord, 'isPinned')) {
    patch.isPinned = change.isPinned ?? null;
  }
  if (hasOwnField(changeRecord, 'triggerAt')) {
    patch.triggerAt = toDate(change.triggerAt);
  }
  if (hasOwnField(changeRecord, 'repeatRule')) {
    patch.repeatRule = change.repeatRule ?? null;
  }
  if (hasOwnField(changeRecord, 'repeatConfig')) {
    patch.repeatConfig = change.repeatConfig ?? null;
  }
  if (hasOwnField(changeRecord, 'snoozedUntil')) {
    patch.snoozedUntil = toDate(change.snoozedUntil);
  }
  if (hasOwnField(changeRecord, 'scheduleStatus')) {
    patch.scheduleStatus = change.scheduleStatus ?? null;
  }
  if (hasOwnField(changeRecord, 'timezone')) {
    patch.timezone = change.timezone ?? null;
  }

  // D-04 null-vs-omitted behavior is explicit: omitted preserves, explicit null clears.
  if (hasOwnField(changeRecord, 'repeat')) {
    patch.repeat = change.repeat ?? null;
  }
  if (hasOwnField(changeRecord, 'startAt')) {
    patch.startAt = toDate(change.startAt);
  }
  if (hasOwnField(changeRecord, 'baseAtLocal')) {
    patch.baseAtLocal = change.baseAtLocal ?? null;
  }
  if (hasOwnField(changeRecord, 'nextTriggerAt')) {
    patch.nextTriggerAt = toDate(change.nextTriggerAt);
  }
  if (hasOwnField(changeRecord, 'lastFiredAt')) {
    patch.lastFiredAt = toDate(change.lastFiredAt);
  }
  if (hasOwnField(changeRecord, 'lastAcknowledgedAt')) {
    patch.lastAcknowledgedAt = toDate(change.lastAcknowledgedAt);
  }
  if (hasOwnField(changeRecord, 'deletedAt')) {
    patch.deletedAt = toDate(change.deletedAt);
  }

  return patch;
};

export const createNotesService = (deps: NotesServiceDeps = {}): NotesService => {
  const notesRepository = deps.notesRepository ?? createNotesRepository();
  const noteChangeEventsRepository =
    deps.noteChangeEventsRepository ?? createNoteChangeEventsRepository();
  const now = deps.now ?? (() => new Date());

  // Serialize mutations for deterministic behavior across concurrent sync calls.
  let mutationQueue = Promise.resolve();

  const enqueueMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    const run = mutationQueue.then(operation, operation);
    mutationQueue = run.then(
      () => undefined,
      () => undefined,
    );

    return await run;
  };

  const applyChange = async (change: NoteSyncChange, userId: string): Promise<void> => {
    if (change.userId !== userId) {
      throw toForbiddenError();
    }

    const isDuplicate = await noteChangeEventsRepository.isDuplicate({
      noteId: change.id,
      userId,
      operation: change.operation,
      payloadHash: change.payloadHash,
    });

    if (isDuplicate) {
      return;
    }

    const existing = await notesRepository.findByIdForUser({
      noteId: change.id,
      userId,
    });

    if (change.operation === 'delete') {
      if (existing) {
        const incomingUpdatedAt = new Date(change.updatedAt);
        const shouldApplyIncoming = incomingUpdatedAt.getTime() > existing.updatedAt.getTime();

        // D-02 strict greater-than LWW gate.
        if (shouldApplyIncoming) {
          await notesRepository.patch({
            noteId: change.id,
            userId,
            patch: {
              active: false,
              deletedAt: toDate(change.deletedAt) ?? incomingUpdatedAt,
              updatedAt: incomingUpdatedAt,
              version: existing.version + 1,
            },
          });
        }
      }

      await noteChangeEventsRepository.appendEvent({
        noteId: change.id,
        userId,
        operation: change.operation,
        payloadHash: change.payloadHash,
        deviceId: change.deviceId,
      });
      return;
    }

    if (!existing) {
      await notesRepository.create(makeNoteCreateInput(change, userId));

      await noteChangeEventsRepository.appendEvent({
        noteId: change.id,
        userId,
        operation: change.operation,
        payloadHash: change.payloadHash,
        deviceId: change.deviceId,
      });
      return;
    }

    const incomingUpdatedAt = new Date(change.updatedAt);
    const shouldApplyIncoming = incomingUpdatedAt.getTime() > existing.updatedAt.getTime();

    // D-02 strict greater-than LWW gate.
    if (shouldApplyIncoming) {
      await notesRepository.patch({
        noteId: change.id,
        userId,
        patch: makePatchInput(change, existing.version),
      });
    }

    await noteChangeEventsRepository.appendEvent({
      noteId: change.id,
      userId,
      operation: change.operation,
      payloadHash: change.payloadHash,
      deviceId: change.deviceId,
    });
  };

  return {
    listNotes: async ({ userId }) => {
      return await notesRepository.listByUser(userId);
    },

    sync: async (input) => {
      for (const change of input.changes) {
        await enqueueMutation(async () => {
          await applyChange(change, input.userId);
        });
      }

      return {
        notes: await notesRepository.listByUser(input.userId),
        syncedAt: now().getTime(),
      };
    },

    restoreNote: async ({ userId, noteId }) => {
      const existing = await notesRepository.findByIdForUser({ noteId, userId });
      if (!existing) {
        return false;
      }

      if (existing.active) {
        return true;
      }

      await notesRepository.patch({
        noteId,
        userId,
        patch: {
          active: true,
          deletedAt: null,
          updatedAt: now(),
          version: existing.version + 1,
        },
      });

      return true;
    },

    trashNote: async ({ userId, noteId }) => {
      const existing = await notesRepository.findByIdForUser({ noteId, userId });
      if (!existing) {
        return false;
      }

      await notesRepository.patch({
        noteId,
        userId,
        patch: {
          active: false,
          deletedAt: now(),
          updatedAt: now(),
          version: existing.version + 1,
        },
      });

      return true;
    },

    permanentlyDeleteNote: async ({ userId, noteId }) => {
      const existing = await notesRepository.findByIdForUser({ noteId, userId });
      if (!existing || existing.active) {
        return false;
      }

      return await notesRepository.hardDelete({ noteId, userId });
    },

    emptyTrash: async ({ userId }) => {
      return await notesRepository.emptyTrash({ userId });
    },

    purgeExpiredTrash: async ({ userId }) => {
      const notes = await notesRepository.listByUser(userId);
      const cutoff = now().getTime() - TRASH_RETENTION_MS;
      let deleted = 0;

      for (const note of notes) {
        if (note.active) {
          continue;
        }

        const deletedAt = note.deletedAt?.getTime() ?? 0;
        if (deletedAt > 0 && deletedAt <= cutoff) {
          const wasDeleted = await notesRepository.hardDelete({
            noteId: note.id,
            userId,
          });

          if (wasDeleted) {
            deleted += 1;
          }
        }
      }

      return deleted;
    },
  };
};
