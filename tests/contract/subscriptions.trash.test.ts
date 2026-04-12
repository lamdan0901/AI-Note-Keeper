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
    equal: (field: string, value: unknown) => `${field}=${String(value)}`,
    greaterThan: (field: string, value: number) => `${field}>${value}`,
  },
}));

import main from '../../appwrite-functions/subscriptions-api/src/main';

const DB = 'ai-note-keeper';
const SUBS = 'subscriptions';
const USER = 'user-abc';
const AUTH = withAuth(USER);
const DAY_MS = 24 * 60 * 60 * 1000;

const NOW_BILLING = Date.now() + 30 * DAY_MS;

const sampleSub = {
  $id: 'sub-1',
  userId: USER,
  serviceName: 'Netflix',
  category: 'streaming',
  price: 14.99,
  currency: 'USD',
  billingCycle: 'monthly',
  nextBillingDate: NOW_BILLING,
  reminderDaysBefore: JSON.stringify([3, 7]),
  status: 'active',
  active: true,
  createdAt: 1000,
  updatedAt: 1000,
  notes: null,
  deletedAt: null,
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
      Promise.resolve({ ...sampleSub, $id: id, ...(data as object) }),
  );
  mockDeleteDocument.mockResolvedValue({});
});

const deletedSub = {
  ...sampleSub,
  active: false,
  deletedAt: 500,
};

describe('deleteSubscription (DELETE /subscriptions/:id)', () => {
  test('should soft-delete by setting active=false and deletedAt', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleSub] });

    const { context, responses } = makeContext({
      method: 'DELETE',
      path: '/subscriptions/sub-1',
      headers: AUTH,
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      DB,
      SUBS,
      'sub-1',
      expect.objectContaining({
        active: false,
        deletedAt: expect.any(Number),
        updatedAt: expect.any(Number),
      }),
    );
  });

  test('should return 404 when subscription not found', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const { context, responses } = makeContext({
      method: 'DELETE',
      path: '/subscriptions/missing',
      headers: AUTH,
    });

    await main(context);

    expect(responses[0].status).toBe(404);
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });
});

describe('listDeletedSubscriptions (GET /subscriptions/deleted)', () => {
  test('should return deleted subscriptions sorted by deletedAt descending', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        { ...sampleSub, $id: 'sub-a', active: false, deletedAt: 100, updatedAt: 100 },
        { ...sampleSub, $id: 'sub-b', active: false, deletedAt: 300, updatedAt: 300 },
        { ...sampleSub, $id: 'sub-c', active: false, deletedAt: 200, updatedAt: 200 },
      ],
    });

    const { context, responses } = makeContext({
      method: 'GET',
      path: '/subscriptions/deleted',
      headers: AUTH,
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    const data = responses[0].data as Array<{ id: string }>;
    expect(data.map((d) => d.id)).toEqual(['sub-b', 'sub-c', 'sub-a']);
  });

  test('should query with active=false filter', async () => {
    const { context } = makeContext({
      method: 'GET',
      path: '/subscriptions/deleted',
      headers: AUTH,
    });

    await main(context);

    expect(mockListDocuments).toHaveBeenCalledWith(
      DB,
      SUBS,
      expect.arrayContaining(['active=false', `userId=${USER}`]),
    );
  });
});

describe('restoreSubscription (POST /subscriptions/:id/restore)', () => {
  test('should restore subscription to active', async () => {
    mockListDocuments.mockResolvedValue({ documents: [deletedSub] });

    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions/sub-1/restore',
      headers: AUTH,
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      DB,
      SUBS,
      'sub-1',
      expect.objectContaining({
        active: true,
        deletedAt: null,
        updatedAt: expect.any(Number),
      }),
    );
  });

  test('should return 404 when subscription not found', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions/missing/restore',
      headers: AUTH,
    });

    await main(context);

    expect(responses[0].status).toBe(404);
  });
});

describe('permanentlyDeleteSubscription (POST /subscriptions/:id/permanent-delete)', () => {
  test('should permanently delete inactive subscription', async () => {
    mockListDocuments.mockResolvedValue({ documents: [deletedSub] });

    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions/sub-1/permanent-delete',
      headers: AUTH,
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    expect(mockDeleteDocument).toHaveBeenCalledWith(DB, SUBS, 'sub-1');
  });

  test('should reject permanently deleting active subscription', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleSub] }); // active=true

    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions/sub-1/permanent-delete',
      headers: AUTH,
    });

    await main(context);

    expect(responses[0].status).toBe(400);
    expect(mockDeleteDocument).not.toHaveBeenCalled();
  });

  test('should return 404 when subscription not found', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions/missing/permanent-delete',
      headers: AUTH,
    });

    await main(context);

    expect(responses[0].status).toBe(404);
  });
});

describe('emptySubscriptionTrash (DELETE /subscriptions/trash)', () => {
  test('should delete all inactive subscriptions for user', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        { ...deletedSub, $id: 'sub-1' },
        { ...deletedSub, $id: 'sub-2' },
      ],
    });

    const { context, responses } = makeContext({
      method: 'DELETE',
      path: '/subscriptions/trash',
      headers: AUTH,
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    expect((responses[0].data as { deleted: number }).deleted).toBe(2);
    expect(mockDeleteDocument).toHaveBeenCalledTimes(2);
    expect(mockDeleteDocument).toHaveBeenCalledWith(DB, SUBS, 'sub-1');
    expect(mockDeleteDocument).toHaveBeenCalledWith(DB, SUBS, 'sub-2');
  });

  test('should return deleted=0 when trash is already empty', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const { context, responses } = makeContext({
      method: 'DELETE',
      path: '/subscriptions/trash',
      headers: AUTH,
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    expect((responses[0].data as { deleted: number }).deleted).toBe(0);
    expect(mockDeleteDocument).not.toHaveBeenCalled();
  });
});
