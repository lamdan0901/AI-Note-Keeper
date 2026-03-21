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
} = {
  query: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
  get: jest.fn(),
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
          getSubscriptionsWithOverdueBilling: {},
          advanceSubscriptionAfterReminder: {},
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
  deleteSubscription,
  emptySubscriptionTrash,
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
});
