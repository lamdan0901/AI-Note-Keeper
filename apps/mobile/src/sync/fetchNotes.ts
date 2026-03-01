import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../convex/_generated/api';
import { type Note } from '../db/notesRepo';
import { coerceRepeatRule } from '../../../../packages/shared/utils/repeatCodec';

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

export const fetchNotes = async (userId: string): Promise<FetchNotesResult> => {
  try {
    const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
    if (!convexUrl) throw new Error('Missing Convex URL');

    const client = new ConvexHttpClient(convexUrl);

    // For MVP, we are just fetching all notes. In real world we would delta sync.
    // However, the `syncNotes` mutation defined earlier returns all notes,
    // but here we might want just a query if we were doing pure pull.
    // Instead, let's use the query.

    const notes = (await withTimeout(
      client.query(api.functions.notes.getNotes, { userId }),
      15000,
    )) as Note[];

    // Map Convex result to local Note type if needed (mostly same)
    const mappedNotes: Note[] = notes.map((n) => {
      // Derive canonical repeat: prefer stored `repeat`, fall back to legacy fields
      const repeat = coerceRepeatRule({
        repeat: n.repeat,
        repeatRule: n.repeatRule,
        repeatConfig: n.repeatConfig,
        triggerAt: n.triggerAt,
      });

      return {
        id: n.id,
        title: n.title ?? null,
        content: n.content ?? null,
        color: n.color ?? null,
        active: n.active,
        done: n.done ?? false,

        isPinned: n.isPinned ?? false,
        triggerAt: n.triggerAt,
        repeatRule: n.repeatRule,
        repeatConfig: n.repeatConfig,
        // Always populate canonical repeat (derived if not stored)
        repeat,
        snoozedUntil: n.snoozedUntil,
        scheduleStatus: n.scheduleStatus,
        timezone: n.timezone,
        baseAtLocal: n.baseAtLocal ?? null,
        startAt: n.startAt ?? null,
        nextTriggerAt: n.nextTriggerAt ?? null,
        lastFiredAt: n.lastFiredAt ?? null,
        lastAcknowledgedAt: n.lastAcknowledgedAt ?? null,
        version: n.version,

        updatedAt: n.updatedAt,
        createdAt: n.createdAt,
      };
    });

    return { status: 'ok', notes: mappedNotes, syncedAt: Date.now() };
  } catch (error) {
    console.error(error);
    return { status: 'error', notes: null, error };
  }
};
