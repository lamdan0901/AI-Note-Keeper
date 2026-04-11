import { type Note } from '../db/notesRepo';
import { createConvexBackendClient } from '../../../../packages/shared/backend/convex';

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

    const client = createConvexBackendClient(convexUrl);
    if (!client) throw new Error('Failed to create backend client');

    const notes = await withTimeout(client.getNotes(userId), 15000);

    // Filter out notes with a mismatched userId (server safety check)
    const mappedNotes: Note[] = notes.flatMap((note) => {
      if (note.userId && note.userId !== userId) {
        console.warn('[Sync] Ignoring note with mismatched userId', {
          noteId: note.id,
          expectedUserId: userId,
          payloadUserId: note.userId,
        });
        return [];
      }
      return [{ ...note, userId: note.userId ?? userId }];
    });

    return { status: 'ok', notes: mappedNotes, syncedAt: Date.now() };
  } catch (error) {
    console.error(error);
    return { status: 'error', notes: null, error };
  }
};
