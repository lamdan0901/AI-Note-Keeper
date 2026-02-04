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

jest.mock(
  '../../packages/shared/utils/hash',
  () => ({
    calculatePayloadHash: jest.fn(() => 'mock-payload-hash'),
  }),
  { virtual: true },
);

// Mock context
const mockDb = {
  query: jest.fn() as jest.Mock,
  patch: jest.fn() as jest.Mock,
  insert: jest.fn() as jest.Mock,
  delete: jest.fn() as jest.Mock,
  get: jest.fn() as jest.Mock,
};

const mockCtx = {
  db: mockDb,
  scheduler: {
    runAfter: jest.fn() as jest.Mock,
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

// Mock computeNextTrigger
const mockComputeNextTrigger = jest.fn();
jest.mock(
  '../../packages/shared/utils/recurrence',
  () => ({
    computeNextTrigger: mockComputeNextTrigger,
  }),
  { virtual: true },
);

// Import after mocking
import { ackReminder } from '../../convex/functions/reminders';

describe('ackReminder Contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockReturnValue(mockQuery);
    mockQuery.filter.mockReturnValue(mockQuery);
  });

  test('should mark a one-off reminder as done when marked as done', async () => {
    // Setup: One-off reminder (no repeat)
    const existingReminder = {
      _id: 'mock-id',
      id: 'reminder-123',
      userId: 'user-1',
      title: 'One-time reminder',
      repeat: null,
      active: true,
      scheduleStatus: 'scheduled',
      nextTriggerAt: 1700000000000,
      snoozedUntil: null,
      updatedAt: 1699999999000,
      createdAt: 1699999999000,
    };

    mockQuery.first.mockResolvedValue(existingReminder);

    const handler = (ackReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-123',
      ackType: 'done' as const,
    };

    await handler(mockCtx, args);

    // Verify reminder was marked as done
    expect(mockDb.patch).toHaveBeenCalledWith(
      'mock-id',
      expect.objectContaining({
        done: true,
        scheduleStatus: 'unscheduled',
        nextTriggerAt: undefined,
        snoozedUntil: undefined,
      }),
    );

    // Verify timestamps were updated
    expect(mockDb.patch).toHaveBeenCalledWith(
      'mock-id',
      expect.objectContaining({
        lastAcknowledgedAt: expect.any(Number),
      }),
    );

    // Verify change event was emitted
    expect(mockDb.insert).toHaveBeenCalledWith(
      'noteChangeEvents',
      expect.objectContaining({
        noteId: 'reminder-123',
        operation: 'update',
        userId: 'user-1',
      }),
    );

    // Verify push notification was scheduled
    expect(mockCtx.scheduler.runAfter).toHaveBeenCalled();
  });

  test('should compute next occurrence for daily recurring reminder', async () => {
    const now = 1700000000000;
    const nextTrigger = 1700086400000; // +1 day

    // Setup: Daily recurring reminder
    const existingReminder = {
      _id: 'mock-id',
      id: 'reminder-daily',
      userId: 'user-1',
      title: 'Daily standup',
      repeat: { kind: 'daily', interval: 1 },
      startAt: 1700000000000,
      baseAtLocal: '2026-02-01T09:00:00',
      active: true,
      scheduleStatus: 'scheduled',
      nextTriggerAt: 1700000000000,
    };

    mockQuery.first.mockResolvedValue(existingReminder);
    mockComputeNextTrigger.mockReturnValue(nextTrigger);

    const handler = (ackReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-daily',
      ackType: 'done' as const,
    };

    // Mock Date.now()
    const originalDateNow = Date.now;
    Date.now = jest.fn(() => now);

    await handler(mockCtx, args);

    // Restore Date.now()
    Date.now = originalDateNow;

    // Verify computeNextTrigger was called with correct args
    expect(mockComputeNextTrigger).toHaveBeenCalledWith(
      now,
      existingReminder.startAt,
      existingReminder.baseAtLocal,
      existingReminder.repeat,
    );

    // Verify next trigger was set
    expect(mockDb.patch).toHaveBeenCalledWith(
      'mock-id',
      expect.objectContaining({
        nextTriggerAt: nextTrigger,
        lastFiredAt: now,
        scheduleStatus: 'scheduled',
        done: true,
        snoozedUntil: undefined, // Should clear snooze
      }),
    );

    // Verify change event
    expect(mockDb.insert).toHaveBeenCalledWith(
      'noteChangeEvents',
      expect.objectContaining({
        noteId: 'reminder-daily',
        operation: 'update',
      }),
    );

    // Verify push notification
    expect(mockCtx.scheduler.runAfter).toHaveBeenCalled();
  });

  test('should compute next occurrence for weekly recurring reminder', async () => {
    const now = 1700000000000;
    const nextTrigger = 1700604800000; // Next week

    // Setup: Weekly recurring reminder (Mon, Wed, Fri)
    const existingReminder = {
      _id: 'mock-id',
      id: 'reminder-weekly',
      userId: 'user-1',
      title: 'Weekly meeting',
      repeat: { kind: 'weekly', interval: 1, weekdays: [1, 3, 5] },
      startAt: 1700000000000,
      baseAtLocal: '2026-02-01T14:00:00',
      active: true,
      scheduleStatus: 'scheduled',
      nextTriggerAt: 1700000000000,
    };

    mockQuery.first.mockResolvedValue(existingReminder);
    mockComputeNextTrigger.mockReturnValue(nextTrigger);

    const handler = (ackReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-weekly',
      ackType: 'done' as const,
    };

    const originalDateNow = Date.now;
    Date.now = jest.fn(() => now);

    await handler(mockCtx, args);

    Date.now = originalDateNow;

    // Verify computeNextTrigger was called
    expect(mockComputeNextTrigger).toHaveBeenCalledWith(
      now,
      existingReminder.startAt,
      existingReminder.baseAtLocal,
      existingReminder.repeat,
    );

    // Verify next trigger was set
    expect(mockDb.patch).toHaveBeenCalledWith(
      'mock-id',
      expect.objectContaining({
        nextTriggerAt: nextTrigger,
        scheduleStatus: 'scheduled',
        done: true,
      }),
    );
  });

  test('should compute next occurrence for monthly recurring reminder', async () => {
    const now = 1700000000000;
    const nextTrigger = 1702678400000; // Next month

    // Setup: Monthly recurring reminder
    const existingReminder = {
      _id: 'mock-id',
      id: 'reminder-monthly',
      userId: 'user-1',
      title: 'Monthly review',
      repeat: { kind: 'monthly', interval: 1, mode: 'day_of_month' },
      startAt: 1700000000000,
      baseAtLocal: '2026-02-01T10:00:00',
      active: true,
      scheduleStatus: 'scheduled',
      nextTriggerAt: 1700000000000,
    };

    mockQuery.first.mockResolvedValue(existingReminder);
    mockComputeNextTrigger.mockReturnValue(nextTrigger);

    const handler = (ackReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-monthly',
      ackType: 'done' as const,
    };

    const originalDateNow = Date.now;
    Date.now = jest.fn(() => now);

    await handler(mockCtx, args);

    Date.now = originalDateNow;

    // Verify next trigger was set
    expect(mockDb.patch).toHaveBeenCalledWith(
      'mock-id',
      expect.objectContaining({
        nextTriggerAt: nextTrigger,
        done: true,
      }),
    );
  });

  test('should clear snoozedUntil when marking as done', async () => {
    const now = 1700000000000;
    const nextTrigger = 1700086400000;

    // Setup: Snoozed recurring reminder
    const existingReminder = {
      _id: 'mock-id',
      id: 'reminder-snoozed',
      userId: 'user-1',
      repeat: { kind: 'daily', interval: 1 },
      startAt: 1700000000000,
      baseAtLocal: '2026-02-01T09:00:00',
      snoozedUntil: 1700010000000, // Was snoozed
      active: true,
      scheduleStatus: 'scheduled',
      nextTriggerAt: 1700010000000,
    };

    mockQuery.first.mockResolvedValue(existingReminder);
    mockComputeNextTrigger.mockReturnValue(nextTrigger);

    const handler = (ackReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-snoozed',
      ackType: 'done' as const,
    };

    const originalDateNow = Date.now;
    Date.now = jest.fn(() => now);

    await handler(mockCtx, args);

    Date.now = originalDateNow;

    // Verify snoozedUntil was cleared
    expect(mockDb.patch).toHaveBeenCalledWith(
      'mock-id',
      expect.objectContaining({
        snoozedUntil: undefined,
        nextTriggerAt: nextTrigger,
      }),
    );
  });

  test('should deactivate when series ends (no more occurrences)', async () => {
    const now = 1700000000000;

    // Setup: Recurring reminder where series has ended
    const existingReminder = {
      _id: 'mock-id',
      id: 'reminder-ended',
      userId: 'user-1',
      repeat: { kind: 'daily', interval: 1 },
      startAt: 1700000000000,
      baseAtLocal: '2026-02-01T09:00:00',
      active: true,
      scheduleStatus: 'scheduled',
      nextTriggerAt: 1700000000000,
    };

    mockQuery.first.mockResolvedValue(existingReminder);
    mockComputeNextTrigger.mockReturnValue(null); // Series finished

    const handler = (ackReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-ended',
      ackType: 'done' as const,
    };

    const originalDateNow = Date.now;
    Date.now = jest.fn(() => now);

    await handler(mockCtx, args);

    Date.now = originalDateNow;

    // Verify reminder was marked as done and unscheduled
    expect(mockDb.patch).toHaveBeenCalledWith(
      'mock-id',
      expect.objectContaining({
        scheduleStatus: 'unscheduled',
        nextTriggerAt: undefined,
        done: true,
      }),
    );
  });

  test('should return null for non-existent reminder', async () => {
    mockQuery.first.mockResolvedValue(null);

    const handler = (ackReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-missing',
      ackType: 'done' as const,
    };

    const result = await handler(mockCtx, args);

    // Verify nothing was patched
    expect(mockDb.patch).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockCtx.scheduler.runAfter).not.toHaveBeenCalled();

    // Verify null was returned
    expect(result).toBeNull();
  });

  test('should emit change event with correct operation', async () => {
    const existingReminder = {
      _id: 'mock-id',
      id: 'reminder-123',
      userId: 'user-1',
      repeat: null,
      active: true,
      scheduleStatus: 'scheduled',
      nextTriggerAt: 1700000000000,
    };

    mockQuery.first.mockResolvedValue(existingReminder);

    const handler = (ackReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-123',
      ackType: 'done' as const,
    };

    await handler(mockCtx, args);

    // Verify change event has correct operation
    expect(mockDb.insert).toHaveBeenCalledWith(
      'noteChangeEvents',
      expect.objectContaining({
        operation: 'update',
        noteId: 'reminder-123',
        userId: 'user-1',
        changedAt: expect.any(Number),
        deviceId: 'web',
        payloadHash: expect.any(String),
      }),
    );
  });

  test('should trigger push notification after acknowledgment', async () => {
    const existingReminder = {
      _id: 'mock-id',
      id: 'reminder-123',
      userId: 'user-1',
      repeat: null,
      active: true,
      scheduleStatus: 'scheduled',
      nextTriggerAt: 1700000000000,
    };

    mockQuery.first.mockResolvedValue(existingReminder);
    // @ts-expect-error - Jest mock typing issue
    mockDb.insert.mockResolvedValue('change-event-id-123');

    const handler = (ackReminder as unknown as { _handler: Handler })._handler;
    const args = {
      id: 'reminder-123',
      ackType: 'done' as const,
      deviceId: 'mobile-device-1',
    };

    await handler(mockCtx, args);

    // Verify scheduler was called with correct parameters
    expect(mockCtx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        userId: 'user-1',
        excludeDeviceId: 'mobile-device-1',
        reminderId: 'reminder-123',
        changeEventId: 'change-event-id-123',
      }),
    );
  });
});
