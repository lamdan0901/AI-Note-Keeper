import type { NoteColorPreset, NoteEditorDraft, WebNote } from './notesTypes';

// ---------------------------------------------------------------------------
// Colour normalisation
// ---------------------------------------------------------------------------

/** All known colour preset IDs. */
export const NOTE_COLOR_PRESET_IDS: NoteColorPreset[] = [
  'default',
  'red',
  'yellow',
  'green',
  'blue',
  'purple',
];

/**
 * Map of legacy hex/rgba strings (light & dark variants) to their preset ID.
 * Mirrors the values in `apps/mobile/src/constants/noteColors.ts`.
 */
const LEGACY_HEX_MAP: Record<string, NoteColorPreset> = {
  '#ff9292': 'red',
  '#952222': 'red',
  '#ffdd77': 'yellow',
  '#936c18': 'yellow',
  '#76faa7': 'green',
  '#196836': 'green',
  '#82b2ff': 'blue',
  '#28478b': 'blue',
  '#cb93ff': 'purple',
  '#5f2d8d': 'purple',
};

/**
 * Normalise a stored `note.color` value to a well-known preset ID.
 * Handles preset IDs, legacy hex strings, `null`, and unknown values (→ "default").
 */
export function toPresetId(color: string | null | undefined): NoteColorPreset {
  if (!color || color === 'default') return 'default';
  if ((NOTE_COLOR_PRESET_IDS as string[]).includes(color)) return color as NoteColorPreset;
  const fromHex = LEGACY_HEX_MAP[color.toLowerCase()];
  return fromHex ?? 'default';
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Return only notes that are logically active (not soft-deleted).
 */
export function filterActive(notes: WebNote[]): WebNote[] {
  return notes.filter((n) => n.active === true);
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/**
 * Sort notes for display:
 *  1. Pinned notes first.
 *  2. Within the same pin group: non-done before done.
 *  3. Within the same done group: newest `updatedAt` first.
 */
export function sortNotes(notes: WebNote[]): WebNote[] {
  return [...notes].sort((a, b) => {
    // 1. Pinned first
    const pinA = a.isPinned ? 1 : 0;
    const pinB = b.isPinned ? 1 : 0;
    if (pinB !== pinA) return pinB - pinA;

    // 2. Non-done before done
    const doneA = a.done ? 1 : 0;
    const doneB = b.done ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;

    // 3. Newest updatedAt first
    return b.updatedAt - a.updatedAt;
  });
}

// ---------------------------------------------------------------------------
// Draft helpers
// ---------------------------------------------------------------------------

/**
 * Return a blank `NoteEditorDraft` for creating a new note.
 */
export function emptyDraft(): NoteEditorDraft {
  return {
    id: undefined,
    title: '',
    content: '',
    color: 'default',
    isPinned: false,
    done: false,
  };
}

/**
 * Map an existing `WebNote` to a `NoteEditorDraft` for editing.
 */
export function draftFromNote(note: WebNote): NoteEditorDraft {
  return {
    id: note.id,
    title: note.title ?? '',
    content: note.content ?? '',
    color: toPresetId(note.color),
    isPinned: note.isPinned,
    done: note.done,
  };
}
