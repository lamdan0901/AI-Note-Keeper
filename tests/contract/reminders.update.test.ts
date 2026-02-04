import { test, expect, jest, describe, beforeEach } from '@jest/globals';

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

jest.mock(
  '../../packages/shared/utils/hash',
  () => ({
    calculatePayloadHash: jest.fn(() => 'mock-payload-hash'),
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
  // Return a mock object that acts like the mutation but exposes the handler
  return {
    ...config,
    _handler: config.handler, // Expose handler for testing
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

// We need to import after mocking
import { updateReminder } from '../../convex/functions/reminders';

describe('updateReminder Contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockReturnValue(mockQuery);
    // Default setup: finding the reminder returns a reminder
    mockQuery.first.mockResolvedValue({ _id: 'mock-id', id: 'reminder-123', userId: 'user-1' });
    mockQuery.filter.mockReturnValue(mockQuery); // Chainable
  });

  test('should update the reminder and emit a change event', async () => {
    const handler = (updateReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-123',
      title: 'Updated Title',
      updatedAt: 1234567890,
    };

    await handler(mockCtx, args);

    // Verify reminder was patched
    expect(mockDb.patch).toHaveBeenCalledWith(
      'mock-id',
      expect.objectContaining({
        title: 'Updated Title',
      }),
    );

    // Verify change event was emitted (CRITICAL for US1)
    expect(mockDb.insert).toHaveBeenCalledWith(
      'noteChangeEvents',
      expect.objectContaining({
        noteId: 'reminder-123',
        operation: 'update',
      }),
    );

    // Verify scheduler was called
    expect(mockCtx.scheduler.runAfter).toHaveBeenCalled();
  });
});
