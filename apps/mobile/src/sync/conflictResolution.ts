import { Note } from '../db/notesRepo';

export type ConflictType = 'none' | 'input_required';

export type ConflictResult =
  | { type: 'none'; mergedNote: Note }
  | { type: 'input_required'; serverNote: Note; localNote: Note };

/**
 * Detects conflicts between a local note and a server note.
 * Returns a result indicating if auto-merge was successful or if user input is needed.
 */
export const resolveNoteConflict = (local: Note, server: Note): ConflictResult => {
  // If versions match, no conflict (though this function shouldn't be called in that case usually)
  if (local.serverVersion === server.version) {
    return { type: 'none', mergedNote: local };
  }

  // Check which fields have changed on the server relative to what we last saw
  // We don't have the "base" version explicitly easily available unless we store it.
  // BUT, we can compare local vs server directly.

  // Strategies:
  // 1. If one modified Title and other modified Content -> Auto Merge.
  // 2. If both modified Content -> Conflict.
  // 3. If one deleted -> Conflict (or resurrection?).

  // Since we don't have a 3-way diff based on a common ancestor yet (MVP),
  // we will use a simpler heuristic:
  // - If fields are identical, no conflict.
  // - If local has changes that server doesn't have (impossible to know without base).

  // WAIT. "serverVersion" on local note TELLS us what the base was (roughly).
  // If local.serverVersion < server.version, it means server has moved on.

  const contentConflict = local.content !== server.content;
  const titleConflict = local.title !== server.title;
  // Heuristic: Last Write Wins is the fallback.
  // But we want "Smart" resolution.

  // If we can't do true 3-way, we can't safely auto-merge TEXT fields if we don't know who touched what.
  // BUT, if the text is identical, it's fine.

  if (contentConflict || titleConflict) {
    // For MVP Phase 3: If CRITICAL fields (title, content) differ and versions mismatch,
    // we assume we can't safely merge without potentially losing data.
    return { type: 'input_required', serverNote: server, localNote: local };
  }

  // For minor fields (color, active), we default to Local Wins in this auto-merge.
  // This means if I changed color locally, I keep it.

  return {
    type: 'none',
    mergedNote: { ...server, ...local, syncStatus: 'synced', serverVersion: server.version },
  };
};
