import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Note } from '../../src/db/notesRepo';

jest.mock('../../src/sync/fetchNotes', () => ({
  fetchNotes: jest.fn(),
}));

import { startRealtimeNotesPolling } from '../../src/notes/realtimeService';

const activeNote = {
  id: 'note-1',
  userId: 'user-1',
  title: 'Keep',
  content: 'body',
  color: null,
  active: true,
  done: false,
  isPinned: false,
  updatedAt: 10,
  createdAt: 1,
} satisfies Note;

const inactiveNote = {
  ...activeNote,
  id: 'note-2',
  active: false,
} satisfies Note;

describe('realtime notes polling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('skips initial fetch when requested', async () => {
    const refreshNotes = jest.fn(async () => ({
      status: 'ok' as const,
      notes: [activeNote],
      syncedAt: 1,
    }));
    const onNotes = jest.fn();

    const stop = startRealtimeNotesPolling({
      userId: 'user-1',
      enabled: true,
      skipInitialRefresh: true,
      onNotes,
      refreshNotes,
    });

    await Promise.resolve();

    expect(refreshNotes).not.toHaveBeenCalled();
    expect(onNotes).not.toHaveBeenCalled();

    stop();
  });

  it('still polls later after initial fetch is skipped', async () => {
    const refreshNotes = jest.fn(async () => ({
      status: 'ok' as const,
      notes: [activeNote, inactiveNote],
      syncedAt: 1,
    }));
    const onNotes = jest.fn();

    const stop = startRealtimeNotesPolling({
      userId: 'user-1',
      enabled: true,
      skipInitialRefresh: true,
      onNotes,
      refreshNotes,
    });

    await jest.advanceTimersByTimeAsync(30_000);

    expect(refreshNotes).toHaveBeenCalledTimes(1);
    expect(onNotes).toHaveBeenCalledWith([activeNote]);

    stop();
  });

  it('does not fetch when disabled or userId is empty', async () => {
    const refreshNotes = jest.fn(async () => ({
      status: 'ok' as const,
      notes: [activeNote],
      syncedAt: 1,
    }));
    const onNotes = jest.fn();

    const stopDisabled = startRealtimeNotesPolling({
      userId: 'user-1',
      enabled: false,
      skipInitialRefresh: false,
      onNotes,
      refreshNotes,
    });
    const stopMissingUser = startRealtimeNotesPolling({
      userId: '',
      enabled: true,
      skipInitialRefresh: false,
      onNotes,
      refreshNotes,
    });

    await jest.advanceTimersByTimeAsync(30_000);

    expect(refreshNotes).not.toHaveBeenCalled();
    expect(onNotes).toHaveBeenNthCalledWith(1, []);
    expect(onNotes).toHaveBeenNthCalledWith(2, []);

    stopDisabled();
    stopMissingUser();
  });
});
