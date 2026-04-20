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

describe('Offline create sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test';
    getOrCreateDeviceIdMock.mockResolvedValue('device-1');
  });

  it('syncs offline-created reminders within 5 minutes after reconnect', async () => {
    getPendingOperationsMock.mockResolvedValue([
      {
        noteId: 'note-create-1',
        userId: 'user-1',
        operation: 'create',
        payloadJson: JSON.stringify({
          id: 'note-create-1',
          userId: 'user-1',
          title: 'Create offline',
          content: 'Body',
          active: true,
          done: false,
          isPinned: false,
          updatedAt: 100,
          createdAt: 100,
          version: 0,
          serverVersion: 0,
        }),
        payloadHash: 'hash-create-1',
        updatedAt: 100,
        createdAt: 100,
        attempts: 0,
        lastAttemptAt: null,
        retryCount: 0,
        nextRetryAt: null,
      },
    ]);

    requestJsonMock.mockResolvedValue({
      notes: [
        {
          id: 'note-create-1',
          version: 2,
        },
      ],
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
            id: 'note-create-1',
            operation: 'create',
            payloadHash: 'hash-create-1',
            deviceId: 'device-1',
          }),
        ],
      },
    });

    expect(clearSuccessfulOperationsMock).toHaveBeenCalledWith(db, ['note-create-1']);
    expect(markNoteSyncedMock).toHaveBeenCalledWith(db, 'note-create-1', 2);
    expect(markOperationFailedMock).not.toHaveBeenCalled();
  });

  it('ignores outbox entries from other users during sync', async () => {
    getPendingOperationsMock.mockResolvedValue([
      {
        noteId: 'note-create-active',
        userId: 'user-1',
        operation: 'create',
        payloadJson: JSON.stringify({
          id: 'note-create-active',
          userId: 'user-1',
          title: 'Active user note',
          content: 'Body',
          active: true,
          done: false,
          isPinned: false,
          updatedAt: 100,
          createdAt: 100,
          version: 0,
          serverVersion: 0,
        }),
        payloadHash: 'hash-active',
        updatedAt: 100,
        createdAt: 100,
        attempts: 0,
        lastAttemptAt: null,
        retryCount: 0,
        nextRetryAt: null,
      },
      {
        noteId: 'note-create-other',
        userId: 'user-2',
        operation: 'create',
        payloadJson: JSON.stringify({
          id: 'note-create-other',
          userId: 'user-2',
          title: 'Other user note',
          content: 'Body',
          active: true,
          done: false,
          isPinned: false,
          updatedAt: 101,
          createdAt: 101,
          version: 0,
          serverVersion: 0,
        }),
        payloadHash: 'hash-other',
        updatedAt: 101,
        createdAt: 101,
        attempts: 0,
        lastAttemptAt: null,
        retryCount: 0,
        nextRetryAt: null,
      },
    ]);

    requestJsonMock.mockResolvedValue({
      notes: [
        {
          id: 'note-create-active',
          version: 3,
        },
      ],
      syncedAt: Date.now(),
    });

    const db = {} as SQLiteDatabase;
    const result = await processQueue(db, 'user-1', { batchSize: 5, timeoutMs: 5000 });

    expect(result.total).toBe(1);
    expect(result.succeeded).toBe(1);

    expect(requestJsonMock).toHaveBeenCalledWith('/api/notes/sync', {
      method: 'POST',
      body: {
        lastSyncAt: 0,
        changes: [
          expect.objectContaining({
            id: 'note-create-active',
            userId: 'user-1',
          }),
        ],
      },
    });
  });
});
