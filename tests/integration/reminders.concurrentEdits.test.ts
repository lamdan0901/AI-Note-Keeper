import { test, expect, jest, describe, beforeEach } from '@jest/globals';
import { makeContext, withAuth } from '../helpers/makeContext';

const mockListDocuments = jest.fn() as any;
const mockCreateDocument = jest.fn() as any;
const mockUpdateDocument = jest.fn() as any;
const mockDeleteDocument = jest.fn() as any;
const mockCreateExecution = jest.fn() as any;

jest.mock('node-appwrite', () => ({
  Client: jest.fn().mockImplementation(() => ({
    setEndpoint: jest.fn().mockReturnThis(),
    setProject: jest.fn().mockReturnThis(),
    setKey: jest.fn().mockReturnThis(),
  })),
  Databases: jest.fn().mockImplementation(() => ({
    listDocuments: mockListDocuments,
    createDocument: mockCreateDocument,
    updateDocument: mockUpdateDocument,
    deleteDocument: mockDeleteDocument,
  })),
  Functions: jest.fn().mockImplementation(() => ({
    createExecution: mockCreateExecution,
  })),
  ID: { unique: () => 'gen-id' },
  Query: {
    equal: (field: string, value: string) => `${field}=${value}`,
    greaterThan: (field: string, value: number) => `${field}>${value}`,
  },
  Permission: {
    read: (role: string) => `read:${role}`,
    write: (role: string) => `write:${role}`,
  },
  Role: {
    user: (userId: string) => `user:${userId}`,
  },
}));

import main from '../../appwrite-functions/reminders-api/src/main';

const DB = 'ai-note-keeper';
const NOTES = 'notes';
const USER = 'user-abc';
const AUTH = withAuth(USER);

const baseDoc = {
  $id: 'reminder-1',
  userId: USER,
  title: 'Original Title',
  triggerAt: 2000,
  repeatRule: 'none',
  repeatConfig: null,
  repeat: null,
  baseAtLocal: null,
  startAt: null,
  nextTriggerAt: 2000,
  lastFiredAt: null,
  lastAcknowledgedAt: null,
  snoozedUntil: null,
  active: true,
  scheduleStatus: 'scheduled',
  timezone: 'UTC',
  version: 1,
  updatedAt: 2000,
  createdAt: 1000,
  done: false,
  isPinned: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APPWRITE_FUNCTION_API_ENDPOINT = 'https://cloud.appwrite.io/v1';
  process.env.APPWRITE_FUNCTION_API_KEY = 'test-key';
  process.env.APPWRITE_FUNCTION_PROJECT_ID = 'test-project-id';
  process.env.PUSH_FUNCTION_ID = 'push-fn-id';
  mockCreateExecution.mockResolvedValue({ $id: 'exec-1' });
  mockListDocuments.mockResolvedValue({ documents: [] });
  mockCreateDocument.mockImplementation((_db: string, _col: string, id: string, data: unknown) =>
    Promise.resolve({ $id: id, ...(data as object) }),
  );
  mockUpdateDocument.mockImplementation((_db: string, _col: string, id: string, data: unknown) =>
    Promise.resolve({ ...baseDoc, $id: id, ...(data as object) }),
  );
  mockDeleteDocument.mockResolvedValue({});
});

describe('Concurrent edits (last-write-wins) integration', () => {
  test('rejects stale update when updatedAt is older than existing', async () => {
    const existing = { ...baseDoc, updatedAt: 2000 };
    mockListDocuments.mockResolvedValue({ documents: [existing] });

    const { context, responses } = makeContext({
      method: 'PATCH',
      path: '/reminder-1',
      headers: AUTH,
      body: JSON.stringify({ title: 'Stale Title', updatedAt: 1500 }),
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  test('accepts newest update and emits change event', async () => {
    const existing = { ...baseDoc, updatedAt: 1000 };
    mockListDocuments.mockResolvedValue({ documents: [existing] });

    const { context, responses } = makeContext({
      method: 'PATCH',
      path: '/reminder-1',
      headers: AUTH,
      body: JSON.stringify({ title: 'Newest Title', updatedAt: 3000 }),
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      'reminder-1',
      expect.objectContaining({
        title: 'Newest Title',
        updatedAt: 3000,
      }),
    );
    expect(mockCreateDocument).toHaveBeenCalledWith(
      DB,
      'noteChangeEvents',
      expect.any(String),
      expect.objectContaining({
        noteId: 'reminder-1',
        operation: 'update',
      }),
      expect.any(Array),
    );
    expect(mockCreateExecution).toHaveBeenCalled();
  });

  test('two racing updates: only newer one persists', async () => {
    // Prove winner-only persistence using sequential LWW simulation:
    //   B (t=3000) arrives first → accepted, DB advances to t=3000
    //   A (t=1000) arrives after → rejected as stale (1000 < 3000)
    // This validates that once the winning write is committed, a lower-timestamp
    // write cannot overwrite it.
    let dbState = { ...baseDoc, updatedAt: 500 };

    mockListDocuments.mockImplementation(() => Promise.resolve({ documents: [{ ...dbState }] }));
    mockUpdateDocument.mockImplementation(
      (_db: string, _col: string, id: string, data: unknown) => {
        dbState = { ...dbState, ...(data as object) };
        return Promise.resolve({ ...dbState });
      },
    );

    // B writes first (t=3000 > existing t=500 → accepted)
    const { context: ctxB } = makeContext({
      method: 'PATCH',
      path: '/reminder-1',
      headers: AUTH,
      body: JSON.stringify({ title: 'Device B', updatedAt: 3000 }),
    });
    await main(ctxB);

    expect(mockUpdateDocument).toHaveBeenCalledTimes(1);
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      'reminder-1',
      expect.objectContaining({ title: 'Device B', updatedAt: 3000 }),
    );

    // Record call count after B so we can assert A adds zero more calls
    const callCountAfterB = (mockUpdateDocument.mock.calls as Array<unknown[]>).length;

    // A arrives late (t=1000 < DB state t=3000 → rejected as stale)
    const { context: ctxA } = makeContext({
      method: 'PATCH',
      path: '/reminder-1',
      headers: AUTH,
      body: JSON.stringify({ title: 'Device A', updatedAt: 1000 }),
    });
    await main(ctxA);

    // No additional updateDocument calls: A's lower-timestamp write was rejected
    expect((mockUpdateDocument.mock.calls as Array<unknown[]>).length).toBe(callCountAfterB);
    // DB state is still B's winning write
    expect(dbState.title).toBe('Device B');
    expect(dbState.updatedAt).toBe(3000);
  });
});
