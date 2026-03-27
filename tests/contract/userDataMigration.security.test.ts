/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { sha256 } from 'js-sha256';

type HandlerConfig = {
  handler: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};

type Handler = (ctx: typeof mockCtx, args: Record<string, unknown>) => Promise<unknown>;

const makeQueryChain = () => {
  const chain: any = {
    withIndex: jest.fn(),
    filter: jest.fn(),
    first: jest.fn(),
    collect: jest.fn(),
  };
  chain.withIndex.mockReturnValue(chain);
  chain.filter.mockReturnValue(chain);
  return chain;
};

const migrationAttemptsQuery = makeQueryChain();
const usersQuery = makeQueryChain();
const notesQuery = makeQueryChain();
const subscriptionsQuery = makeQueryChain();
const tokensQuery = makeQueryChain();
const eventsQuery = makeQueryChain();

const mockDb = {
  query: jest.fn((table: string) => {
    if (table === 'migrationAttempts') return migrationAttemptsQuery;
    if (table === 'users') return usersQuery;
    if (table === 'notes') return notesQuery;
    if (table === 'subscriptions') return subscriptionsQuery;
    if (table === 'devicePushTokens') return tokensQuery;
    if (table === 'noteChangeEvents') return eventsQuery;
    throw new Error(`Unexpected query table: ${table}`);
  }),
  patch: jest.fn(),
  insert: jest.fn(),
  delete: jest.fn(),
  get: jest.fn(),
};

const mockCtx = { db: mockDb };

const mockMutation = jest.fn((config: HandlerConfig) => ({
  ...config,
  _handler: config.handler,
}));

jest.mock(
  '../../convex/_generated/server',
  () => ({
    mutation: mockMutation,
  }),
  { virtual: true },
);

jest.mock(
  'convex/values',
  () => {
    const v: Record<string, jest.Mock> = {};
    const pass = () => ({});
    ['string', 'number', 'boolean', 'any', 'null', 'literal'].forEach(
      (key) => (v[key] = jest.fn(pass)),
    );
    v['optional'] = jest.fn(pass);
    v['union'] = jest.fn(pass);
    v['array'] = jest.fn(pass);
    v['object'] = jest.fn(pass);
    return { v };
  },
  { virtual: true },
);

import {
  applyUserDataMerge,
  migrateUserData,
  preflightUserDataMerge,
} from '../../convex/functions/userDataMigration';

