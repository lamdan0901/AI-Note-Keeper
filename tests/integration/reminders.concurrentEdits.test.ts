import { test, expect, jest, describe, beforeEach } from '@jest/globals';

const mockDb = {
  query: jest.fn(),
  patch: jest.fn(),
  insert: jest.fn(),
  delete: jest.fn(),
  get: jest.fn(),
};

const mockCtx = {
  db: mockDb,
  scheduler: {
    runAfter: jest.fn(),
  },
};

type HandlerConfig = {
  handler: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};

type Handler = (ctx: typeof mockCtx, args: Record<string, unknown>) => Promise<unknown>;

type MockFn = jest.Mock<(...args: unknown[]) => unknown>;
type AsyncMockFn = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

const mockQuery: {
  filter: MockFn;
  first: AsyncMockFn;
  collect: AsyncMockFn;
  eq: MockFn;
  field: MockFn;
  gt: MockFn;
} = {
  filter: jest.fn().mockReturnThis(),
  first: jest.fn(),
  collect: jest.fn(),
  eq: jest.fn(),
  field: jest.fn(),
  gt: jest.fn(),
};

const mockMutation = jest.fn((config: HandlerConfig) => ({
  ...config,
  _handler: config.handler,
}));

const mockQueryFunction = jest.fn((config: HandlerConfig) => ({
  ...config,
  _handler: config.handler,
}));

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

import { updateReminder } from '../../convex/functions/reminders';

const baseReminder = {
  _id: 'convex-id-1',
  id: 'reminder-1',
  userId: 'user-1',
  triggerAt: 1700000000000,
  repeatRule: 'none' as const,
  repeatConfig: undefined,
  snoozedUntil: undefined,
  active: true,
  scheduleStatus: 'unscheduled' as const,
  timezone: 'UTC',
  updatedAt: 2000,
  createdAt: 1000,
};

describe('Concurrent edits (last-write-wins) integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockReturnValue(mockQuery);
    mockQuery.filter.mockReturnValue(mockQuery);
  });

  test('rejects stale update when updatedAt is older than existing', async () => {
    const handler = (updateReminder as unknown as { _handler: Handler })._handler;
    const existing = { ...baseReminder, updatedAt: 2000 };
    mockQuery.first.mockResolvedValue(existing);

    const result = await handler(mockCtx, {
      id: existing.id,
      title: 'Stale Title',
      updatedAt: 1500,
    });

    expect(mockDb.patch).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockCtx.scheduler.runAfter).not.toHaveBeenCalled();
    expect(result).toEqual(existing);
  });

  test('accepts newest update and emits change event', async () => {
    const handler = (updateReminder as unknown as { _handler: Handler })._handler;
    const existing = { ...baseReminder, updatedAt: 1000 };
    mockQuery.first.mockResolvedValue(existing);

    const result = await handler(mockCtx, {
      id: existing.id,
      title: 'Newest Title',
      updatedAt: 3000,
    });

    expect(mockDb.patch).toHaveBeenCalledWith(
      existing._id,
      expect.objectContaining({
        title: 'Newest Title',
        updatedAt: 3000,
      }),
    );
    expect(mockDb.insert).toHaveBeenCalledWith(
      'noteChangeEvents',
      expect.objectContaining({
        noteId: existing.id,
        operation: 'update',
        changedAt: 3000,
      }),
    );
    expect(mockCtx.scheduler.runAfter).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: existing.id,
        title: 'Newest Title',
        updatedAt: 3000,
      }),
    );
  });
});
