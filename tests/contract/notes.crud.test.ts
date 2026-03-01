import { test, expect, jest, describe, beforeEach } from '@jest/globals';

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
};

type HandlerConfig = {
  handler: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};

type Handler = (ctx: typeof mockCtx, args: Record<string, unknown>) => Promise<unknown>;

const mockQuery = {
  filter: jest.fn().mockReturnThis(),
  first: jest.fn() as jest.Mock<() => Promise<unknown>>,
  collect: jest.fn() as jest.Mock<() => Promise<unknown>>,
};

// Mock convex/server
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
  'convex/values',
  () => {
    const v: Record<string, jest.Mock> = {};
    const pass = () => ({});
    ['string', 'number', 'boolean', 'any'].forEach((k) => (v[k] = jest.fn(pass)));
    v['optional'] = jest.fn(pass);
    v['array'] = jest.fn(pass);
    v['object'] = jest.fn(pass);
    return { v };
  },
  { virtual: true },
);

import { getNotes, syncNotes } from '../../convex/functions/notes';

// ---------------------------------------------------------------------------
// getNotes
// ---------------------------------------------------------------------------

describe('getNotes Contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockReturnValue(mockQuery);
    mockQuery.filter.mockReturnThis();
  });

  test('should query notes for the given userId', async () => {
    const expected = [
      {
        id: 'note-1',
        userId: 'user-1',
        title: 'Hello',
        active: true,
        updatedAt: 1000,
        createdAt: 1000,
      },
    ];
    mockQuery.collect.mockResolvedValue(expected);

    const handler = (getNotes as unknown as { _handler: Handler })._handler;
    const result = await handler(mockCtx, { userId: 'user-1' });

    expect(mockDb.query).toHaveBeenCalledWith('notes');
    expect(result).toEqual(expected);
  });

  test('should return empty array when user has no notes', async () => {
    mockQuery.collect.mockResolvedValue([]);

    const handler = (getNotes as unknown as { _handler: Handler })._handler;
    const result = await handler(mockCtx, { userId: 'user-empty' });

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// syncNotes – create
// ---------------------------------------------------------------------------

describe('syncNotes Contract – create', () => {
  const baseNote = {
    id: 'note-new',
    userId: 'user-1',
    title: 'My Note',
    content: 'Some content',
    color: null,
    active: true,
    done: false,
    isPinned: false,
    updatedAt: 2000,
    createdAt: 1000,
    operation: 'create',
    deviceId: 'device-1',
    version: 1,
    baseVersion: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockReturnValue(mockQuery);
    mockQuery.filter.mockReturnThis();
    // No existing note
    mockQuery.first.mockResolvedValue(null);
    // Return empty list for final getAllNotes query
    mockQuery.collect.mockResolvedValue([]);
  });

  test('should insert a new note and emit a noteChangeEvent', async () => {
    const handler = (syncNotes as unknown as { _handler: Handler })._handler;

    await handler(mockCtx, {
      userId: 'user-1',
      changes: [baseNote],
      lastSyncAt: 0,
    });

    expect(mockDb.insert).toHaveBeenCalledWith(
      'notes',
      expect.objectContaining({
        id: 'note-new',
        userId: 'user-1',
        title: 'My Note',
        content: 'Some content',
        active: true,
        version: 1,
      }),
    );

    expect(mockDb.insert).toHaveBeenCalledWith(
      'noteChangeEvents',
      expect.objectContaining({
        noteId: 'note-new',
        operation: 'create',
        userId: 'user-1',
        deviceId: 'device-1',
      }),
    );
  });

  test('should return syncedAt timestamp and notes array', async () => {
    const handler = (syncNotes as unknown as { _handler: Handler })._handler;

    const result = (await handler(mockCtx, {
      userId: 'user-1',
      changes: [baseNote],
      lastSyncAt: 0,
    })) as { notes: unknown[]; syncedAt: number };

    expect(result).toHaveProperty('notes');
    expect(result).toHaveProperty('syncedAt');
    expect(typeof result.syncedAt).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// syncNotes – update
// ---------------------------------------------------------------------------

describe('syncNotes Contract – update', () => {
  const existingNote = {
    _id: 'convex-id-1',
    id: 'note-1',
    userId: 'user-1',
    title: 'Old Title',
    content: 'Old content',
    active: true,
    updatedAt: 1000,
    version: 2,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockReturnValue(mockQuery);
    mockQuery.filter.mockReturnThis();
    mockQuery.collect.mockResolvedValue([]);
  });

  test('should patch note when incoming updatedAt is newer', async () => {
    mockQuery.first.mockResolvedValue(existingNote);

    const handler = (syncNotes as unknown as { _handler: Handler })._handler;
    await handler(mockCtx, {
      userId: 'user-1',
      changes: [
        {
          id: 'note-1',
          userId: 'user-1',
          title: 'New Title',
          content: 'New content',
          active: true,
          updatedAt: 9999,
          createdAt: 1000,
          operation: 'update',
          deviceId: 'device-1',
        },
      ],
      lastSyncAt: 0,
    });

    expect(mockDb.patch).toHaveBeenCalledWith(
      'convex-id-1',
      expect.objectContaining({
        title: 'New Title',
        content: 'New content',
        updatedAt: 9999,
        version: 3,
      }),
    );
  });

  test('should NOT patch note when incoming updatedAt is older', async () => {
    mockQuery.first.mockResolvedValue(existingNote);

    const handler = (syncNotes as unknown as { _handler: Handler })._handler;
    await handler(mockCtx, {
      userId: 'user-1',
      changes: [
        {
          id: 'note-1',
          userId: 'user-1',
          title: 'Stale Title',
          content: 'Stale content',
          active: true,
          updatedAt: 500, // older than server's 1000
          createdAt: 1000,
          operation: 'update',
          deviceId: 'device-1',
        },
      ],
      lastSyncAt: 0,
    });

    expect(mockDb.patch).not.toHaveBeenCalled();
  });

  test('should insert note when it does not exist on server during update', async () => {
    mockQuery.first.mockResolvedValue(null);

    const handler = (syncNotes as unknown as { _handler: Handler })._handler;
    await handler(mockCtx, {
      userId: 'user-1',
      changes: [
        {
          id: 'note-missing',
          userId: 'user-1',
          title: 'Created via update',
          content: null,
          active: true,
          updatedAt: 3000,
          createdAt: 2000,
          operation: 'update',
          deviceId: 'device-2',
        },
      ],
      lastSyncAt: 0,
    });

    expect(mockDb.insert).toHaveBeenCalledWith(
      'notes',
      expect.objectContaining({ id: 'note-missing', version: 1 }),
    );
  });
});

// ---------------------------------------------------------------------------
// syncNotes – delete
// ---------------------------------------------------------------------------

describe('syncNotes Contract – delete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockReturnValue(mockQuery);
    mockQuery.filter.mockReturnThis();
    mockQuery.collect.mockResolvedValue([]);
  });

  test('should soft-delete an existing note', async () => {
    mockQuery.first.mockResolvedValue({
      _id: 'convex-id-2',
      id: 'note-2',
      userId: 'user-1',
      active: true,
      updatedAt: 1000,
      version: 1,
    });

    const handler = (syncNotes as unknown as { _handler: Handler })._handler;
    await handler(mockCtx, {
      userId: 'user-1',
      changes: [
        {
          id: 'note-2',
          userId: 'user-1',
          active: false,
          updatedAt: 5000,
          createdAt: 1000,
          operation: 'delete',
          deviceId: 'device-1',
        },
      ],
      lastSyncAt: 0,
    });

    expect(mockDb.patch).toHaveBeenCalledWith(
      'convex-id-2',
      expect.objectContaining({
        active: false,
        updatedAt: 5000,
        version: 2,
      }),
    );
  });

  test('should emit a noteChangeEvent for delete operation', async () => {
    mockQuery.first.mockResolvedValue({
      _id: 'convex-id-3',
      id: 'note-3',
      userId: 'user-1',
      active: true,
      updatedAt: 1000,
      version: 1,
    });

    const handler = (syncNotes as unknown as { _handler: Handler })._handler;
    await handler(mockCtx, {
      userId: 'user-1',
      changes: [
        {
          id: 'note-3',
          userId: 'user-1',
          active: false,
          updatedAt: 6000,
          createdAt: 1000,
          operation: 'delete',
          deviceId: 'device-1',
        },
      ],
      lastSyncAt: 0,
    });

    expect(mockDb.insert).toHaveBeenCalledWith(
      'noteChangeEvents',
      expect.objectContaining({
        noteId: 'note-3',
        operation: 'delete',
        userId: 'user-1',
      }),
    );
  });

  test('should skip patch when note to delete is not found', async () => {
    mockQuery.first.mockResolvedValue(null);

    const handler = (syncNotes as unknown as { _handler: Handler })._handler;
    await handler(mockCtx, {
      userId: 'user-1',
      changes: [
        {
          id: 'note-ghost',
          userId: 'user-1',
          active: false,
          updatedAt: 7000,
          createdAt: 1000,
          operation: 'delete',
          deviceId: 'device-1',
        },
      ],
      lastSyncAt: 0,
    });

    expect(mockDb.patch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// syncNotes – batch operations
// ---------------------------------------------------------------------------

describe('syncNotes Contract – batch operations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockReturnValue(mockQuery);
    mockQuery.filter.mockReturnThis();
    mockQuery.collect.mockResolvedValue([]);
  });

  test('should process multiple changes in a single call', async () => {
    // First call: no existing note for create; second call: existing note for update
    mockQuery.first
      .mockResolvedValueOnce(null) // create
      .mockResolvedValueOnce({ _id: 'cx-5', id: 'note-5', updatedAt: 100, version: 1 }); // update

    const handler = (syncNotes as unknown as { _handler: Handler })._handler;
    await handler(mockCtx, {
      userId: 'user-1',
      changes: [
        {
          id: 'note-4',
          userId: 'user-1',
          title: 'Batch create',
          active: true,
          updatedAt: 2000,
          createdAt: 1000,
          operation: 'create',
          deviceId: 'device-1',
        },
        {
          id: 'note-5',
          userId: 'user-1',
          title: 'Batch update',
          active: true,
          updatedAt: 9000,
          createdAt: 1000,
          operation: 'update',
          deviceId: 'device-1',
        },
      ],
      lastSyncAt: 0,
    });

    // Two noteChangeEvents should have been emitted
    const insertCalls = (mockDb.insert as jest.Mock).mock.calls.filter(
      (c) => c[0] === 'noteChangeEvents',
    );
    expect(insertCalls).toHaveLength(2);

    // The new note was inserted
    expect(mockDb.insert).toHaveBeenCalledWith('notes', expect.objectContaining({ id: 'note-4' }));

    // The existing note was patched
    expect(mockDb.patch).toHaveBeenCalledWith(
      'cx-5',
      expect.objectContaining({ title: 'Batch update' }),
    );
  });
});
