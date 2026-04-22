import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const resolveCurrentUserIdMock = jest.fn();
const fetchNotesMock = jest.fn();
const upsertNoteMock = jest.fn(async () => undefined);
const getNoteByIdMock = jest.fn(async () => null);
const markNoteConflictMock = jest.fn(async () => undefined);
const markNoteSyncedMock = jest.fn(async () => undefined);
const getAllOutboxEntriesMock = jest.fn(async () => []);
const processQueueMock = jest.fn(async () => ({
  total: 0,
  succeeded: 0,
  failed: 0,
  results: [],
}));
const getQueueStatsMock = jest.fn(async () => ({
  pending: 0,
  retrying: 0,
  maxedOut: 0,
}));
const isLogoutTransitionActiveMock = jest.fn(() => false);

jest.mock('../../src/auth/session', () => ({
  resolveCurrentUserId: resolveCurrentUserIdMock,
}));

jest.mock('../../src/auth/logoutState', () => ({
  isLogoutTransitionActive: isLogoutTransitionActiveMock,
}));

jest.mock('../../src/sync/fetchNotes', () => ({
  fetchNotes: fetchNotesMock,
}));

jest.mock('../../src/db/notesRepo', () => ({
  upsertNote: upsertNoteMock,
  getNoteById: getNoteByIdMock,
}));

jest.mock('../../src/db/syncHelpers', () => ({
  markNoteConflict: markNoteConflictMock,
  markNoteSynced: markNoteSyncedMock,
}));

jest.mock('../../src/sync/conflictResolution', () => ({
  resolveNoteConflict: jest.fn(() => ({
    type: 'none',
    mergedNote: {
      id: 'note-1',
      title: 'server',
      content: 'body',
      active: true,
      done: false,
      isPinned: false,
      updatedAt: 1,
      createdAt: 1,
      version: 1,
      serverVersion: 0,
      syncStatus: 'synced',
    },
  })),
}));

jest.mock('../../src/sync/noteOutbox', () => ({
  enqueueNoteOperation: jest.fn(async () => undefined),
  getAllOutboxEntries: getAllOutboxEntriesMock,
  getPendingOperations: jest.fn(async () => []),
  markOperationFailed: jest.fn(async () => undefined),
  clearSuccessfulOperations: jest.fn(async () => undefined),
}));

jest.mock('../../src/sync/syncQueueProcessor', () => ({
  processQueue: processQueueMock,
  getQueueStats: getQueueStatsMock,
}));

import { syncNotes } from '../../src/sync/noteSync';

describe('syncNotes stale-user guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('aborts before writing when the active user changes after pull', async () => {
    (resolveCurrentUserIdMock as any)
      .mockResolvedValueOnce('account-user-1')
      .mockResolvedValueOnce('device-user-1');

    (fetchNotesMock as any).mockResolvedValue({
      status: 'ok',
      notes: [
        {
          id: 'note-1',
          userId: 'account-user-1',
          title: 'Server note',
          content: 'From server',
          active: true,
          done: false,
          isPinned: false,
          updatedAt: 10,
          createdAt: 5,
          version: 2,
        },
      ],
      syncedAt: 123,
    });

    const db = {
      getFirstAsync: jest.fn(async () => ({ count: 0 })),
      getAllAsync: jest.fn(async () => []),
      runAsync: jest.fn(async () => undefined),
    };

    const result = await syncNotes(db as never, 'account-user-1');

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: 'Sync aborted because the active user changed during post-pull',
        pullCount: 1,
      }),
    );
    expect(fetchNotesMock).toHaveBeenCalledWith('account-user-1');
    expect(upsertNoteMock).not.toHaveBeenCalled();
    expect(markNoteSyncedMock).not.toHaveBeenCalled();
    expect(processQueueMock).not.toHaveBeenCalled();
  });

  it('aborts immediately during a logout transition', async () => {
    (isLogoutTransitionActiveMock as any).mockReturnValue(true);

    const db = {
      getFirstAsync: jest.fn(async () => ({ count: 0 })),
      getAllAsync: jest.fn(async () => []),
      runAsync: jest.fn(async () => undefined),
    };

    const result = await syncNotes(db as never, 'account-user-1');

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: 'Sync aborted because the active user changed during logout',
        pullCount: 0,
      }),
    );
    expect(fetchNotesMock).not.toHaveBeenCalled();
    expect(processQueueMock).not.toHaveBeenCalled();

    (isLogoutTransitionActiveMock as any).mockReturnValue(false);
  });
});
