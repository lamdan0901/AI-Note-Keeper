import { sha256 } from 'js-sha256';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uuidv4 } from '../../../../packages/shared/utils/uuid';
import type { NoteEditorDraft, WebNote } from './notesTypes';
import { buildReminderSyncFields } from './reminderUtils';
import { useWebAuth } from '../auth/AuthContext';
import { createWebApiClient } from '../api/httpClient';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export function getResolvedTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export const NOTES_POLL_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Raw API note document -> WebNote mapper
// ---------------------------------------------------------------------------

// The Convex `notes` query returns documents with internal fields `_id` and
// `_creationTime` in addition to the schema fields.  We strip those and
// normalise optional booleans so the rest of the app works with plain values.
const toEpochMs = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
};

const toNullableEpochMs = (value: unknown): number | null | undefined => {
  if (value === null) {
    return null;
  }

  return toEpochMs(value);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDocToWebNote(doc: any): WebNote {
  return {
    id: String(doc.id),
    userId: String(doc.userId),
    title: doc.title ?? null,
    content: doc.content ?? null,
    contentType: doc.contentType ?? undefined,
    color: doc.color ?? null,
    active: Boolean(doc.active),
    done: doc.done ?? false,
    isPinned: doc.isPinned ?? false,

    // Reminder-related fields (preserved as-is; never modified by web)
    triggerAt: toEpochMs(doc.triggerAt),
    repeatRule: doc.repeatRule,
    repeatConfig: doc.repeatConfig,
    repeat: doc.repeat,
    snoozedUntil: toNullableEpochMs(doc.snoozedUntil),
    scheduleStatus: doc.scheduleStatus,
    timezone: doc.timezone,
    baseAtLocal: doc.baseAtLocal ?? null,
    startAt: toNullableEpochMs(doc.startAt) ?? null,
    nextTriggerAt: toNullableEpochMs(doc.nextTriggerAt) ?? null,
    lastFiredAt: toNullableEpochMs(doc.lastFiredAt) ?? null,
    lastAcknowledgedAt: toNullableEpochMs(doc.lastAcknowledgedAt) ?? null,

    version: doc.version,
    deletedAt: toEpochMs(doc.deletedAt),
    updatedAt: toEpochMs(doc.updatedAt) ?? Date.now(),
    createdAt: toEpochMs(doc.createdAt) ?? Date.now(),
  };
}

type NotesSyncChange = Readonly<{
  id: string;
  userId: string;
  operation: 'create' | 'update' | 'delete';
  title?: string;
  content?: string;
  contentType?: string;
  color?: string;
  active?: boolean;
  done?: boolean;
  isPinned?: boolean;
  triggerAt?: number;
  repeatRule?: string;
  repeatConfig?: Record<string, unknown> | null;
  snoozedUntil?: number;
  scheduleStatus?: string;
  timezone?: string;
  repeat?: Record<string, unknown> | null;
  startAt?: number | null;
  baseAtLocal?: string | null;
  nextTriggerAt?: number | null;
  lastFiredAt?: number | null;
  lastAcknowledgedAt?: number | null;
  deletedAt?: number;
  version?: number;
  createdAt: number;
  updatedAt: number;
}>;

type NotesSyncRequest = Readonly<{
  userId: string;
  lastSyncAt: number;
  changes: ReadonlyArray<NotesSyncChange>;
}>;

type NotesSyncResponse = Readonly<{
  notes: ReadonlyArray<unknown>;
  syncedAt: number;
}>;

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const toSyncPayload = (change: NotesSyncChange): Record<string, unknown> => {
  const payloadForHash: Record<string, unknown> = {
    ...change,
    deviceId: 'web',
  };

  const payloadHash = sha256(stableStringify(payloadForHash));
  return {
    ...payloadForHash,
    payloadHash,
  };
};

const notesRefreshListeners = new Set<() => void>();

const subscribeToNotesRefresh = (listener: () => void): (() => void) => {
  notesRefreshListeners.add(listener);
  return () => {
    notesRefreshListeners.delete(listener);
  };
};

export const requestNotesRefresh = (): void => {
  for (const listener of notesRefreshListeners) {
    listener();
  }
};

const useNotesRefreshSignal = (): number => {
  const [signal, setSignal] = useState(0);

  useEffect(() => {
    return subscribeToNotesRefresh(() => {
      setSignal((previousSignal) => previousSignal + 1);
    });
  }, []);

  return signal;
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Returns the filtered (active-only) and sorted list of notes for the current
 * user, or `undefined` while the query is loading.
 */
export function useNotes(): WebNote[] | undefined {
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const [notes, setNotes] = useState<WebNote[] | undefined>(undefined);
  const refreshSignal = useNotesRefreshSignal();
  const previousClientRef = useRef<ReturnType<typeof createWebApiClient> | null>(null);

  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

  useEffect(() => {
    const hasClientChanged = previousClientRef.current !== apiClient;
    if (hasClientChanged) {
      previousClientRef.current = apiClient;
      setNotes(undefined);
    }
  }, [apiClient]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response =
          await apiClient.requestJson<Readonly<{ notes: ReadonlyArray<unknown> }>>('/api/notes');
        if (!cancelled) {
          setNotes(response.notes.map((entry) => mapDocToWebNote(entry)));
        }
      } catch {
        if (!cancelled) {
          setNotes([]);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [apiClient, refreshSignal]);

  return notes;
}

/**
 * Returns the raw `syncNotes` mutation function from Convex.
 * Use the helper wrappers below (`createNote`, `updateNote`, `deleteNote`)
 * rather than calling this directly.
 */
export function useSyncNotes() {
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

  return useCallback(
    async (input: NotesSyncRequest): Promise<Readonly<{ notes: ReadonlyArray<unknown> }>> => {
      const payload = {
        lastSyncAt: input.lastSyncAt,
        changes: input.changes.map((change) => toSyncPayload(change)),
      };

      const response = await apiClient.requestJson<NotesSyncResponse>('/api/notes/sync', {
        method: 'POST',
        body: payload,
      });

      requestNotesRefresh();
      return response;
    },
    [apiClient],
  );
}

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

type SyncFn = ReturnType<typeof useSyncNotes>;
type SyncChange = Parameters<SyncFn>[0]['changes'][number];

const LEGACY_REMINDER_FIELDS = new Set([
  'repeat',
  'startAt',
  'baseAtLocal',
  'nextTriggerAt',
  'lastFiredAt',
  'lastAcknowledgedAt',
]);

function toLegacySyncChange(change: SyncChange): SyncChange {
  const filteredEntries = Object.entries(change).filter(
    ([key]) => !LEGACY_REMINDER_FIELDS.has(key),
  );
  return Object.fromEntries(filteredEntries) as SyncChange;
}

/**
 * Create a new note from a draft.
 */
export async function createNote(sync: SyncFn, userId: string, draft: NoteEditorDraft) {
  const now = Date.now();
  const id = draft.id ?? uuidv4();
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
  return useNotes();
}

export function usePermanentlyDeleteNote() {
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

  return useCallback(
    async (
      input: Readonly<{ userId?: string; noteId: string }>,
    ): Promise<Readonly<{ deleted: boolean }>> => {
      const response = await apiClient.requestJson<Readonly<{ deleted: boolean }>>(
        `/api/notes/${input.noteId}/permanent`,
        {
          method: 'DELETE',
        },
      );
      requestNotesRefresh();
      return response;
    },
    [apiClient],
  );
}

export function useEmptyTrash() {
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

  return useCallback(
    async (input?: Readonly<{ userId?: string }>): Promise<Readonly<{ deleted: number }>> => {
      void input;
      const response = await apiClient.requestJson<Readonly<{ deleted: number }>>(
        '/api/notes/trash/empty',
        {
          method: 'DELETE',
        },
      );
      requestNotesRefresh();
      return response;
    },
    [apiClient],
  );
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
        version: note.version,
        createdAt: note.createdAt,
        updatedAt: now,
      }),
    ],
  });
}
