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
  Permission: {
    read: (role: string) => `read:${role}`,
    write: (role: string) => `write:${role}`,
  },
  Role: {
    user: (userId: string) => `user:${userId}`,
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
  mockCreateDocument.mockImplementation((_db: string, _col: string, id: string, data: unknown) =>
    Promise.resolve({ $id: id, ...(data as object) }),
  );
  mockUpdateDocument.mockImplementation((_db: string, _col: string, id: string, data: unknown) =>
    Promise.resolve({ ...sampleSub, $id: id, ...(data as object) }),
  );
  mockDeleteDocument.mockResolvedValue({});
});

describe('createSubscription (POST /subscriptions)', () => {
  test('should create subscription and return 201', async () => {
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions',
      headers: AUTH,
      body: JSON.stringify({
        userId: USER,
        serviceName: 'Netflix',
        category: 'streaming',
        price: 14.99,
        currency: 'USD',
        billingCycle: 'monthly',
        nextBillingDate: NOW_BILLING,
        status: 'active',
        reminderDaysBefore: [3, 7],
      }),
    });

    await main(context);

    expect(responses[0].status).toBe(201);
    expect(mockCreateDocument).toHaveBeenCalledWith(
      DB,
      SUBS,
      expect.any(String),
      expect.objectContaining({
        userId: USER,
        serviceName: 'Netflix',
        active: true,
      }),
      expect.any(Array),
    );
  });

  test('should compute nextReminderAt for billing date', async () => {
    const billingDate = Date.now() + 10 * DAY_MS;
    const { context } = makeContext({
      method: 'POST',
      path: '/subscriptions',
      headers: AUTH,
      body: JSON.stringify({
        userId: USER,
        serviceName: 'Spotify',
        price: 9.99,
        currency: 'USD',
        billingCycle: 'monthly',
        nextBillingDate: billingDate,
        status: 'active',
        reminderDaysBefore: [3, 7],
      }),
    });

    await main(context);

    const docFields = (mockCreateDocument.mock.calls[0] as unknown[])[3] as Record<string, unknown>;
    expect(docFields.nextReminderAt).toBeDefined();
    expect(typeof docFields.nextReminderAt).toBe('number');
  });

  test('should compute nextTrialReminderAt when trialEndDate provided', async () => {
    const trialEnd = Date.now() + 5 * DAY_MS;
    const { context } = makeContext({
      method: 'POST',
      path: '/subscriptions',
      headers: AUTH,
      body: JSON.stringify({
        userId: USER,
        serviceName: 'Service',
        price: 9.99,
        currency: 'USD',
        billingCycle: 'monthly',
        nextBillingDate: Date.now() + 30 * DAY_MS,
        trialEndDate: trialEnd,
        status: 'active',
        reminderDaysBefore: [3],
      }),
    });

    await main(context);

    const docFields = (mockCreateDocument.mock.calls[0] as unknown[])[3] as Record<string, unknown>;
    expect(docFields.nextTrialReminderAt).toBeDefined();
    expect(typeof docFields.nextTrialReminderAt).toBe('number');
  });

  test('should not include nextTrialReminderAt when no trialEndDate', async () => {
    const { context } = makeContext({
      method: 'POST',
      path: '/subscriptions',
      headers: AUTH,
      body: JSON.stringify({
        userId: USER,
        serviceName: 'Service',
        price: 9.99,
        currency: 'USD',
        billingCycle: 'monthly',
        nextBillingDate: Date.now() + 30 * DAY_MS,
        status: 'active',
        reminderDaysBefore: [3],
      }),
    });

    await main(context);

    const docFields = (mockCreateDocument.mock.calls[0] as unknown[])[3] as Record<string, unknown>;
    expect(docFields).not.toHaveProperty('nextTrialReminderAt');
  });

  test('should reject mismatched userId with 403', async () => {
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions',
      headers: AUTH,
      body: JSON.stringify({
        userId: 'other-user',
        serviceName: 'Netflix',
        price: 9.99,
        currency: 'USD',
        billingCycle: 'monthly',
        nextBillingDate: NOW_BILLING,
        status: 'active',
      }),
    });

    await main(context);

    expect(responses[0].status).toBe(403);
    expect(mockCreateDocument).not.toHaveBeenCalled();
  });
});

describe('updateSubscription (PATCH /subscriptions/:id)', () => {
  test('should recompute nextReminderAt on update', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleSub] });

    const newBillingDate = Date.now() + 14 * DAY_MS;
    const { context, responses } = makeContext({
      method: 'PATCH',
      path: '/subscriptions/sub-1',
      headers: AUTH,
      body: JSON.stringify({
        nextBillingDate: newBillingDate,
        reminderDaysBefore: [3, 7],
      }),
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      DB,
      SUBS,
      'sub-1',
      expect.objectContaining({
        nextBillingDate: newBillingDate,
        updatedAt: expect.any(Number),
      }),
    );
  });

  test('should recompute nextTrialReminderAt when trialEndDate changes', async () => {
    const subWithTrial = {
      ...sampleSub,
      trialEndDate: Date.now() + 10 * DAY_MS,
      reminderDaysBefore: JSON.stringify([3, 7]),
    };
    mockListDocuments.mockResolvedValue({ documents: [subWithTrial] });

    const newTrialEnd = Date.now() + 5 * DAY_MS;
    const { context } = makeContext({
      method: 'PATCH',
      path: '/subscriptions/sub-1',
      headers: AUTH,
      body: JSON.stringify({ trialEndDate: newTrialEnd }),
    });

    await main(context);

    const patchFields = (mockUpdateDocument.mock.calls[0] as unknown[])[3] as Record<
      string,
      unknown
    >;
    expect(patchFields.nextTrialReminderAt).toBeDefined();
    expect(patchFields.nextReminderAt).toBeDefined();
  });

  test('should clear nextTrialReminderAt when trialEndDate removed', async () => {
    const subWithTrial = {
      ...sampleSub,
      trialEndDate: Date.now() + 10 * DAY_MS,
    };
    mockListDocuments.mockResolvedValue({ documents: [subWithTrial] });

    const { context } = makeContext({
      method: 'PATCH',
      path: '/subscriptions/sub-1',
      headers: AUTH,
      body: JSON.stringify({ trialEndDate: null }),
    });

    await main(context);

    const patchFields = (mockUpdateDocument.mock.calls[0] as unknown[])[3] as Record<
      string,
      unknown
    >;
    expect(patchFields.nextTrialReminderAt).toBeNull();
  });

  test('should return 404 when subscription not found', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const { context, responses } = makeContext({
      method: 'PATCH',
      path: '/subscriptions/missing',
      headers: AUTH,
      body: JSON.stringify({ serviceName: 'X' }),
    });

    await main(context);

    expect(responses[0].status).toBe(404);
  });
});
