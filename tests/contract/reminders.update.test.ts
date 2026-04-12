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
}));

import main from '../../appwrite-functions/reminders-api/src/main';

const DB = 'ai-note-keeper';
const NOTES = 'notes';
const EVENTS = 'noteChangeEvents';
const USER = 'user-abc';
const AUTH = withAuth(USER);

const sampleDoc = {
  $id: 'reminder-1',
  userId: USER,
  title: 'Test reminder',
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
  updatedAt: 1000,
  createdAt: 900,
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
  mockCreateDocument.mockImplementation(
    (_db: string, _col: string, id: string, data: unknown) =>
      Promise.resolve({ $id: id, ...(data as object) }),
  );
  mockUpdateDocument.mockImplementation(
    (_db: string, _col: string, id: string, data: unknown) =>
      Promise.resolve({ ...sampleDoc, $id: id, ...(data as object) }),
  );
  mockDeleteDocument.mockResolvedValue({});
});

describe('updateReminder (PATCH /:id)', () => {
  test('should update reminder fields and return updated doc', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });

    const { context, responses } = makeContext({
      method: 'PATCH',
      path: '/reminder-1',
      headers: AUTH,
      body: JSON.stringify({
        title: 'Updated Title',
        updatedAt: 5000, // > sampleDoc.updatedAt (1000)
      }),
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      'reminder-1',
      expect.objectContaining({
        title: 'Updated Title',
        updatedAt: 5000,
      }),
    );
  });

  test('should skip update when incoming updatedAt is older (LWW)', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });

    const { context, responses } = makeContext({
      method: 'PATCH',
      path: '/reminder-1',
      headers: AUTH,
      body: JSON.stringify({
        title: 'Stale Update',
        updatedAt: 500, // < sampleDoc.updatedAt (1000)
      }),
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  test('should emit change event on update', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });

    const { context } = makeContext({
      method: 'PATCH',
      path: '/reminder-1',
      headers: AUTH,
      body: JSON.stringify({ title: 'New Title', updatedAt: 5000 }),
    });

    await main(context);

    expect(mockCreateDocument).toHaveBeenCalledWith(
      DB,
      EVENTS,
      expect.any(String),
      expect.objectContaining({
        operation: 'update',
        noteId: 'reminder-1',
        userId: USER,
      }),
    );
  });

  test('should fire push notification on update', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });

    const { context } = makeContext({
      method: 'PATCH',
      path: '/reminder-1',
      headers: AUTH,
      body: JSON.stringify({ title: 'New Title', updatedAt: 5000 }),
    });

    await main(context);

    expect(mockCreateExecution).toHaveBeenCalled();
  });

  test('should return 404 when reminder not found', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const { context, responses } = makeContext({
      method: 'PATCH',
      path: '/reminder-missing',
      headers: AUTH,
      body: JSON.stringify({ title: 'X', updatedAt: 5000 }),
    });

    await main(context);

    expect(responses[0].status).toBe(404);
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  test('should serialize repeat field to JSON string', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });

    const repeat = { kind: 'daily', interval: 1 };
    const { context } = makeContext({
      method: 'PATCH',
      path: '/reminder-1',
      headers: AUTH,
      body: JSON.stringify({ repeat, updatedAt: 5000 }),
    });

    await main(context);

    expect(mockUpdateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      'reminder-1',
      expect.objectContaining({
        repeat: JSON.stringify(repeat),
      }),
    );
  });
});
