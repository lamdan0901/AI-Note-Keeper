import { test, expect, jest, describe, beforeEach } from '@jest/globals';

// Mock external dependencies first
jest.mock(
  'js-sha256',
  () => ({
    sha256: jest.fn(() => 'mock-hash-value'),
  }),
  { virtual: true },
);

jest.mock(
  '../../convex/utils/uuid',
  () => ({
    uuidv4: jest.fn(() => 'mock-uuid-value'),
  }),
  { virtual: true },
);

// Mock context
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

type MockFn = jest.Mock<(...args: unknown[]) => unknown>;
type AsyncMockFn = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
type Handler = (ctx: typeof mockCtx, args: Record<string, unknown>) => Promise<unknown>;

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

import { createReminder, deleteReminder } from '../../convex/functions/reminders';

describe('createReminder Contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockReturnValue(mockQuery);
  });

  test('should create a reminder and emit a change event', async () => {
    const handler = (createReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-new',
      userId: 'user-1',
      triggerAt: 1700000000000,
      repeatRule: 'none' as const,
      active: true,
      timezone: 'UTC',
      scheduleStatus: 'unscheduled' as const,
    };

    await handler(mockCtx, args);

    // Verify reminder was inserted
    expect(mockDb.insert).toHaveBeenCalledWith(
      'notes',
      expect.objectContaining({
        id: 'reminder-new',
        scheduleStatus: 'unscheduled',
      }),
    );

    // Verify change event was emitted
    expect(mockDb.insert).toHaveBeenCalledWith(
      'noteChangeEvents',
      expect.objectContaining({
        noteId: 'reminder-new',
        operation: 'create',
        userId: 'user-1',
      }),
    );

    // Verify scheduler was called
    expect(mockCtx.scheduler.runAfter).toHaveBeenCalled();
  });
});

describe('deleteReminder Contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockReturnValue(mockQuery);
    // Default: find returns a reminder
    mockQuery.first.mockResolvedValue({ _id: 'mock-id', id: 'reminder-123', userId: 'user-1' });
    mockQuery.filter.mockReturnValue(mockQuery);
  });

  test('should delete the reminder and emit a change event', async () => {
    const handler = (deleteReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-123',
    };

    await handler(mockCtx, args);

    // Verify reminder was deleted
    expect(mockDb.delete).toHaveBeenCalledWith('mock-id');

    // Verify change event was emitted
    expect(mockDb.insert).toHaveBeenCalledWith(
      'noteChangeEvents',
      expect.objectContaining({
        noteId: 'reminder-123',
        operation: 'delete',
      }),
    );

    // Verify scheduler was called
    expect(mockCtx.scheduler.runAfter).toHaveBeenCalled();
  });

  test('should return null if reminder not found', async () => {
    mockQuery.first.mockResolvedValue(null);
    const handler = (deleteReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-missing',
    };

    const result = await handler(mockCtx, args);
    expect(result).toBeNull();
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockCtx.scheduler.runAfter).not.toHaveBeenCalled();
  });
});
