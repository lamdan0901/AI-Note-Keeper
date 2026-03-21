import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { type Note } from '../db/notesRepo';
import { coerceRepeatRule } from '../../../../packages/shared/utils/repeatCodec';

const DEFAULT_USER_ID = 'local-user';

function resolveUserId(): string {
  const envUser = process.env.EXPO_PUBLIC_USER_ID;
  return envUser || DEFAULT_USER_ID;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDocToMobileNote(doc: any): Note {
  const repeat = coerceRepeatRule({
    repeat: doc.repeat,
    repeatRule: doc.repeatRule,
    repeatConfig: doc.repeatConfig,
    triggerAt: doc.triggerAt,
  });

  return {
    id: doc.id as string,
    userId: doc.userId as string,
    title: (doc.title ?? null) as string | null,
    content: (doc.content ?? null) as string | null,
    contentType: doc.contentType as Note['contentType'],
    color: (doc.color ?? null) as string | null,
    active: Boolean(doc.active),
    done: Boolean(doc.done),
    isPinned: Boolean(doc.isPinned),
    triggerAt: doc.triggerAt,
    repeatRule: doc.repeatRule,
    repeatConfig: doc.repeatConfig,
    repeat,
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
    syncStatus: 'synced',
    serverVersion: (doc.version ?? 0) as number,
    updatedAt: doc.updatedAt as number,
    createdAt: doc.createdAt as number,
  };
}

export function useRealtimeNotes(enabled = true): Note[] | undefined {
  const raw = useQuery(
    api.functions.notes.getNotes,
    enabled ? { userId: resolveUserId() } : 'skip',
  );
  if (raw === undefined) return undefined;
  return raw.map(mapDocToMobileNote).filter((note) => note.active);
}
