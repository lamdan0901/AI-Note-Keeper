import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SQLiteDatabase } from 'expo-sqlite/next';

const requestJsonMock = jest.fn() as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
const getPendingOperationsMock = jest.fn() as jest.MockedFunction<
  (...args: unknown[]) => Promise<unknown>
>;
const markOperationFailedMock = jest.fn() as jest.MockedFunction<
  (...args: unknown[]) => Promise<unknown>
>;
const clearSuccessfulOperationsMock = jest.fn() as jest.MockedFunction<
  (...args: unknown[]) => Promise<unknown>
>;
const markNoteSyncedMock = jest.fn() as jest.MockedFunction<
  (...args: unknown[]) => Promise<unknown>
>;
const getOrCreateDeviceIdMock = jest.fn() as jest.MockedFunction<
  (...args: unknown[]) => Promise<unknown>
>;

jest.mock('../../src/api/httpClient', () => ({
  createDefaultMobileApiClient: () => ({
    requestJson: requestJsonMock,
  }),
}));

jest.mock('../../src/sync/noteOutbox', () => ({
  getPendingOperations: getPendingOperationsMock,
  markOperationFailed: markOperationFailedMock,
  clearSuccessfulOperations: clearSuccessfulOperationsMock,
}));

jest.mock('../../src/db/syncHelpers', () => ({
  markNoteSynced: markNoteSyncedMock,
}));

jest.mock('../../src/auth/session', () => ({
  getOrCreateDeviceId: getOrCreateDeviceIdMock,
}));

import { processQueue } from '../../src/sync/syncQueueProcessor';

describe('Offline delete sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test';
    getOrCreateDeviceIdMock.mockResolvedValue('device-1');
  });

  it('syncs offline-deleted reminders within 5 minutes after reconnect', async () => {
    getPendingOperationsMock.mockResolvedValue([
      {
        noteId: 'note-delete-1',
        userId: 'user-1',
        operation: 'delete',
        payloadJson: JSON.stringify({
          id: 'note-delete-1',
          userId: 'user-1',
          title: 'Delete offline',
          content: 'Body',
          active: false,
          done: false,
          isPinned: false,
          deletedAt: 120,
          updatedAt: 120,
          createdAt: 100,
          version: 1,
          serverVersion: 1,
        }),
        payloadHash: 'hash-delete-1',
        updatedAt: 120,
        createdAt: 100,
        attempts: 0,
        lastAttemptAt: null,
        retryCount: 0,
        nextRetryAt: null,
      },
    ]);

    // Backend can omit deleted items from notes array; delete should still be treated as success.
    requestJsonMock.mockResolvedValue({
      notes: [],
      syncedAt: Date.now(),
    });

    const db = {} as SQLiteDatabase;
    const result = await processQueue(db, 'user-1', { batchSize: 5, timeoutMs: 5000 });

    expect(result.total).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    expect(requestJsonMock).toHaveBeenCalledWith('/api/notes/sync', {
      method: 'POST',
      body: {
        lastSyncAt: 0,
        changes: [
          expect.objectContaining({
            id: 'note-delete-1',
            operation: 'delete',
            payloadHash: 'hash-delete-1',
            deviceId: 'device-1',
          }),
        ],
      },
    });

    expect(clearSuccessfulOperationsMock).toHaveBeenCalledWith(db, ['note-delete-1']);
    expect(markNoteSyncedMock).not.toHaveBeenCalled();
    expect(markOperationFailedMock).not.toHaveBeenCalled();
  });
});
