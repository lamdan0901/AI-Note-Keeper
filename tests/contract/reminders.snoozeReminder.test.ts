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

// Import after mocking
import { snoozeReminder } from '../../convex/functions/reminders';

describe('snoozeReminder Contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockReturnValue(mockQuery);
    mockQuery.filter.mockReturnValue(mockQuery);
  });

  test('should update snoozedUntil and nextTriggerAt', async () => {
    const snoozeTime = 1700010000000;

    // Setup: Active reminder
    const existingReminder = {
      _id: 'mock-id',
      id: 'reminder-123',
      userId: 'user-1',
      title: 'Reminder to snooze',
      active: true,
      scheduleStatus: 'scheduled',
      nextTriggerAt: 1700000000000,
      snoozedUntil: null,
      updatedAt: 1699999999000,
    };

    mockQuery.first.mockResolvedValue(existingReminder);

    const handler = (snoozeReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-123',
      snoozedUntil: snoozeTime,
    };

    await handler(mockCtx, args);

    // Verify snoozedUntil was updated
    expect(mockDb.patch).toHaveBeenCalledWith(
      'mock-id',
      expect.objectContaining({
        snoozedUntil: snoozeTime,
        nextTriggerAt: snoozeTime,
      }),
    );

    // Verify updatedAt was set
    expect(mockDb.patch).toHaveBeenCalledWith(
      'mock-id',
      expect.objectContaining({
        updatedAt: expect.any(Number),
      }),
    );
  });

  test('should set scheduleStatus to scheduled', async () => {
    const snoozeTime = 1700010000000;

    // Setup: Unscheduled reminder
    const existingReminder = {
      _id: 'mock-id',
      id: 'reminder-unscheduled',
      userId: 'user-1',
      active: false,
      scheduleStatus: 'unscheduled',
      nextTriggerAt: null,
      snoozedUntil: null,
    };

    mockQuery.first.mockResolvedValue(existingReminder);

    const handler = (snoozeReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-unscheduled',
      snoozedUntil: snoozeTime,
    };

    await handler(mockCtx, args);

    // Verify scheduleStatus was set to scheduled
    expect(mockDb.patch).toHaveBeenCalledWith(
      'mock-id',
      expect.objectContaining({
        scheduleStatus: 'scheduled',
      }),
    );
  });

  test('should set active to true', async () => {
    const snoozeTime = 1700010000000;

    // Setup: Inactive reminder
    const existingReminder = {
      _id: 'mock-id',
      id: 'reminder-inactive',
      userId: 'user-1',
      active: false,
      scheduleStatus: 'unscheduled',
      nextTriggerAt: null,
      snoozedUntil: null,
    };

    mockQuery.first.mockResolvedValue(existingReminder);

    const handler = (snoozeReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-inactive',
      snoozedUntil: snoozeTime,
    };

    await handler(mockCtx, args);

    // Verify active was set to true
    expect(mockDb.patch).toHaveBeenCalledWith(
      'mock-id',
      expect.objectContaining({
        active: true,
      }),
    );
  });

  test('should emit change event with correct operation', async () => {
    const snoozeTime = 1700010000000;

    const existingReminder = {
      _id: 'mock-id',
      id: 'reminder-123',
      userId: 'user-1',
      active: true,
      scheduleStatus: 'scheduled',
      nextTriggerAt: 1700000000000,
      snoozedUntil: null,
    };

    mockQuery.first.mockResolvedValue(existingReminder);

    const handler = (snoozeReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-123',
      snoozedUntil: snoozeTime,
    };

    await handler(mockCtx, args);

    // Verify change event was emitted
    expect(mockDb.insert).toHaveBeenCalledWith(
      'noteChangeEvents',
      expect.objectContaining({
        noteId: 'reminder-123',
        operation: 'update',
        userId: 'user-1',
        changedAt: expect.any(Number),
        deviceId: 'web',
        payloadHash: expect.any(String),
      }),
    );
  });

  test('should trigger push notification', async () => {
    const snoozeTime = 1700010000000;

    const existingReminder = {
      _id: 'mock-id',
      id: 'reminder-123',
      userId: 'user-1',
      active: true,
      scheduleStatus: 'scheduled',
      nextTriggerAt: 1700000000000,
      snoozedUntil: null,
    };

    mockQuery.first.mockResolvedValue(existingReminder);
    mockDb.insert = jest.fn(async () => 'change-event-id-456') as unknown as typeof mockDb.insert;

    const handler = (snoozeReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-123',
      snoozedUntil: snoozeTime,
      deviceId: 'mobile-device-2',
    };

    await handler(mockCtx, args);

    // Verify scheduler was called with correct parameters
    expect(mockCtx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        userId: 'user-1',
        excludeDeviceId: 'mobile-device-2',
        reminderId: 'reminder-123',
        changeEventId: 'change-event-id-456',
      }),
    );
  });

  test('should return null for non-existent reminder', async () => {
    mockQuery.first.mockResolvedValue(null);

    const handler = (snoozeReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-missing',
      snoozedUntil: 1700010000000,
    };

    const result = await handler(mockCtx, args);

    // Verify nothing was patched
    expect(mockDb.patch).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockCtx.scheduler.runAfter).not.toHaveBeenCalled();

    // Verify null was returned
    expect(result).toBeNull();
  });

  test('should preserve recurrence configuration', async () => {
    const snoozeTime = 1700010000000;

    // Setup: Recurring reminder with full configuration
    const existingReminder = {
      _id: 'mock-id',
      id: 'reminder-recurring',
      userId: 'user-1',
      repeat: { kind: 'daily', interval: 1 },
      startAt: 1700000000000,
      baseAtLocal: '2026-02-01T09:00:00',
      active: true,
      scheduleStatus: 'scheduled',
      nextTriggerAt: 1700000000000,
      snoozedUntil: null,
    };

    mockQuery.first.mockResolvedValue(existingReminder);

    const handler = (snoozeReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-recurring',
      snoozedUntil: snoozeTime,
    };

    await handler(mockCtx, args);

    // Verify recurrence fields were NOT modified
    // The patch should only include: snoozedUntil, updatedAt, nextTriggerAt, scheduleStatus, active
    expect(mockDb.patch).toHaveBeenCalledWith(
      'mock-id',
      expect.objectContaining({
        snoozedUntil: snoozeTime,
        nextTriggerAt: snoozeTime,
        scheduleStatus: 'scheduled',
        active: true,
      }),
    );

    // Verify repeat, startAt, baseAtLocal are NOT in the patch
    const patchCall = mockDb.patch.mock.calls[0][1];
    expect(patchCall).not.toHaveProperty('repeat');
    expect(patchCall).not.toHaveProperty('startAt');
    expect(patchCall).not.toHaveProperty('baseAtLocal');
  });

  test('should handle snoozing already-snoozed reminder', async () => {
    const originalSnooze = 1700005000000;
    const newSnooze = 1700010000000;

    // Setup: Already snoozed reminder
    const existingReminder = {
      _id: 'mock-id',
      id: 'reminder-snoozed',
      userId: 'user-1',
      active: true,
      scheduleStatus: 'scheduled',
      nextTriggerAt: originalSnooze,
      snoozedUntil: originalSnooze, // Already snoozed
    };

    mockQuery.first.mockResolvedValue(existingReminder);

    const handler = (
      snoozeReminder as unknown as {
        _handler: (ctx: typeof mockCtx, args: Record<string, unknown>) => Promise<unknown>;
      }
    )._handler;
    const args = {
      id: 'reminder-snoozed',
      snoozedUntil: newSnooze,
    };

    await handler(mockCtx, args);

    // Verify snoozedUntil was updated to new value
    expect(mockDb.patch).toHaveBeenCalledWith(
      'mock-id',
      expect.objectContaining({
        snoozedUntil: newSnooze,
        nextTriggerAt: newSnooze,
      }),
    );
  });
});
