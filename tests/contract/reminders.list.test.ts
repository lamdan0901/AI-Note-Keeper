import { test, expect, jest, describe, beforeEach } from '@jest/globals';

// Mock context
const mockDb = {
  query: jest.fn(),
};

const mockCtx = {
  db: mockDb,
};

type HandlerConfig = {
  handler: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};

type MockFn = jest.Mock<(...args: unknown[]) => unknown>;
type AsyncMockFn = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
type Handler = (ctx: typeof mockCtx, args: Record<string, unknown>) => Promise<unknown>;

const mockQuery: {
  filter: MockFn;
  collect: AsyncMockFn;
  eq: MockFn;
  field: MockFn;
  gt: MockFn;
} = {
  filter: jest.fn().mockReturnThis(),
  collect: jest.fn(),
  eq: jest.fn(),
  field: jest.fn(),
  gt: jest.fn(),
};

// Mock convex/server
const mockMutation = jest.fn((config: HandlerConfig) => {
  return {
    ...config,
    _handler: config.handler,
  };
});

const mockQueryFunction = jest.fn((config: HandlerConfig) => {
  return {
    ...config,
    _handler: config.handler,
  };
});

jest.mock(
  '../../convex/_generated/server',
  () => ({
    mutation: mockMutation,
    query: mockQueryFunction,
  }),
  { virtual: true },
);

jest.mock(
  '../../convex/_generated/api',
  () => ({
    internal: {
      functions: {
        push: {
          sendPush: {},
        },
      },
    },
    api: {},
  }),
  { virtual: true },
);

import { listReminders } from '../../convex/functions/reminders';

describe('listReminders Contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockReturnValue(mockQuery);
    mockQuery.collect.mockResolvedValue([]);
    mockQuery.field.mockReturnValue('updatedAtField');
    mockQuery.gt.mockReturnValue(true);
  });

  test('should return all reminders when updatedSince is not provided', async () => {
    const handler = (listReminders as unknown as { _handler: Handler })._handler;
    const result = await handler(mockCtx, {});

    expect(mockDb.query).toHaveBeenCalledWith('notes');
    expect(mockQuery.filter).not.toHaveBeenCalled();
    expect(mockQuery.collect).toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  test('should filter reminders updated after updatedSince', async () => {
    const handler = (listReminders as unknown as { _handler: Handler })._handler;
    const updatedSince = 1700000000000;

    const result = await handler(mockCtx, { updatedSince });

    expect(mockDb.query).toHaveBeenCalledWith('notes');
    expect(mockQuery.filter).toHaveBeenCalledTimes(1);

    const filterFn = mockQuery.filter.mock.calls[0][0] as (q: typeof mockQuery) => unknown;
    filterFn(mockQuery);

    expect(mockQuery.field).toHaveBeenCalledWith('updatedAt');
    expect(mockQuery.gt).toHaveBeenCalledWith('updatedAtField', updatedSince);
    expect(mockQuery.collect).toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