describe('userDataMigration preflight and apply', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (migrationAttemptsQuery.first as any).mockResolvedValue(null);
    (usersQuery.first as any).mockResolvedValue(null);
    (notesQuery.collect as any).mockResolvedValue([]);
    (subscriptionsQuery.collect as any).mockResolvedValue([]);
    (tokensQuery.collect as any).mockResolvedValue([]);
    (eventsQuery.collect as any).mockResolvedValue([]);
    (mockDb.get as any).mockResolvedValue(null);
  });

  test('preflight rejects non-account target userId and records failed attempt', async () => {
    const handler = (preflightUserDataMerge as unknown as { _handler: Handler })._handler;

    await expect(
      handler(mockCtx, {
        fromUserId: 'device-1',
        toUserId: 'not-an-account',
        username: 'alice',
        password: 'password123',
      }),
    ).rejects.toThrow('Migration target must be a valid account user');

    expect(mockDb.insert).toHaveBeenCalledWith(
      'migrationAttempts',
      expect.objectContaining({
        key: 'not-an-account',
        attempts: 1,
      }),
    );
  });

  test('preflight marks sample-only local snapshots correctly', async () => {
    const handler = (preflightUserDataMerge as unknown as { _handler: Handler })._handler;

    const salt = 'abcd';
    const password = 'pass1234';
    (mockDb.get as any).mockResolvedValue({
      _id: { toString: () => 'user-target' },
      username: 'alice',
      passwordHash: `${salt}:${sha256(salt + password)}`,
    });
    (usersQuery.first as any).mockResolvedValue({
      _id: { toString: () => 'user-target' },
      username: 'alice',
      passwordHash: `${salt}:${sha256(salt + password)}`,
    });
    (notesQuery.collect as any)
      .mockResolvedValueOnce([
        {
          _id: 'note-source',
          id: 'welcome-device',
          userId: 'device-1',
          title: 'Welcome to AI Note Keeper',
          content: 'This is your first note. Edit or delete it anytime.',
          active: true,
          updatedAt: 1000,
          createdAt: 1000,
        },
      ])
      .mockResolvedValueOnce([]);

    const result = (await handler(mockCtx, {
      fromUserId: 'device-1',
      toUserId: 'user-target',
      username: 'alice',
      password,
    })) as {
      sourceSampleOnly: boolean;
      sourceEmpty: boolean;
      targetEmpty: boolean;
    };

    expect(result).toEqual(
      expect.objectContaining({
        sourceSampleOnly: true,
        sourceEmpty: false,
        targetEmpty: true,
      }),
    );
  });

  test('apply local replaces target notes, subscriptions, and events with source snapshot', async () => {
    const handler = (applyUserDataMerge as unknown as { _handler: Handler })._handler;

    const salt = 'salt';
    const password = 'password123';
    (mockDb.get as any).mockResolvedValue({
      _id: { toString: () => 'user-target' },
      username: 'alice',
      passwordHash: `${salt}:${sha256(salt + password)}`,
    });
    (usersQuery.first as any).mockResolvedValue({
      _id: { toString: () => 'user-target' },
      username: 'alice',
      passwordHash: `${salt}:${sha256(salt + password)}`,
    });
    (notesQuery.collect as any)
      .mockResolvedValueOnce([
        {
          _id: 'source-note-doc',
          id: 'note-1',
          userId: 'device-1',
          title: 'Local note',
          active: true,
          updatedAt: 1000,
          createdAt: 900,
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: 'target-note-doc',
          id: 'note-2',
          userId: 'user-target',
          title: 'Cloud note',
          active: true,
          updatedAt: 1000,
          createdAt: 900,
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: 'target-note-doc',
          id: 'note-2',
          userId: 'user-target',
          title: 'Cloud note',
          active: true,
          updatedAt: 1000,
          createdAt: 900,
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: 'final-note-doc',
          id: 'note-1',
          userId: 'user-target',
          title: 'Local note',
          active: true,
          updatedAt: 1000,
          createdAt: 900,
        },
      ]);
    (subscriptionsQuery.collect as any)
      .mockResolvedValueOnce([
        {
          _id: 'source-sub-doc',
          userId: 'device-1',
          serviceName: 'Spotify',
          category: 'music',
          price: 9.99,
          currency: 'USD',
          billingCycle: 'monthly',
          nextBillingDate: 1000,
          status: 'active',
          reminderDaysBefore: [1],
          active: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: 'target-sub-doc',
          userId: 'user-target',
          serviceName: 'Netflix',
          category: 'streaming',
          price: 12.99,
          currency: 'USD',
          billingCycle: 'monthly',
          nextBillingDate: 1000,
          status: 'active',
          reminderDaysBefore: [1],
          active: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: 'target-sub-doc',
          userId: 'user-target',
          serviceName: 'Netflix',
          category: 'streaming',
          price: 12.99,
          currency: 'USD',
          billingCycle: 'monthly',
          nextBillingDate: 1000,
          status: 'active',
          reminderDaysBefore: [1],
          active: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: 'final-sub-doc',
          userId: 'user-target',
          serviceName: 'Spotify',
          category: 'music',
          price: 9.99,
          currency: 'USD',
          billingCycle: 'monthly',
          nextBillingDate: 1000,
          status: 'active',
          reminderDaysBefore: [1],
          active: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ]);
    (eventsQuery.collect as any)
      .mockResolvedValueOnce([
        {
          _id: 'source-event-doc',
          id: 'event-1',
          noteId: 'note-1',
          userId: 'device-1',
          operation: 'create',
          changedAt: 1000,
          deviceId: 'device-1',
          payloadHash: '',
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: 'target-event-doc',
          id: 'event-2',
          noteId: 'note-2',
          userId: 'user-target',
          operation: 'create',
          changedAt: 1000,
          deviceId: 'device-1',
          payloadHash: '',
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: 'target-event-doc',
          id: 'event-2',
          noteId: 'note-2',
          userId: 'user-target',
          operation: 'create',
          changedAt: 1000,
          deviceId: 'device-1',
          payloadHash: '',
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: 'final-event-doc',
          id: 'event-3',
          noteId: 'note-1',
          userId: 'user-target',
          operation: 'create',
          changedAt: 1000,
          deviceId: 'device-1',
          payloadHash: '',
        },
      ]);

    const result = (await handler(mockCtx, {
      fromUserId: 'device-1',
      toUserId: 'user-target',
      username: 'alice',
      password,
      strategy: 'local',
    })) as { targetCounts: { notes: number; subscriptions: number; events: number } };

    expect(mockDb.delete).toHaveBeenCalledWith('target-note-doc');
    expect(mockDb.delete).toHaveBeenCalledWith('target-sub-doc');
    expect(mockDb.delete).toHaveBeenCalledWith('target-event-doc');
    expect(mockDb.insert).toHaveBeenCalledWith(
      'notes',
      expect.objectContaining({ id: 'note-1', userId: 'user-target' }),
    );
    expect(mockDb.insert).toHaveBeenCalledWith(
      'subscriptions',
      expect.objectContaining({ serviceName: 'Spotify', userId: 'user-target' }),
    );
    expect(result.targetCounts).toEqual(
      expect.objectContaining({ notes: 1, subscriptions: 1, events: 1 }),
    );
  });

  test('apply both duplicates conflicting local notes as local copies', async () => {
    const handler = (applyUserDataMerge as unknown as { _handler: Handler })._handler;

    const salt = 'salt';
    const password = 'password123';
    (mockDb.get as any).mockResolvedValue({
      _id: { toString: () => 'user-target' },
      username: 'alice',
      passwordHash: `${salt}:${sha256(salt + password)}`,
    });
    (usersQuery.first as any).mockResolvedValue({
      _id: { toString: () => 'user-target' },
      username: 'alice',
      passwordHash: `${salt}:${sha256(salt + password)}`,
    });
    (notesQuery.collect as any)
      .mockResolvedValueOnce([
        {
          _id: 'source-note-doc',
          id: 'note-1',
          userId: 'device-1',
          title: 'Local draft',
          content: 'local',
          active: true,
          updatedAt: 1000,
          createdAt: 900,
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: 'target-note-doc',
          id: 'note-1',
          userId: 'user-target',
          title: 'Cloud draft',
          content: 'cloud',
          active: true,
          updatedAt: 1100,
          createdAt: 900,
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: 'target-note-doc',
          id: 'note-1',
          userId: 'user-target',
          title: 'Cloud draft',
          content: 'cloud',
          active: true,
          updatedAt: 1100,
          createdAt: 900,
        },
        {
          _id: 'copied-note-doc',
          id: 'copy-id',
          userId: 'user-target',
          title: 'Local draft (Local copy)',
          content: 'local',
          active: true,
          updatedAt: 1000,
          createdAt: 900,
        },
      ]);

    const result = (await handler(mockCtx, {
      fromUserId: 'device-1',
      toUserId: 'user-target',
      username: 'alice',
      password,
      strategy: 'both',
    })) as { targetCounts: { notes: number } };

    expect(mockDb.insert).toHaveBeenCalledWith(
      'notes',
      expect.objectContaining({
        userId: 'user-target',
        title: 'Local draft (Local copy)',
      }),
    );
    expect(result.targetCounts.notes).toBe(2);
  });

  test('legacy migrateUserData uses local strategy semantics', async () => {
    const handler = (migrateUserData as unknown as { _handler: Handler })._handler;

    const salt = 'salt';
    const password = 'password123';
    (mockDb.get as any).mockResolvedValue({
      _id: { toString: () => 'user-target' },
      username: 'alice',
      passwordHash: `${salt}:${sha256(salt + password)}`,
    });
    (usersQuery.first as any).mockResolvedValue({
      _id: { toString: () => 'user-target' },
      username: 'alice',
      passwordHash: `${salt}:${sha256(salt + password)}`,
    });
    (notesQuery.collect as any).mockResolvedValue([]);
    (subscriptionsQuery.collect as any).mockResolvedValue([]);
    (eventsQuery.collect as any).mockResolvedValue([]);

    const result = (await handler(mockCtx, {
      fromUserId: 'device-1',
      toUserId: 'user-target',
      username: 'alice',
      password,
    })) as { migrated: number };

    expect(result.migrated).toBe(0);
  });
});
