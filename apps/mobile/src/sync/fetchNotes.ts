import { type Note } from '../db/notesRepo';
import { coerceRepeatRule } from '../../../../packages/shared/utils/repeatCodec';
import { createDefaultMobileApiClient } from '../api/httpClient';

export type FetchNotesResult =
  | { status: 'ok'; notes: Note[]; syncedAt: number }
  | { status: 'error'; notes: null; error: unknown };

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Fetch notes timed out'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const toNumberOrUndefined = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsedFromIso = Date.parse(value);
    if (Number.isFinite(parsedFromIso)) {
      return parsedFromIso;
    }

    const parsedNumber = Number(value);
    if (Number.isFinite(parsedNumber)) {
      return parsedNumber;
    }
  }

  return undefined;
};

const toNullableString = (value: unknown): string | null => {
  return typeof value === 'string' ? value : null;
};

const toBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  return fallback;
};

export const fetchNotes = async (userId: string): Promise<FetchNotesResult> => {
  try {
    const client = createDefaultMobileApiClient();
    const response = await withTimeout(
      client.requestJson<Readonly<{ notes: ReadonlyArray<unknown> }>>('/api/notes'),
      15000,
    );
    const notes = response.notes as ReadonlyArray<Record<string, unknown>>;

    const mappedNotes: Note[] = notes.flatMap((n) => {
      const payloadUserId = typeof n.userId === 'string' ? n.userId : undefined;
      if (payloadUserId && payloadUserId !== userId) {
        console.warn('[Sync] Ignoring note with mismatched userId', {
          noteId: n.id,
          expectedUserId: userId,
          payloadUserId,
        });
        return [];
      }

      const normalizedUserId = payloadUserId ?? userId;
      const noteId = typeof n.id === 'string' && n.id.length > 0 ? n.id : null;
      const createdAt = toNumberOrUndefined(n.createdAt);
      const updatedAt = toNumberOrUndefined(n.updatedAt);

      if (!noteId || createdAt === undefined || updatedAt === undefined) {
        console.warn('[Sync] Ignoring malformed note payload', {
          payloadId: n.id,
          hasCreatedAt: createdAt !== undefined,
          hasUpdatedAt: updatedAt !== undefined,
        });
        return [];
      }

      const repeatRuleRaw = n.repeatRule;
      const repeatRuleValue: string | null | undefined =
        typeof repeatRuleRaw === 'string'
          ? repeatRuleRaw
          : repeatRuleRaw === null
            ? null
            : undefined;

      // Derive canonical repeat: prefer stored `repeat`, fall back to legacy fields
      const repeat = coerceRepeatRule({
        repeat: (n.repeat as Record<string, unknown> | null | undefined) ?? undefined,
        repeatRule: repeatRuleValue,
        repeatConfig:
          n.repeatConfig && typeof n.repeatConfig === 'object'
            ? (n.repeatConfig as Record<string, unknown>)
            : undefined,
        triggerAt: toNumberOrUndefined(n.triggerAt),
      });

      return {
        id: noteId,
        userId: normalizedUserId,
        title: toNullableString(n.title),
        content: toNullableString(n.content),
        contentType: (n.contentType as Note['contentType']) || undefined,
        color: toNullableString(n.color),
        active: toBoolean(n.active, true),
        done: toBoolean(n.done, false),

        isPinned: toBoolean(n.isPinned, false),
        triggerAt: toNumberOrUndefined(n.triggerAt),
        repeatRule: (n.repeatRule as Note['repeatRule']) || undefined,
        repeatConfig: (n.repeatConfig as Note['repeatConfig']) ?? undefined,
        // Always populate canonical repeat (derived if not stored)
        repeat,
        snoozedUntil: toNumberOrUndefined(n.snoozedUntil),
        scheduleStatus: (n.scheduleStatus as Note['scheduleStatus']) ?? undefined,
        timezone: typeof n.timezone === 'string' ? n.timezone : undefined,
        baseAtLocal: typeof n.baseAtLocal === 'string' ? n.baseAtLocal : null,
        startAt: toNumberOrUndefined(n.startAt) ?? null,
        nextTriggerAt: toNumberOrUndefined(n.nextTriggerAt) ?? null,
        lastFiredAt: toNumberOrUndefined(n.lastFiredAt) ?? null,
        lastAcknowledgedAt: toNumberOrUndefined(n.lastAcknowledgedAt) ?? null,
        version: toNumberOrUndefined(n.version) ?? 0,
        deletedAt: toNumberOrUndefined(n.deletedAt),

        updatedAt,
        createdAt,
      };
    });

    return { status: 'ok', notes: mappedNotes, syncedAt: Date.now() };
  } catch (error) {
    console.error(error);
    return { status: 'error', notes: null, error };
  }
};
