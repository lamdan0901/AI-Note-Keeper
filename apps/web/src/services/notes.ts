import { useCallback } from 'react';
import { useBackendClient, useBackendHooks } from '../../../../packages/shared/backend/context';
import type { SyncNoteChange, SyncNotesResult } from '../../../../packages/shared/backend/types';
import type { NoteEditorDraft, WebNote } from './notesTypes';
import { buildReminderSyncFields } from './reminderUtils';
import { useWebAuth } from '../auth/AuthContext';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
    contentType: doc.contentType ?? undefined,
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
    deletedAt: doc.deletedAt ?? undefined,
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
  const { userId } = useWebAuth();
  const hooks = useBackendHooks();
  const raw = hooks.useAllNotes(userId);
  if (raw === undefined) return undefined;
  return raw.map(mapDocToWebNote);
}

/**
 * Returns a stable callback that calls `syncNotes` on the backend client.
 * Use the helper wrappers below (`createNote`, `updateNote`, `deleteNote`)
 * rather than calling this directly.
 */
export function useSyncNotes() {
  const client = useBackendClient();
  return useCallback(
    (args: {
      userId: string;
      changes: SyncNoteChange[];
      lastSyncAt: number;
    }): Promise<SyncNotesResult> => client.syncNotes(args.userId, args.changes, args.lastSyncAt),
    [client],
  );
}

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

type SyncFn = (args: {
  userId: string;
  changes: SyncNoteChange[];
  lastSyncAt: number;
}) => Promise<SyncNotesResult>;
type SyncChange = SyncNoteChange;

function toLegacySyncChange(change: SyncChange): SyncChange {
  const legacyCompatible = { ...change } as Partial<SyncChange>;
  delete legacyCompatible.repeat;
  delete legacyCompatible.startAt;
  delete legacyCompatible.baseAtLocal;
  delete legacyCompatible.nextTriggerAt;
  delete legacyCompatible.lastFiredAt;
  delete legacyCompatible.lastAcknowledgedAt;
  return legacyCompatible as SyncChange;
}

/**
 * Create a new note from a draft.
 */
export async function createNote(sync: SyncFn, userId: string, draft: NoteEditorDraft) {
  const now = Date.now();
  const id = draft.id ?? crypto.randomUUID();
  const reminderFields = buildReminderSyncFields(
    draft.done
      ? { reminder: null, repeat: null }
      : { reminder: draft.reminder, repeat: draft.repeat },
    new Date(now),
    getResolvedTimezone(),
  );
  return sync({
    userId,
    lastSyncAt: now,
    changes: [
      toLegacySyncChange({
        id,
        userId,
        title: draft.title || undefined,
        content: draft.content || undefined,
        contentType: draft.contentType === 'checklist' ? 'checklist' : undefined,
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
export async function updateNote(
  sync: SyncFn,
  userId: string,
  draft: NoteEditorDraft,
  existingNote: WebNote,
) {
  const now = Date.now();
  const id = draft.id ?? existingNote.id;
  const reminderFields = buildReminderSyncFields(
    draft.done
      ? { reminder: null, repeat: null }
      : { reminder: draft.reminder, repeat: draft.repeat },
    new Date(now),
    getResolvedTimezone(),
    existingNote,
  );
  return sync({
    userId,
    lastSyncAt: now,
    changes: [
      toLegacySyncChange({
        id,
        userId,
        title: draft.title || undefined,
        content: draft.content || undefined,
        contentType: draft.contentType === 'checklist' ? 'checklist' : undefined,
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
export async function deleteNote(sync: SyncFn, userId: string, id: string) {
  const now = Date.now();
  return sync({
    userId,
    lastSyncAt: now,
    changes: [
      {
        id,
        userId,
        active: false,
        deletedAt: now,
        operation: 'delete',
        deviceId: 'web',
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Trash helpers
// ---------------------------------------------------------------------------

export function useAllNotes(): WebNote[] | undefined {
  const { userId } = useWebAuth();
  const hooks = useBackendHooks();
  const raw = hooks.useAllNotes(userId);
  if (raw === undefined) return undefined;
  return raw.map(mapDocToWebNote);
}

export function usePermanentlyDeleteNote() {
  const client = useBackendClient();
  return useCallback(
    (args: { userId: string; noteId: string }) =>
      client.permanentlyDeleteNote(args.userId, args.noteId),
    [client],
  );
}

export function useEmptyTrash() {
  const client = useBackendClient();
  return useCallback((args: { userId: string }) => client.emptyTrash(args.userId), [client]);
}

/**
 * Restore a soft-deleted note (sets active: true, clears reminder fields).
 */
export async function restoreNote(sync: SyncFn, userId: string, note: WebNote) {
  const now = Date.now();
  return sync({
    userId,
    lastSyncAt: now,
    changes: [
      toLegacySyncChange({
        id: note.id,
        userId,
        title: note.title || undefined,
        content: note.content || undefined,
        contentType: note.contentType === 'checklist' ? 'checklist' : undefined,
        color: note.color ?? undefined,
        active: true,
        done: note.done,
        isPinned: note.isPinned,
        // Clear all reminder fields
        triggerAt: undefined,
        repeatRule: undefined,
        repeatConfig: undefined,
        snoozedUntil: undefined,
        scheduleStatus: undefined,
        timezone: undefined,
        repeat: null,
        startAt: null,
        baseAtLocal: null,
        nextTriggerAt: null,
        lastFiredAt: null,
        lastAcknowledgedAt: null,
        operation: 'update',
        deviceId: 'web',
        version: note.version,
        createdAt: note.createdAt,
        updatedAt: now,
      }),
    ],
  });
}
