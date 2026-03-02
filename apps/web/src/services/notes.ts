import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import type { NoteEditorDraft, WebNote } from './notesTypes';
import { filterActive, sortNotes } from './notesUtils';
import { buildReminderSyncFields } from './reminderUtils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const USER_ID = 'local-user';

export function getResolvedTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

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
type SyncChange = Parameters<SyncFn>[0]['changes'][number];

function toLegacySyncChange(change: SyncChange): SyncChange {
  const {
    repeat: _repeat,
    startAt: _startAt,
    baseAtLocal: _baseAtLocal,
    nextTriggerAt: _nextTriggerAt,
    lastFiredAt: _lastFiredAt,
    lastAcknowledgedAt: _lastAcknowledgedAt,
    ...legacyCompatible
  } = change;
  return legacyCompatible;
}

/**
 * Create a new note from a draft.
 */
export async function createNote(sync: SyncFn, draft: NoteEditorDraft) {
  const now = Date.now();
  const id = draft.id ?? crypto.randomUUID();
  const reminderFields = buildReminderSyncFields(
    draft.done ? { reminder: null, repeat: null } : { reminder: draft.reminder, repeat: draft.repeat },
    new Date(now),
    getResolvedTimezone(),
  );
  return sync({
    userId: USER_ID,
    lastSyncAt: now,
    changes: [
      toLegacySyncChange({
        id,
        userId: USER_ID,
        title: draft.title || undefined,
        content: draft.content || undefined,
        color: draft.color,
        active: true,
        done: draft.done,
        isPinned: draft.isPinned,
        ...reminderFields,
        operation: 'create',
        deviceId: 'web',
        createdAt: now,
        updatedAt: now,
      }),
    ],
  });
}

/**
 * Update an existing note from a draft, preserving series anchor when
 * recurrence is unchanged.
 */
export async function updateNote(sync: SyncFn, draft: NoteEditorDraft, existingNote: WebNote) {
  const now = Date.now();
  const id = draft.id ?? existingNote.id;
  const reminderFields = buildReminderSyncFields(
    draft.done ? { reminder: null, repeat: null } : { reminder: draft.reminder, repeat: draft.repeat },
    new Date(now),
    getResolvedTimezone(),
    existingNote,
  );
  return sync({
    userId: USER_ID,
    lastSyncAt: now,
    changes: [
      toLegacySyncChange({
        id,
        userId: USER_ID,
        title: draft.title || undefined,
        content: draft.content || undefined,
        color: draft.color,
        active: true,
        done: draft.done,
        isPinned: draft.isPinned,
        ...reminderFields,
        operation: 'update',
        deviceId: 'web',
        version: existingNote.version,
        createdAt: existingNote.createdAt,
        updatedAt: now,
      }),
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
