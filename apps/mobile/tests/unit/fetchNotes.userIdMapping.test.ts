import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import type { BackendClient } from '../../../../packages/shared/backend/types';
import type { Note } from '../../src/db/notesRepo';

import { fetchNotes } from '../../src/sync/fetchNotes';

const makeClient = (notes: Note[]) =>
  ({
    getNotes: jest.fn<() => Promise<Note[]>>().mockResolvedValue(notes),
  }) as unknown as BackendClient;

describe('fetchNotes userId mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves userId from server payload', async () => {
    const client = makeClient([
      {
        id: 'note-1',
        userId: 'account-user-1',
        title: 'Title',
        content: 'Body',
        active: true,
        done: false,
        isPinned: false,
        updatedAt: 1,
        createdAt: 1,
        version: 3,
      } as Note,
    ]);

    const result = await fetchNotes('account-user-1', client);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      throw new Error('Expected ok result');
    }

    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]?.userId).toBe('account-user-1');
  });

  it('falls back to requested userId when payload omits userId', async () => {
    const client = makeClient([
      {
        id: 'note-2',
        title: 'Title 2',
        content: 'Body 2',
        active: true,
        done: false,
        isPinned: false,
        updatedAt: 2,
        createdAt: 2,
        version: 1,
      } as Note,
    ]);

    const result = await fetchNotes('account-user-2', client);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      throw new Error('Expected ok result');
    }

    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]?.userId).toBe('account-user-2');
  });

  it('drops notes with mismatched payload userId', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = makeClient([
      {
        id: 'note-3',
        userId: 'other-user',
        title: 'Title 3',
        content: 'Body 3',
        active: true,
        done: false,
        isPinned: false,
        updatedAt: 3,
        createdAt: 3,
        version: 1,
      } as Note,
    ]);

    const result = await fetchNotes('account-user-3', client);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      throw new Error('Expected ok result');
    }

    expect(result.notes).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
