import { beforeEach, describe, expect, jest, test } from '@jest/globals';

type HandlerConfig = {
  handler: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};

type Handler = (ctx: typeof mockCtx, args: Record<string, unknown>) => Promise<unknown>;

type MockQuery = {
  filter: jest.Mock<(...args: unknown[]) => MockQuery>;
  collect: jest.Mock<(...args: unknown[]) => Promise<unknown[]>>;
};

const mockQuery: MockQuery = {
  filter: jest.fn(),
  collect: jest.fn(),
};
mockQuery.filter.mockReturnValue(mockQuery);

const mockDb: {
  query: jest.Mock<(...args: unknown[]) => MockQuery>;
  patch: jest.Mock<(...args: unknown[]) => unknown>;
  delete: jest.Mock<(...args: unknown[]) => unknown>;
  get: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  insert: jest.Mock<(...args: unknown[]) => Promise<string>>;
} = {
  query: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
  get: jest.fn(),
  insert: jest.fn(),
};

const mockCtx = {
  db: mockDb,
};

const mockMutation = jest.fn((config: HandlerConfig) => ({
  ...config,
  _handler: config.handler,
}));

const mockQueryFunction = jest.fn((config: HandlerConfig) => ({
  ...config,
  _handler: config.handler,
}));

const mockInternalMutation = jest.fn((config: HandlerConfig) => ({
  ...config,
  _handler: config.handler,
}));

const mockInternalQuery = jest.fn((config: HandlerConfig) => ({
  ...config,
  _handler: config.handler,
}));

const mockInternalAction = jest.fn((config: HandlerConfig) => ({
  ...config,
  _handler: config.handler,
}));

jest.mock(
  '../../convex/_generated/server',
  () => ({
    mutation: mockMutation,
    query: mockQueryFunction,
    internalMutation: mockInternalMutation,
    internalQuery: mockInternalQuery,
    internalAction: mockInternalAction,
  }),
  { virtual: true },
);

jest.mock(
  '../../convex/_generated/api',
  () => ({
    internal: {
      functions: {
        subscriptions: {
          getDueSubscriptionReminders: {},
          getDueTrialReminders: {},
          getSubscriptionsWithOverdueBilling: {},
          advanceSubscriptionAfterReminder: {},
          advanceSubscriptionAfterTrialReminder: {},
          advanceBillingSubscription: {},
        },
        push: {
          sendSubscriptionPush: {},
        },
      },
    },
  }),
  { virtual: true },
);

jest.mock(
  'convex/values',
  () => {
    const v: Record<string, jest.Mock> = {};
    const pass = () => ({});
    ['string', 'number', 'boolean', 'any', 'null', 'id'].forEach((k) => (v[k] = jest.fn(pass)));
    v['optional'] = jest.fn(pass);
    v['union'] = jest.fn(pass);
    v['array'] = jest.fn(pass);
    v['object'] = jest.fn(pass);
    return { v };
  },
  { virtual: true },
);

import {
  createSubscription,
  deleteSubscription,
  emptySubscriptionTrash,
  listSubscriptions,
  listDeletedSubscriptions,
  permanentlyDeleteSubscription,
  purgeExpiredSubscriptionTrash,
  restoreSubscription,
} from '../../convex/functions/subscriptions';

