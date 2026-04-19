import { useEffect, useState } from 'react';
import { type Note } from '../db/notesRepo';
import { fetchNotes } from '../sync/fetchNotes';

const POLL_INTERVAL_MS = 30_000;

export function useRealtimeNotes(userId: string, enabled = true): Note[] | undefined {
  const [notes, setNotes] = useState<Note[] | undefined>(enabled ? undefined : []);

  useEffect(() => {
    if (!enabled || !userId) {
      setNotes([]);
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      const result = await fetchNotes(userId);
      if (cancelled) {
        return;
      }

      if (result.status === 'ok') {
        setNotes(result.notes.filter((note) => note.active));
      } else {
        setNotes([]);
      }
    };

    void refresh();
    const intervalId = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [enabled, userId]);

  return notes;
}
