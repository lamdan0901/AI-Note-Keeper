import type { WebNote } from '../services/notesTypes';

export type OptimisticUpsertsById = Record<string, WebNote>;

export function mergeOptimisticNotes(
  serverNotes: readonly WebNote[] | undefined,
  optimisticUpsertsById: OptimisticUpsertsById,
  optimisticDeletedIds: ReadonlySet<string>,
): WebNote[] {
  const mergedById = new Map<string, WebNote>();

  for (const note of serverNotes ?? []) {
    if (optimisticDeletedIds.has(note.id)) {
      continue;
    }
    mergedById.set(note.id, note);
  }

  for (const optimisticNote of Object.values(optimisticUpsertsById)) {
    if (optimisticDeletedIds.has(optimisticNote.id)) {
      continue;
    }
    mergedById.set(optimisticNote.id, optimisticNote);
  }

  return Array.from(mergedById.values());
}

export function reconcileOptimisticNotes(
  serverNotes: readonly WebNote[] | undefined,
  optimisticUpsertsById: OptimisticUpsertsById,
  optimisticDeletedIds: ReadonlySet<string>,
): Readonly<{
  optimisticUpsertsById: OptimisticUpsertsById;
  optimisticDeletedIds: Set<string>;
}> {
  if (serverNotes === undefined) {
    return {
      optimisticUpsertsById,
      optimisticDeletedIds: new Set(optimisticDeletedIds),
    };
  }

  const serverById = new Map(serverNotes.map((note) => [note.id, note]));
  const nextOptimisticUpsertsById: OptimisticUpsertsById = {};

  for (const [id, optimisticNote] of Object.entries(optimisticUpsertsById)) {
    const serverNote = serverById.get(id);
    if (serverNote && serverNote.updatedAt >= optimisticNote.updatedAt) {
      continue;
    }
    nextOptimisticUpsertsById[id] = optimisticNote;
  }

  const nextOptimisticDeletedIds = new Set<string>();
  for (const id of optimisticDeletedIds) {
    if (serverById.has(id)) {
      nextOptimisticDeletedIds.add(id);
    }
  }

  return {
    optimisticUpsertsById: nextOptimisticUpsertsById,
    optimisticDeletedIds: nextOptimisticDeletedIds,
  };
}