describe('subscriptions trash lifecycle contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockReturnValue(mockQuery);
    mockQuery.filter.mockReturnValue(mockQuery);
    mockQuery.collect.mockResolvedValue([]);
  });

  test('deleteSubscription marks active=false and stamps deletedAt', async () => {
    const handler = (deleteSubscription as unknown as { _handler: Handler })._handler;

    await handler(mockCtx, { id: 'sub-1' });

    expect(mockDb.patch).toHaveBeenCalledWith(
      'sub-1',
      expect.objectContaining({
        active: false,
        deletedAt: expect.any(Number),
        updatedAt: expect.any(Number),
      }),
    );
  });

  test('listDeletedSubscriptions returns most recently deleted first', async () => {
    const handler = (listDeletedSubscriptions as unknown as { _handler: Handler })._handler;

    mockQuery.collect.mockResolvedValue([
      { _id: 'a', userId: 'u1', active: false, deletedAt: 100 },
      { _id: 'b', userId: 'u1', active: false, deletedAt: 300 },
      { _id: 'c', userId: 'u1', active: false, deletedAt: 200 },
    ]);

    const result = (await handler(mockCtx, { userId: 'u1' })) as Array<{ _id: string }>;

    expect(result.map((r) => r._id)).toEqual(['b', 'c', 'a']);
  });

  test('restoreSubscription re-activates and clears deletedAt', async () => {
    const handler = (restoreSubscription as unknown as { _handler: Handler })._handler;

    await handler(mockCtx, { id: 'sub-1' });

    expect(mockDb.patch).toHaveBeenCalledWith(
      'sub-1',
      expect.objectContaining({
        active: true,
        deletedAt: undefined,
        updatedAt: expect.any(Number),
      }),
    );
  });

  test('permanentlyDeleteSubscription removes only inactive records', async () => {
    const handler = (permanentlyDeleteSubscription as unknown as { _handler: Handler })._handler;

    mockDb.get.mockResolvedValue({ _id: 'sub-1', active: false });
    const deletedResult = await handler(mockCtx, { id: 'sub-1' });
    expect(mockDb.delete).toHaveBeenCalledWith('sub-1');
    expect(deletedResult).toEqual({ deleted: true });

    mockDb.delete.mockClear();
    mockDb.get.mockResolvedValue({ _id: 'sub-2', active: true });
    const skippedResult = await handler(mockCtx, { id: 'sub-2' });
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(skippedResult).toEqual({ deleted: false });
  });

  test('emptySubscriptionTrash removes all inactive subscriptions for user', async () => {
    const handler = (emptySubscriptionTrash as unknown as { _handler: Handler })._handler;

    mockQuery.collect.mockResolvedValue([
      { _id: 'sub-1', userId: 'u1', active: false },
      { _id: 'sub-2', userId: 'u1', active: false },
    ]);

    const result = await handler(mockCtx, { userId: 'u1' });

    expect(mockDb.delete).toHaveBeenCalledTimes(2);
    expect(mockDb.delete).toHaveBeenNthCalledWith(1, 'sub-1');
    expect(mockDb.delete).toHaveBeenNthCalledWith(2, 'sub-2');
    expect(result).toEqual({ deleted: 2 });
  });

  test('purgeExpiredSubscriptionTrash deletes all expired entries returned by query', async () => {
    const handler = (purgeExpiredSubscriptionTrash as unknown as { _handler: Handler })._handler;

    mockQuery.collect.mockResolvedValue([
      { _id: 'sub-10', active: false, deletedAt: 100 },
      { _id: 'sub-11', active: false, deletedAt: 200 },
    ]);

    const result = await handler(mockCtx, {});

    expect(mockDb.delete).toHaveBeenCalledTimes(2);
    expect(mockDb.delete).toHaveBeenNthCalledWith(1, 'sub-10');
    expect(mockDb.delete).toHaveBeenNthCalledWith(2, 'sub-11');
    expect(result).toEqual({ purged: 2 });
  });

  test('create-then-delete race ends with no active subscription', async () => {
    const createHandler = (createSubscription as unknown as { _handler: Handler })._handler;
    const deleteHandler = (deleteSubscription as unknown as { _handler: Handler })._handler;
    const listHandler = (listSubscriptions as unknown as { _handler: Handler })._handler;

    const userId = 'u-race';
    const createdId = 'sub-race-1';
    const docs = new Map<string, Record<string, unknown>>();
    let releaseInsert: (() => void) | null = null;

    mockDb.insert.mockImplementation(
      async (_table: unknown, doc: unknown): Promise<string> =>
        await new Promise<string>((resolve) => {
          releaseInsert = () => {
            docs.set(createdId, { ...(doc as Record<string, unknown>), _id: createdId });
            resolve(createdId);
          };
        }),
    );

    mockDb.patch.mockImplementation((id: unknown, patch: unknown) => {
      const existing = docs.get(id as string);
      if (!existing) {
        throw new Error('missing subscription');
      }
      docs.set(id as string, { ...existing, ...(patch as Record<string, unknown>) });
    });

    mockQuery.collect.mockImplementation(async () =>
      Array.from(docs.values()).filter((doc) => doc.userId === userId && doc.active === true),
    );

    const createPromise = createHandler(mockCtx, {
      userId,
      serviceName: 'Race Sub',
      category: 'tools',
      price: 9.99,
      currency: 'USD',
      billingCycle: 'monthly',
      nextBillingDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
      status: 'active',
      reminderDaysBefore: [3],
    }) as Promise<string>;

    const deleteAfterAck = createPromise.then(async (id) => {
      await deleteHandler(mockCtx, { id });
      return id;
    });

    expect(releaseInsert).not.toBeNull();
    releaseInsert?.();

    const id = await deleteAfterAck;
    const stored = docs.get(id);
    expect(stored).toEqual(
      expect.objectContaining({
        _id: createdId,
        active: false,
      }),
    );

    const activeList = (await listHandler(mockCtx, { userId })) as Array<Record<string, unknown>>;
    expect(activeList).toHaveLength(0);
  });
});
