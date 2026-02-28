import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import type { NoteEditorDraft, WebNote } from './notesTypes';
import { filterActive, sortNotes } from './notesUtils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const USER_ID = 'local-user';

// ---------------------------------------------------------------------------
// Raw Convex document → WebNote mapper
// ---------------------------------------------------------------------------

// The Convex `notes` query returns documents with internal fields `_id` and
// `_creationTime` in addition to the schema fields.  We strip those and
// normalise optional booleans so the rest of the app works with plain values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDocToWebNote(doc: any): WebNote {
  return {
    id: doc.id as string,
    userId: doc.userId as string,
    title: doc.title ?? null,
    content: doc.content ?? null,
    color: doc.color ?? null,
    active: doc.active as boolean,
    done: doc.done ?? false,
    isPinned: doc.isPinned ?? false,

    // Reminder-related fields (preserved as-is; never modified by web)
    triggerAt: doc.triggerAt,
    repeatRule: doc.repeatRule,
    repeatConfig: doc.repeatConfig,
    repeat: doc.repeat,
    snoozedUntil: doc.snoozedUntil,
    scheduleStatus: doc.scheduleStatus,
    timezone: doc.timezone,
    baseAtLocal: doc.baseAtLocal ?? null,
    startAt: doc.startAt ?? null,
    nextTriggerAt: doc.nextTriggerAt ?? null,
    lastFiredAt: doc.lastFiredAt ?? null,
    lastAcknowledgedAt: doc.lastAcknowledgedAt ?? null,

    version: doc.version,
    updatedAt: doc.updatedAt as number,
    createdAt: doc.createdAt as number,
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Returns the filtered (active-only) and sorted list of notes for the current
 * user, or `undefined` while the query is loading.
 */
export function useNotes(): WebNote[] | undefined {
  const raw = useQuery(api.functions.notes.getNotes, { userId: USER_ID });
  if (raw === undefined) return undefined;
  const webNotes = raw.map(mapDocToWebNote);
  return sortNotes(filterActive(webNotes));
}

/**
 * Returns the raw `syncNotes` mutation function from Convex.
 * Use the helper wrappers below (`createNote`, `updateNote`, `deleteNote`)
 * rather than calling this directly.
 */
export function useSyncNotes() {
  return useMutation(api.functions.notes.syncNotes);
}

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

type SyncFn = ReturnType<typeof useSyncNotes>;

/**
 * Create a new note from a draft.
 */
export async function createNote(sync: SyncFn, draft: NoteEditorDraft) {
  const now = Date.now();
  const id = draft.id ?? crypto.randomUUID();
  return sync({
    userId: USER_ID,
    lastSyncAt: now,
    changes: [
      {
        id,
        userId: USER_ID,
        title: draft.title || undefined,
        content: draft.content || undefined,
        color: draft.color !== 'default' ? draft.color : undefined,
        active: true,
        done: draft.done,
        isPinned: draft.isPinned,
        operation: 'create',
        deviceId: 'web',
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
}

/**
 * Update an existing note from a draft, preserving reminder-related fields
 * that are accepted by `syncNotes` (`triggerAt`, `repeatRule`, `repeatConfig`,
 * `snoozedUntil`, `scheduleStatus`, `timezone`) so they are not overwritten.
 *
 * Fields NOT in the `syncNotes` schema (`repeat`, `baseAtLocal`, `startAt`,
 * `nextTriggerAt`, `lastFiredAt`, `lastAcknowledgedAt`) are preserved
 * server-side automatically because Convex `patch` only updates listed fields.
 */
export async function updateNote(sync: SyncFn, draft: NoteEditorDraft, existingNote: WebNote) {
  const now = Date.now();
  const id = draft.id ?? existingNote.id;
  return sync({
    userId: USER_ID,
    lastSyncAt: now,
    changes: [
      {
        id,
        userId: USER_ID,
        title: draft.title || undefined,
        content: draft.content || undefined,
        color: draft.color !== 'default' ? draft.color : undefined,
        active: true,
        done: draft.done,
        isPinned: draft.isPinned,
        operation: 'update',
        deviceId: 'web',
        // Preserve reminder fields from server so they are not cleared
        triggerAt: existingNote.triggerAt,
        repeatRule: existingNote.repeatRule,
        repeatConfig: existingNote.repeatConfig as Record<string, unknown> | undefined,
        snoozedUntil: existingNote.snoozedUntil,
        scheduleStatus: existingNote.scheduleStatus,
        timezone: existingNote.timezone,
        version: existingNote.version,
        createdAt: existingNote.createdAt,
        updatedAt: now,
      },
    ],
  });
}

/**
 * Soft-delete a note by ID (sets `active: false`).
 */
export async function deleteNote(sync: SyncFn, id: string) {
  const now = Date.now();
  return sync({
    userId: USER_ID,
    lastSyncAt: now,
    changes: [
      {
        id,
        userId: USER_ID,
        active: false,
        operation: 'delete',
        deviceId: 'web',
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
}
