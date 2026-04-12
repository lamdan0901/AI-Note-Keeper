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

describe('listReminders (GET /)', () => {
  test('should return empty array when no reminders exist', async () => {
    const { context, responses } = makeContext({
      method: 'GET',
      path: '/',
      headers: AUTH,
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    expect(responses[0].data).toEqual([]);
  });

  test('should return reminders filtered to only docs with triggerAt', async () => {
    const noTrigger = { ...sampleDoc, $id: 'note-1', triggerAt: null };
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc, noTrigger] });

    const { context, responses } = makeContext({
      method: 'GET',
      path: '/',
      headers: AUTH,
    });

    await main(context);

    const data = responses[0].data as unknown[];
    expect(data.length).toBe(1);
    expect((data[0] as { id: string }).id).toBe('reminder-1');
  });

  test('should query with userId filter', async () => {
    const { context } = makeContext({
      method: 'GET',
      path: '/',
      headers: AUTH,
    });

    await main(context);

    expect(mockListDocuments).toHaveBeenCalledWith(
      DB,
      NOTES,
      expect.arrayContaining([`userId=${USER}`]),
    );
  });

  test('should add updatedAt filter when updatedSince provided', async () => {
    const { context } = makeContext({
      method: 'GET',
      path: '/',
      headers: AUTH,
      query: { updatedSince: '1700000000000' },
    });

    await main(context);

    expect(mockListDocuments).toHaveBeenCalledWith(
      DB,
      NOTES,
      expect.arrayContaining([`userId=${USER}`, 'updatedAt>1700000000000']),
    );
  });

  test('should return 401 when no auth header', async () => {
    const { context, responses } = makeContext({ method: 'GET', path: '/' });

    await main(context);

    expect(responses[0].status).toBe(401);
  });
});

describe('getReminder (GET /:id)', () => {
  test('should return the reminder by id', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });

    const { context, responses } = makeContext({
      method: 'GET',
      path: '/reminder-1',
      headers: AUTH,
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    expect((responses[0].data as { id: string }).id).toBe('reminder-1');
  });

  test('should return 404 when reminder not found', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const { context, responses } = makeContext({
      method: 'GET',
      path: '/reminder-missing',
      headers: AUTH,
    });

    await main(context);

    expect(responses[0].status).toBe(404);
  });
});
