import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../convex/_generated/api';
import { type Note } from '../db/notesRepo';

export type FetchNotesResult =
  | { status: 'ok'; notes: Note[]; syncedAt: number }
  | { status: 'error'; notes: null; error: unknown };

export const fetchNotes = async (userId: string): Promise<FetchNotesResult> => {
  try {
    const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
    if (!convexUrl) throw new Error('Missing Convex URL');

    const client = new ConvexHttpClient(convexUrl);

    // For MVP, we are just fetching all notes. In real world we would delta sync.
    // However, the `syncNotes` mutation defined earlier returns all notes,
    // but here we might want just a query if we were doing pure pull.
    // Instead, let's use the query.

    const notes = (await client.query(api.functions.notes.getNotes, { userId })) as Note[];

    // Map Convex result to local Note type if needed (mostly same)
    const mappedNotes: Note[] = notes.map((n) => ({
      id: n.id,
      title: n.title ?? null,
      content: n.content ?? null,
      color: n.color ?? null,
      active: n.active,
      done: n.done ?? false,

      triggerAt: n.triggerAt,
      repeatRule: n.repeatRule,
      repeatConfig: n.repeatConfig,
      snoozedUntil: n.snoozedUntil,
      scheduleStatus: n.scheduleStatus,
      timezone: n.timezone,

      updatedAt: n.updatedAt,
      createdAt: n.createdAt,
    }));

    return { status: 'ok', notes: mappedNotes, syncedAt: Date.now() };
  } catch (error) {
    console.error(error);
    return { status: 'error', notes: null, error };
  }
};
