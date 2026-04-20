import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const requestJsonMock = jest.fn() as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;

jest.mock('../../src/api/httpClient', () => ({
  createDefaultMobileApiClient: () => ({
    requestJson: requestJsonMock,
  }),
}));

import { fetchNotes } from '../../src/sync/fetchNotes';

describe('fetchNotes userId mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves userId from server payload', async () => {
    requestJsonMock.mockResolvedValue({
      notes: [
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
        },
      ],
    });

    const result = await fetchNotes('account-user-1');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      throw new Error('Expected ok result');
    }

    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]?.userId).toBe('account-user-1');
    expect(requestJsonMock).toHaveBeenCalledWith('/api/notes');
  });

  it('falls back to requested userId when payload omits userId', async () => {
    requestJsonMock.mockResolvedValue({
      notes: [
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
        },
      ],
    });

    const result = await fetchNotes('account-user-2');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      throw new Error('Expected ok result');
    }

    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]?.userId).toBe('account-user-2');
  });

  it('drops notes with mismatched payload userId', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    requestJsonMock.mockResolvedValue({
      notes: [
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
        },
      ],
    });

    const result = await fetchNotes('account-user-3');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      throw new Error('Expected ok result');
    }

    expect(result.notes).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
