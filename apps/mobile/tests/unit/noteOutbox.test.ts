import { describe, expect, it, jest } from '@jest/globals';
import type { SQLiteDatabase } from 'expo-sqlite/next';

import { getPendingOperations, markOperationFailed } from '../../src/sync/noteOutbox';

describe('noteOutbox', () => {
  it('excludes maxed-out retry entries from automatic pending processing', async () => {
    const getAllAsync = jest.fn(async () => []);
    const db = {
      getAllAsync,
    } as unknown as SQLiteDatabase;

    await getPendingOperations(db, 1_700_000_000_000);

    const [query, params] = getAllAsync.mock.calls[0] as unknown as [
      string,
      ReadonlyArray<number>,
    ];

    expect(getAllAsync).toHaveBeenCalledTimes(1);
    expect(query).toContain('retryCount < ?');
    expect(params).toEqual([5, 1_700_000_000_000]);
  });

  it('persists the exhausted retry count when an entry reaches the max retry threshold', async () => {
    const getFirstAsync = jest.fn(async () => ({ retryCount: 4 }));
    const runAsync = jest.fn(async () => undefined);
    const db = {
      getFirstAsync,
      runAsync,
    } as unknown as SQLiteDatabase;

    await markOperationFailed(db, 'note-maxed', 'Internal server error', 1_700_000_000_000);

    const getFirstCall = getFirstAsync.mock.calls[0] as unknown as [string, ReadonlyArray<string>];
    const runCall = runAsync.mock.calls[0] as unknown as [string, ReadonlyArray<unknown>];

    expect(getFirstCall).toEqual([
      'SELECT retryCount FROM note_outbox WHERE noteId = ?',
      ['note-maxed'],
    ]);
    expect(runCall).toEqual([
      `UPDATE note_outbox 
       SET retryCount = ?, 
           nextRetryAt = NULL,
           lastAttemptAt = ?
       WHERE noteId = ?`,
      [5, 1_700_000_000_000, 'note-maxed'],
    ]);
  });
});
