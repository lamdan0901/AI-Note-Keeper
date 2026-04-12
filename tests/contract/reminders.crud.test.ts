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

describe('createReminder (POST /)', () => {
  test('should create reminder document and return 201', async () => {
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/',
      headers: AUTH,
      body: JSON.stringify({
        userId: USER,
        triggerAt: 1700000000000,
        active: true,
        timezone: 'UTC',
        scheduleStatus: 'unscheduled',
        updatedAt: 1700000000000,
        createdAt: 1700000000000,
      }),
    });

    await main(context);

    expect(responses[0].status).toBe(201);
    expect(mockCreateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      expect.any(String),
      expect.objectContaining({
        userId: USER,
        triggerAt: 1700000000000,
        scheduleStatus: 'unscheduled',
      }),
    );
  });

  test('should emit change event on create', async () => {
    const { context } = makeContext({
      method: 'POST',
      path: '/',
      headers: AUTH,
      body: JSON.stringify({
        userId: USER,
        triggerAt: 1700000000000,
        active: true,
        timezone: 'UTC',
      }),
    });

    await main(context);

    expect(mockCreateDocument).toHaveBeenCalledWith(
      DB,
      EVENTS,
      expect.any(String),
      expect.objectContaining({
        operation: 'create',
        userId: USER,
        changedAt: expect.any(Number),
      }),
    );
  });

  test('should fire push notification on create', async () => {
    const { context } = makeContext({
      method: 'POST',
      path: '/',
      headers: AUTH,
      body: JSON.stringify({
        userId: USER,
        triggerAt: 1700000000000,
        active: true,
        timezone: 'UTC',
      }),
    });

    await main(context);

    expect(mockCreateExecution).toHaveBeenCalled();
  });

  test('should use provided id if given', async () => {
    const { context } = makeContext({
      method: 'POST',
      path: '/',
      headers: AUTH,
      body: JSON.stringify({
        id: 'my-custom-id',
        userId: USER,
        triggerAt: 1700000000000,
        active: true,
        timezone: 'UTC',
      }),
    });

    await main(context);

    expect(mockCreateDocument).toHaveBeenCalledWith(DB, NOTES, 'my-custom-id', expect.any(Object));
  });

  test('should reject mismatched userId with 403', async () => {
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/',
      headers: AUTH,
      body: JSON.stringify({ userId: 'other-user', triggerAt: 1700000000000 }),
    });

    await main(context);

    expect(responses[0].status).toBe(403);
    expect(mockCreateDocument).not.toHaveBeenCalled();
  });

  test('should return 401 when no auth header', async () => {
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/',
      body: JSON.stringify({ userId: USER, triggerAt: 1700000000000 }),
    });

    await main(context);

    expect(responses[0].status).toBe(401);
  });
});

describe('deleteReminder (DELETE /:id)', () => {
  test('should delete the document and return id', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });

    const { context, responses } = makeContext({
      method: 'DELETE',
      path: '/reminder-1',
      headers: AUTH,
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    expect((responses[0].data as { id: string }).id).toBe('reminder-1');
    expect(mockDeleteDocument).toHaveBeenCalledWith(DB, NOTES, 'reminder-1');
  });

  test('should emit delete change event', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });

    const { context } = makeContext({
      method: 'DELETE',
      path: '/reminder-1',
      headers: AUTH,
    });

    await main(context);

    expect(mockCreateDocument).toHaveBeenCalledWith(
      DB,
      EVENTS,
      expect.any(String),
      expect.objectContaining({
        operation: 'delete',
        noteId: 'reminder-1',
        userId: USER,
      }),
    );
  });

  test('should fire push notification on delete', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });

    const { context } = makeContext({
      method: 'DELETE',
      path: '/reminder-1',
      headers: AUTH,
    });

    await main(context);

    expect(mockCreateExecution).toHaveBeenCalled();
  });

  test('should return 404 when reminder not found', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const { context, responses } = makeContext({
      method: 'DELETE',
      path: '/reminder-missing',
      headers: AUTH,
    });

    await main(context);

    expect(responses[0].status).toBe(404);
    expect(mockDeleteDocument).not.toHaveBeenCalled();
  });
});
