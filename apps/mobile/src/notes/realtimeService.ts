import { useEffect, useState } from 'react';
import { type Note } from '../db/notesRepo';
import { fetchNotes } from '../sync/fetchNotes';

const POLL_INTERVAL_MS = 30_000;

type UseRealtimeNotesOptions = {
  userId: string;
  enabled?: boolean;
  skipInitialRefresh?: boolean;
};

type StartRealtimeNotesPollingOptions = {
  userId: string;
  enabled: boolean;
  skipInitialRefresh: boolean;
  onNotes: (notes: Note[]) => void;
  refreshNotes?: typeof fetchNotes;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

export const startRealtimeNotesPolling = ({
  userId,
  enabled,
  skipInitialRefresh,
  onNotes,
  refreshNotes = fetchNotes,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}: StartRealtimeNotesPollingOptions): (() => void) => {
  if (!enabled || !userId) {
    onNotes([]);
    return () => undefined;
  }

  let cancelled = false;

  const refresh = async () => {
    const result = await refreshNotes(userId);
    if (cancelled) {
      return;
    }

    if (result.status === 'ok') {
      onNotes(result.notes.filter((note) => note.active));
      return;
    }

    onNotes([]);
  };

  if (!skipInitialRefresh) {
    void refresh();
  }

  const intervalId = setIntervalFn(() => {
    void refresh();
  }, POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearIntervalFn(intervalId);
  };
};

export function useRealtimeNotes({
  userId,
  enabled = true,
  skipInitialRefresh = false,
}: UseRealtimeNotesOptions): Note[] | undefined {
  const [notes, setNotes] = useState<Note[] | undefined>(enabled ? undefined : []);

  useEffect(() => {
    return startRealtimeNotesPolling({
      userId,
      enabled,
      skipInitialRefresh,
      onNotes: setNotes,
    });
  }, [enabled, skipInitialRefresh, userId]);

  return notes;
}
